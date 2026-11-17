#!/usr/bin/env python3
"""Assemble a Windows x64 portable candidate from explicit, already installed runtimes.

Run on Windows after cargo build --locked --release and npm ci in windows/.
Never copies user profiles, cookies, models, or a virtual environment launcher.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def x64(file):
    with file.open('rb') as stream:
        if stream.read(2) != b'MZ':
            raise ValueError(f'Not a Windows executable: {file.name}')
        stream.seek(0x3c)
        offset = struct.unpack('<I', stream.read(4))[0]
        stream.seek(offset)
        if stream.read(4) != b'PE\0\0' or stream.read(2) != b'\x64\x86':
            raise ValueError(f'Not Windows x64: {file.name}')


def run(executable, args, **kwargs):
    result = subprocess.run([str(executable), *map(str, args)], capture_output=True,
                            encoding='utf-8', timeout=90, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{Path(executable).name} validation failed (exit {result.returncode})')
    return result.stdout.strip()


def build(args):
    if sys.platform != 'win32':
        raise SystemExit('Build and validate this candidate on native Windows x64.')
    python_home = args.python_home.resolve()
    packages = args.python_packages.resolve()
    electron = ROOT / 'windows/node_modules/electron/dist'
    version = json.loads((ROOT / 'windows/package.json').read_text())['version']
    output = ROOT / '.build/windows-x64'
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(electron, output)
    (output / 'electron.exe').rename(output / 'LinkParse.exe')
    x64(output / 'LinkParse.exe')
    (output / 'resources/default_app.asar').unlink(missing_ok=True)
    app = output / 'resources/app'
    app.mkdir(parents=True)
    (app / 'package.json').write_text(json.dumps({'name': 'linkparse', 'version': version,
        'main': 'windows/main.cjs', 'productName': 'LinkParse'}), encoding='utf-8')
    host = app / 'windows'
    host.mkdir()
    for name in ('main.cjs', 'preload.cjs', 'protocol.cjs', 'settings.cjs', 'managed.cjs', 'auth.cjs', 'auth-utils.cjs', 'auth-preload.cjs'):
        shutil.copy2(ROOT / 'windows' / name, host / name)
    shutil.copytree(ROOT / 'windows/ui', host / 'ui', ignore=shutil.ignore_patterns('*test*'))
    worker = app / 'backend/worker'
    worker.mkdir(parents=True)
    for name in ('download.py', 'requirements.lock'):
        shutil.copy2(ROOT / 'backend/worker' / name, worker / name)
    runtime = app / 'runtime'
    runtime.mkdir()
    binaries = {'linkparsing-desktop.exe': ROOT / 'target/release/linkparsing-desktop.exe',
                'ffmpeg.exe': args.ffmpeg, 'ffprobe.exe': args.ffprobe, 'ffplay.exe': args.ffplay, 'node.exe': args.node}
    for name, source in binaries.items():
        x64(source)
        shutil.copy2(source, runtime / name)
    portable = runtime / 'python'
    portable.mkdir()
    # Use an actual base interpreter, not Scripts/python.exe from a venv.
    for file in python_home.iterdir():
        if file.name in ('python.exe', 'pythonw.exe', 'LICENSE.txt') or file.suffix.lower() == '.dll':
            shutil.copy2(file, portable / file.name)
    x64(portable / 'python.exe')
    # The MSVC backend loads from its own executable directory, not Python's.
    if not (portable / 'vcruntime140.dll').is_file():
        raise RuntimeError('Base Python distribution must include the VC runtime')
    for dll in portable.glob('vcruntime*.dll'):
        x64(dll)
        shutil.copy2(dll, runtime / dll.name)
    ignore = shutil.ignore_patterns('__pycache__', '*.pyc', 'site-packages', 'test', 'tests', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip')
    for name in ('Lib', 'DLLs'):
        shutil.copytree(python_home / name, portable / name, ignore=ignore)
    shutil.copytree(packages, portable / 'Lib/site-packages', ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'pip', 'pip-*.dist-info'))
    # ._pth prevents registry/global Python discovery and makes relocation deterministic.
    (portable / 'python._pth').write_text('Lib\nDLLs\nLib/site-packages\nimport site\n', encoding='ascii')
    for dll in portable.glob('python3[0-9]*.dll'):
        (portable / (dll.stem + '._pth')).write_text('Lib\nDLLs\nLib/site-packages\nimport site\n', encoding='ascii')
    clean = {key: value for key, value in os.environ.items() if not key.startswith(('PYTHON', 'LINKPARSING_', 'TOOLBOX_'))}
    clean['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')
    expected = dict(line.split('==') for line in (worker / 'requirements.lock').read_text().splitlines() if line.strip())
    installed = json.loads(run(portable / 'python.exe', ['-I', '-B', '-c',
        'import importlib.metadata,json; print(json.dumps({d.metadata["Name"].lower():d.version for d in importlib.metadata.distributions()}))'], env=clean))
    if any(installed.get(name.lower()) != version for name, version in expected.items()):
        raise RuntimeError('Bundled Python packages do not match requirements.lock')
    versions = {
        'python': run(portable / 'python.exe', ['-I', '-B', '-c', 'import sys,ssl,sqlite3,yt_dlp,certifi,Cryptodome; print(sys.version.split()[0])'], env=clean),
        'node': run(runtime / 'node.exe', ['--version'], env=clean),
        'ffmpeg': run(runtime / 'ffmpeg.exe', ['-version'], env=clean).splitlines()[0],
        'ffprobe': run(runtime / 'ffprobe.exe', ['-version'], env=clean).splitlines()[0],
        'ffplay': run(runtime / 'ffplay.exe', ['-version'], env=clean).splitlines()[0],
        'electron': (electron / 'version').read_text().strip(),
    }
    clean.update({f'LINKPARSING_{key}': str(value) for key, value in {
        'PYTHON': portable / 'python.exe', 'FFMPEG': runtime / 'ffmpeg.exe', 'FFPROBE': runtime / 'ffprobe.exe',
        'NODE': runtime / 'node.exe', 'WORKER': worker / 'download.py'}.items()})
    request = output / 'doctor-request.json'
    request.write_text('{"action":"doctor"}', encoding='utf-8')
    try:
        doctor = json.loads(run(portable / 'python.exe', ['-I', '-B', worker / 'download.py', request], env=clean, cwd=output))
        if doctor.get('ok') is not True:
            raise RuntimeError('Bundled downloader doctor failed')
    finally:
        request.unlink()
    notices = output / 'licenses'
    notices.mkdir(exist_ok=True)
    node_license = args.node_license or args.node.parent / 'LICENSE'
    shutil.copy2(node_license, notices / 'NODE-LICENSE.txt')
    shutil.copytree(args.ffmpeg_notices, notices / 'ffmpeg', ignore=shutil.ignore_patterns('bin', 'doc', 'presets'))
    (output / 'README.txt').write_text('LinkParse Windows x64 portable candidate\n\nRun LinkParse.exe. No Python, Node or FFmpeg installation is required.\nPreferences are outside this folder; Toolbox supplies a separate managed data directory.\nASR needs an optional local whisper.cpp engine and model. Windows OCR and Agent are unavailable.\nUnsigned; native GUI/lifecycle acceptance is a separate release gate.\n', encoding='utf-8')
    manifest = {'version': version, 'target': 'win32-x64', 'runtimes': versions, 'downloader': doctor,
                'files': {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in sorted(output.rglob('*')) if p.is_file()}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    archive = ROOT / f'dist/LinkParse-{version}-Windows-x64.zip'
    archive.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for file in sorted(output.rglob('*')):
            if file.is_file():
                target.write(file, file.relative_to(output).as_posix())
    print(json.dumps({'archive': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'runtimes': versions}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('python-home', 'python-packages', 'ffmpeg', 'ffprobe', 'ffplay', 'node', 'ffmpeg-notices'):
        parser.add_argument('--'+option, required=True, type=Path)
    parser.add_argument('--node-license', type=Path, help='Defaults to LICENSE beside node.exe')
    build(parser.parse_args())

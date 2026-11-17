#!/usr/bin/env python3
"""Bundle and relocate the local arm64 runtime; no source-tree or Homebrew paths at runtime."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
APP = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build/LinkParsing.app'
RES = APP / 'Contents/Resources'
RUNTIME = RES / 'Runtime'
sources = {}
libraries = {}


def run(*args):
    return subprocess.check_output([str(x) for x in args], text=True, stderr=subprocess.STDOUT)


def copy(source, target):
    source = Path(source).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    sources[target] = source
    return target


def macho(file):
    with file.open('rb') as f:
        return f.read(4) in [b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca']


def dependencies(file):
    return list(dict.fromkeys(line.strip().split(' (compatibility')[0] for line in run('otool', '-arch', 'arm64', '-L', file).splitlines() if line.startswith('\t')))


def resolve(dependency, source):
    if dependency.startswith('@loader_path/'):
        return (source.parent / dependency[len('@loader_path/'):]).resolve()
    if dependency.startswith('@rpath/'):
        load = run('otool', '-arch', 'arm64', '-l', source)
        paths = re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset', load)
        for base in paths:
            base = base.replace('@loader_path', str(source.parent)).replace('@executable_path', str(source.parent))
            candidate = Path(base) / dependency[len('@rpath/'):]
            if candidate.is_file():
                return candidate.resolve()
        raise RuntimeError(f'Unresolved runtime dependency: {source}: {dependency}')
    return Path(dependency).resolve()


def relocate(target):
    source = sources[target]
    subprocess.run(['codesign', '--remove-signature', str(target)], capture_output=True)
    for dependency in dependencies(source):
        if dependency.startswith(('/usr/lib/', '/System/Library/')):
            continue
        resolved = resolve(dependency, source)
        if resolved == source:  # dylib install ID
            continue
        if resolved not in libraries:
            name = hashlib.sha256(str(resolved).encode()).hexdigest()[:10] + '-' + resolved.name
            libraries[resolved] = copy(resolved, RUNTIME / 'lib/native' / name)
        link = '@loader_path/' + os.path.relpath(libraries[resolved], target.parent)
        run('install_name_tool', '-change', dependency, link, target)


def main():
    if sys.platform != 'darwin' or os.uname().machine != 'arm64':
        raise SystemExit('This runtime bundler currently verifies macOS arm64 only.')
    if RUNTIME.exists():
        shutil.rmtree(RUNTIME)
    RUNTIME.mkdir(parents=True)
    python = ROOT / 'backend/.venv/bin/python'
    info = json.loads(run(python, '-c', 'import sys,json; print(json.dumps([sys.base_prefix,sys.version_info[:2]]))'))
    prefix, version = Path(info[0]), '.'.join(str(x) for x in info[1])
    lib = RUNTIME / f'lib/python{version}'
    shutil.copytree(prefix / f'lib/python{version}', lib,
                    ignore=shutil.ignore_patterns('site-packages', '__pycache__', 'test', 'tests', 'idlelib', 'tkinter', '_tkinter*', 'ensurepip'), symlinks=False)
    for target in lib.rglob('*'):
        if target.is_file() and macho(target):
            sources[target] = (prefix / f'lib/python{version}' / target.relative_to(lib)).resolve()
    site = ROOT / f'backend/.venv/lib/python{version}/site-packages'
    shutil.copytree(site, lib / 'site-packages', symlinks=False,
                    ignore=shutil.ignore_patterns('__pycache__', 'pip', 'pip-*'))
    for target in (lib / 'site-packages').rglob('*'):
        if target.is_file() and macho(target):
            sources[target] = (site / target.relative_to(lib / 'site-packages')).resolve()
    # Framework bin/python is a macOS launcher that execs Resources/Python.app.
    # Bundle the interpreter itself, so relocating the framework cannot strand it.
    interpreter = prefix / 'Resources/Python.app/Contents/MacOS/Python'
    if not interpreter.exists():
        interpreter = python
    for name, executable in [('python3', interpreter), ('ffmpeg', shutil.which('ffmpeg')), ('ffprobe', shutil.which('ffprobe')),
                             ('node', shutil.which('node')), ('whisper-cli', shutil.which('whisper-cli'))]:
        if not executable:
            raise RuntimeError('Missing prerequisite: ' + name)
        copy(executable, RUNTIME / 'bin' / name)
    done = set()
    while pending := [p for p in sources if p not in done]:
        for target in pending:
            relocate(target)
            done.add(target)
    for target in sources:
        # Verify there are no external loader references after relocation.
        assert all(d.startswith(('/usr/lib/', '/System/Library/', '@loader_path/')) or Path(d).resolve() == sources[target]
                   for d in dependencies(target)), target
        run('codesign', '--force', '--sign', '-', target)
    model = Path(os.environ.get('LINKPARSING_ASR_MODEL', str(Path.home() / 'Library/Application Support/LinkParsing/Models/ggml-large-v3-turbo-q5_0.bin')))
    expected = '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
    with model.open('rb') as f:
        assert hashlib.file_digest(f, 'sha256').hexdigest() == expected, 'ASR model checksum mismatch'
    (RUNTIME / 'models').mkdir()
    shutil.copy2(model, RUNTIME / 'models' / model.name)
    config = {'Python': 'Runtime/bin/python3', 'FFmpeg': 'Runtime/bin/ffmpeg', 'FFprobe': 'Runtime/bin/ffprobe',
              'Node': 'Runtime/bin/node', 'Whisper': 'Runtime/bin/whisper-cli', 'ASRModel': 'Runtime/models/' + model.name}
    with (RES / 'Runtime.plist').open('wb') as f:
        plistlib.dump(config, f)
    (RES / 'runtime-manifest.json').write_text(json.dumps({'target': 'darwin-arm64', 'python': version, 'modelSHA256': expected,
        'nativeFiles': len(sources), 'configuration': config}, indent=2) + '\n')
    result = run(RUNTIME / 'bin/python3', '-I', '-B', '-c', 'import sys,json,yt_dlp,ssl; print(json.dumps({"prefix":sys.prefix,"extractor":yt_dlp.version.__version__}))')
    assert str(RUNTIME) in result, result
    print(result.strip())
    run('codesign', '--force', '--sign', '-', APP)
    run('codesign', '--verify', '--deep', '--strict', APP)
    print(f'Bundled {len(sources)} native runtime files and the verified ASR model: {APP}')


if __name__ == '__main__':
    main()

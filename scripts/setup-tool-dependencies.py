#!/usr/bin/env python3
"""Install pinned tool SDKs/dependencies into ignored project caches (macOS arm64)."""
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.build'


def metadata(url):
    with urllib.request.urlopen(url, timeout=60) as stream:
        return json.load(stream)


def archive(url, expected, algorithm, destination):
    cached = CACHE / Path(url).name
    if not cached.is_file() or hashlib.new(algorithm, cached.read_bytes()).hexdigest() != expected:
        partial = cached.with_suffix(cached.suffix + '.partial')
        with urllib.request.urlopen(url, timeout=120) as stream, partial.open('wb') as output:
            shutil.copyfileobj(stream, output)
        if hashlib.new(algorithm, partial.read_bytes()).hexdigest() != expected:
            partial.unlink()
            raise RuntimeError('SDK checksum mismatch')
        partial.replace(cached)
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(cached) as source:
        source.extractall(destination, filter='data')


def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('Automatic SDK setup currently supports macOS arm64.')
    CACHE.mkdir(exist_ok=True)
    go_version = next(line.split()[1] for line in (ROOT / 'tools/rd/go.mod').read_text().splitlines() if line.startswith('go '))
    go = CACHE / 'go/bin/go'
    if not go.is_file():
        releases = metadata('https://go.dev/dl/?mode=json&include=all')
        release = next(row for row in releases if row['version'] == 'go' + go_version)
        file = next(row for row in release['files'] if row['os'] == 'darwin' and row['arch'] == 'arm64' and row['kind'] == 'archive')
        archive('https://go.dev/dl/' + file['filename'], file['sha256'], 'sha256', CACHE)
    assert 'go' + go_version in subprocess.check_output([go, 'version'], text=True)
    dotnet_version = json.loads((ROOT / 'tools/languagemap/global.json').read_text())['sdk']['version']
    dotnet = ROOT / 'tools/languagemap/.build/dotnet/dotnet'
    if not dotnet.is_file():
        releases = metadata('https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json')
        sdk = next(sdk for release in releases['releases'] for sdk in release.get('sdks', [release.get('sdk', {})]) if sdk.get('version') == dotnet_version)
        file = next(row for row in sdk['files'] if row['rid'] == 'osx-arm64' and row['name'].endswith('.tar.gz'))
        archive(file['url'], file['hash'], 'sha512', dotnet.parent)
    assert subprocess.check_output([dotnet, '--version'], cwd=ROOT / 'tools/languagemap', text=True).strip() == dotnet_version
    venv = ROOT / 'tools/linkparsing/backend/.venv'
    if not venv.exists():
        subprocess.run(['python3', '-m', 'venv', venv], check=True)
    subprocess.run([venv / 'bin/python', '-m', 'pip', 'install', '-r', ROOT / 'tools/linkparsing/backend/worker/requirements.lock'], check=True)
    subprocess.run([venv / 'bin/python', '-m', 'pip', 'check'], check=True)
    missing = [name for name in ['cargo', 'ffmpeg', 'ffprobe', 'node', 'whisper-cli'] if not shutil.which(name)]
    if missing:
        raise SystemExit('Install system build prerequisites before bundling: ' + ', '.join(missing))
    print('Pinned Go/.NET SDKs and Python dependencies are ready. Build prerequisites are available.')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Build allowlisted portable releases and a clean GitHub source upload bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = ''  # Set --repository only after the Toolbox release repository exists.
PLATFORMS = ('darwin-arm64', 'darwin-amd64', 'windows-amd64', 'windows-arm64')


def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def connector(dist, platform):
    release = json.loads((ROOT / 'scripts/vendor/cloudflared-release.json').read_text())
    key = 'windows-amd64' if platform.startswith('windows-') else platform
    asset = release['platforms'][key]
    cache = dist / 'cache'
    cache.mkdir(exist_ok=True)
    target = cache / ('cloudflared-' + release['version'] + '-' + key + '.' + asset['format'])
    def valid(p):
        return p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest() == asset['sha256']
    if not valid(target):
        temporary = target.with_suffix('.download')
        try:
            request = urllib.request.Request(asset['url'], headers={'User-Agent': 'Pangzhu-packager'})
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as output:
                shutil.copyfileobj(response, output)
            if not valid(temporary):
                raise RuntimeError('cloudflared does not match its pinned upstream SHA-256: ' + key)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    if asset['format'] == 'exe':
        return target.read_bytes()
    with tarfile.open(target, 'r:gz') as archive:
        members = [m for m in archive.getmembers() if m.name.lstrip('./') == 'cloudflared' and m.isfile()]
        if len(members) != 1 or members[0].size > 150 * 1024 * 1024:
            raise RuntimeError('Unexpected connector archive')
        return archive.extractfile(members[0]).read()


def licenses(go, folder):
    folder.mkdir()
    for source in (ROOT / 'scripts/vendor').iterdir():
        if source.is_file():
            shutil.copyfile(source, folder / source.name)
    goroot = Path(subprocess.check_output([go, 'env', 'GOROOT'], text=True).strip())
    shutil.copyfile(goroot / 'LICENSE', folder / 'Go-LICENSE.txt')
    output = subprocess.check_output([go, 'list', '-m', '-json', 'all'], cwd=ROOT, text=True)
    decoder = json.JSONDecoder()
    while output.strip():
        module, end = decoder.raw_decode(output.lstrip())
        output = output.lstrip()[end:]
        if module.get('Main') or not module.get('Dir'):
            continue
        for source in Path(module['Dir']).iterdir():
            if source.is_file() and source.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE', 'AUTHORS')):
                shutil.copyfile(source, folder / (module['Path'].replace('/', '_') + '-' + source.name + '.txt'))


def source_bundle(dist, version):
    # Enumerate maintained sources, never the workspace, home repository, or data.
    files = [ROOT / n for n in ('README.md', 'README.zh-CN.md', 'README.ja.md', 'GETTING_STARTED.md', 'VERSION', 'CHANGELOG.md', 'assets.go', 'go.mod', 'go.sum', 'package.json', 'package-lock.json')]
    files += [ROOT / 'docs' / n for n in ('macos.md', 'windows.md', 'releases.md', 'product/rd-files.md')]
    for directory in ('cmd', 'internal', 'scripts', 'website'):
        files += [p for p in (ROOT / directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc']
    files += [ROOT / 'design' / n for n in ('app.js', 'style.css', 'index.template.html', 'index.html', 'seed.json', 'build.py')]
    files += list((ROOT / 'design/tests').glob('*.cjs'))
    output = dist / f'pangzhu-{version}-source.zip'
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(set(files)):
            if p.is_symlink():
                raise RuntimeError('Refusing source symlink: ' + str(p))
            archive.write(p, Path('RD') / p.relative_to(ROOT))
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default=(ROOT / 'VERSION').read_text().strip())
    parser.add_argument('--platform', choices=PLATFORMS, action='append')
    parser.add_argument('--skip-source', action='store_true')
    parser.add_argument('--repository', default=REPOSITORY, help='GitHub owner/repo; empty disables updates')
    args = parser.parse_args(argv)
    if args.repository and not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        parser.error('repository must be owner/repo')
    if not re.fullmatch(r'(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})', args.version):
        parser.error('version must be a stable major.minor.patch number')
    go = shutil.which('go')
    if not go:
        raise SystemExit('Go must be available on PATH.')
    run(sys.executable, 'design/build.py')
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    outputs = []
    for platform in args.platform or PLATFORMS:
        goos, arch = platform.split('-')
        name = f'pangzhu-{args.version}-{platform}'
        # A fresh staging directory prevents stale runtime files entering a package.
        with tempfile.TemporaryDirectory(prefix='pangzhu-package-') as stage:
            folder = Path(stage) / name
            folder.mkdir()
            suffix = '.exe' if goos == 'windows' else ''
            env = dict(os.environ, GOOS=goos, GOARCH=arch, CGO_ENABLED='0')
            run(go, 'build', '-trimpath', '-buildvcs=false', f'-ldflags=-s -w -X pangzhu/internal/update.Version={args.version} -X pangzhu/internal/update.Repository={args.repository}', '-o', str(folder / ('pangzhu' + suffix)), './cmd/pangzhu', env=env)
            binary = folder / ('cloudflared' + suffix)
            binary.write_bytes(connector(dist, platform))
            binary.chmod(0o755)
            if goos == 'windows':
                names = ('Start-Share.cmd', 'Start-Local.cmd', 'Start-Pangzhu.ps1', 'Start-LAN.cmd', 'Start-Tunnel.cmd', 'Enable-LAN.ps1', 'cloudflared.example.yml', 'Check-Update.cmd', 'Update.cmd')
            else:
                names = ('Start-Pangzhu.command', 'Start-Share.command', 'Check-Update.command', 'Update.command')
            for filename in names:
                contents = (ROOT / 'scripts' / filename).read_bytes().replace(b'\r\n', b'\n')
                if goos == 'windows':
                    contents = contents.replace(b'\n', b'\r\n')
                target = folder / filename
                target.write_bytes(contents)
                if goos == 'darwin':
                    target.chmod(0o755)
            shutil.copyfile(ROOT / 'docs' / ('windows.md' if goos == 'windows' else 'macos.md'), folder / 'README.md')
            shutil.copyfile(ROOT / 'CHANGELOG.md', folder / 'RELEASE-NOTES.md')
            (folder / 'release.json').write_text(json.dumps({'version': args.version, 'repository': args.repository or None, 'os': goos, 'arch': arch}, indent=2) + '\n')
            licenses(go, folder / 'licenses')
            output = dist / (name + '.zip')
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for file in sorted(folder.rglob('*')):
                    if file.is_file():
                        archive.write(file, Path(name) / file.relative_to(folder))
            outputs.append(output)
            print(output, flush=True)
    if not args.skip_source:
        outputs.append(source_bundle(dist, args.version))
    checksums = [hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name for p in outputs]
    sums = dist / 'SHA256SUMS.txt'
    sums.write_text('\n'.join(checksums) + '\n')
    print(sums)


if __name__ == '__main__':
    main()

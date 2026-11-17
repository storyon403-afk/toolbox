#!/usr/bin/env python3
"""Audit release ZIP integrity, platform binaries, digests and excluded user data."""
import hashlib
import json
from pathlib import Path
import struct
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def binary_platform(data, goos, arch):
    if goos == 'windows':
        assert data[:2] == b'MZ', 'not a PE executable'
        offset = struct.unpack_from('<I', data, 0x3c)[0]
        assert data[offset:offset+4] == b'PE\0\0'
        assert struct.unpack_from('<H', data, offset+4)[0] == {'amd64': 0x8664, 'arm64': 0xaa64}[arch]
    else:
        assert data[:4] == b'\xcf\xfa\xed\xfe', 'not a 64-bit Mach-O executable'
        assert struct.unpack_from('<I', data, 4)[0] == {'amd64': 0x01000007, 'arm64': 0x0100000c}[arch]


def main():
    dist = ROOT / 'dist'
    version = (ROOT / 'VERSION').read_text().strip()
    pin = json.loads((ROOT / 'scripts/vendor/cloudflared-release.json').read_text())
    sums = {}
    for line in (dist / 'SHA256SUMS.txt').read_text().splitlines():
        digest, name = line.split('  ', 1)
        assert hashlib.sha256((dist / name).read_bytes()).hexdigest() == digest, name
        sums[name] = digest
    for goos, arch in [('darwin', 'arm64'), ('darwin', 'amd64'), ('windows', 'amd64'), ('windows', 'arm64')]:
        name = f'pangzhu-{version}-{goos}-{arch}'
        assert name + '.zip' in sums
        with zipfile.ZipFile(dist / (name + '.zip')) as archive:
            assert archive.testzip() is None
            names = archive.namelist()
            assert len(names) == len(set(n.lower() for n in names))
            for member in names:
                parts = Path(member).parts
                assert parts[0] == name and '..' not in parts
                assert not any(p in {'data', '.data', '.updates', '.git', 'node_modules', '__pycache__'} for p in parts)
                assert not any(s in member.lower() for s in ['owner.key', '.sqlite', 'credentials', '.token', '.ds_store'])
            manifest = json.loads(archive.read(name + '/release.json'))
            assert manifest == dict(version=version, repository='storyon403-afk/RD', os=goos, arch=arch)
            suffix = '.exe' if goos == 'windows' else ''
            binary_platform(archive.read(name + '/pangzhu' + suffix), goos, arch)
            binary_platform(archive.read(name + '/cloudflared' + suffix), goos, 'amd64' if goos == 'windows' else arch)
            assert name + '/licenses/Go-LICENSE.txt' in names
            assert name + '/licenses/cloudflared-LICENSE.txt' in names
            if goos == 'windows':
                assert hashlib.sha256(archive.read(name + '/cloudflared.exe')).hexdigest() == pin['platforms']['windows-amd64']['sha256']
                for member in names:
                    if member.endswith(('.cmd', '.ps1')):
                        assert b'\n' not in archive.read(member).replace(b'\r\n', b''), member
            else:
                for member in names:
                    if member.endswith(('.command', '/pangzhu', '/cloudflared')):
                        assert (archive.getinfo(member).external_attr >> 16) & 0o111, member
        print('PASS:', name)
    with zipfile.ZipFile(dist / f'pangzhu-{version}-source.zip') as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            assert not any(p in {'data', '.data', '.updates', '.git', 'node_modules', 'dist', 'bin', '__pycache__'} for p in Path(name).parts)
            assert not any(s in name.lower() for s in ['owner.key', '.sqlite', '.ds_store'])
        assert 'RD/.github/workflows/release.yml' in archive.namelist()
        assert 'RD/internal/update/update.go' in archive.namelist()
    print('PASS: source allowlist and all SHA-256 checksums')


if __name__ == '__main__':
    main()

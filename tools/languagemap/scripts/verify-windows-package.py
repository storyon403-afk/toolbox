from pathlib import Path
import hashlib
import json
import struct
import zipfile

root=Path(__file__).resolve().parent.parent
results=[]
for architecture,machine in [('x64',0x8664),('arm64',0xaa64)]:
    package=root/f'dist/LanguageMap-1.1.0-Windows-{architecture}.zip'
    prefix=package.stem+'/'
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None, 'ZIP integrity failure'
        names=archive.namelist()
        assert all(name.startswith(prefix) and '..' not in Path(name).parts for name in names)
        assert not any(Path(name).name in ('records.json','records.previous.json') or 'before-import-' in Path(name).name for name in names), 'Personal library must not ship'
        manifest=json.loads(archive.read(prefix+'SHA256SUMS.json'))
        assert set(manifest)=={name.removeprefix(prefix) for name in names if name!=prefix+'SHA256SUMS.json'}
        for name,digest in manifest.items():
            assert hashlib.sha256(archive.read(prefix+name)).hexdigest()==digest, name
        executable=archive.read(prefix+'app/LanguageMap.exe')
        assert executable[:2]==b'MZ'
        pe=struct.unpack_from('<I',executable,0x3c)[0]
        assert executable[pe:pe+4]==b'PE\0\0'
        assert struct.unpack_from('<H',executable,pe+4)[0]==machine, 'Wrong executable architecture'
        assert struct.unpack_from('<H',executable,pe+24+68)[0]==2, 'Expected Windows GUI application'
        assets=list((root/'app/Web').iterdir())
        for asset in assets:
            assert archive.read(prefix+'app/Web/'+asset.name)==asset.read_bytes(), f'UI asset differs: {asset.name}'
        for test in ['fresh.js','smoke.js','reopen.js','quit.js','after-quit.js']:
            assert archive.read(prefix+'tests/'+test)==(root/'tests'/test).read_bytes()
        assert archive.read(prefix+'Install.ps1').startswith(b'\xef\xbb\xbf'), 'PowerShell UTF-8 BOM missing'
        results.append({'architecture':architecture,'zip_sha256':hashlib.sha256(package.read_bytes()).hexdigest(),'size_bytes':package.stat().st_size,'shared_ui_files':len(assets),'native_windows_execution_verified':False})
        print(f'PASS: {architecture} executable architecture, ZIP CRC, file hashes, {len(assets)} identical UI assets; no personal library')
(root/'.build/windows-package-validation.json').write_text(json.dumps(results,indent=2)+'\n')

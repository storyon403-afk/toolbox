"""Package only the published app and public files; never include the user's library."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
arch = sys.argv[1]
assert arch in ('x64', 'arm64')
name = f'LanguageMap-1.1.0-Windows-{arch}'
nuget = Path(os.environ.get('NUGET_PACKAGES', str(Path.home()/'.nuget/packages')))
with tempfile.TemporaryDirectory(prefix='languagemap-package-') as temporary:
    package = Path(temporary)/name
    package.mkdir()
    shutil.copytree(root/f'.build/windows-{arch}', package/'app')
    for path in (package/'app').glob('*'):
        if path.suffix in ('.pdb', '.xml'): path.unlink()
    for path in (root/'windows/packaging').iterdir():
        # UTF-8 BOM keeps Chinese paths and future messages safe in Windows PowerShell 5.1.
        if path.suffix in ('.ps1', '.cmd'):
            encoding = 'utf-8-sig' if path.suffix == '.ps1' else 'utf-8'
            (package/path.name).write_bytes(path.read_text().replace('\r\n','\n').replace('\n','\r\n').encode(encoding))
        else: shutil.copy2(path, package/path.name)
    (package/'architecture.txt').write_text(arch)
    shutil.copy2(root/'.build/tools/MicrosoftEdgeWebview2Setup.exe', package/'MicrosoftEdgeWebview2Setup.exe')
    tests=package/'tests';tests.mkdir()
    for name in ['fresh.js','smoke.js','reopen.js','quit.js','after-quit.js']:
        shutil.copy2(root/'tests'/name,tests/name)
    notices=package/'third-party-notices'; notices.mkdir()
    webview=nuget/'microsoft.web.webview2/1.0.4314.35'
    for name in ['LICENSE.txt','NOTICE.txt']:
        shutil.copy2(webview/name,notices/f'WebView2-{name}')
    runtime=nuget/f'microsoft.netcore.app.runtime.win-{arch}/10.0.14'
    for name in ['LICENSE.TXT','THIRD-PARTY-NOTICES.TXT']:
        shutil.copy2(runtime/name,notices/f'DotNet-{name}')
    shutil.copy2(nuget/f'microsoft.windowsdesktop.app.runtime.win-{arch}/10.0.14/LICENSE',notices/'WindowsDesktop-LICENSE.txt')
    manifest={str(p.relative_to(package)).replace(os.sep,'/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(package.rglob('*')) if p.is_file()}
    (package/'SHA256SUMS.json').write_text(json.dumps(manifest,indent=2)+'\n')
    output=root/f'dist/LanguageMap-1.1.0-Windows-{arch}.zip'
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for p in sorted(package.rglob('*')):
            if p.is_file(): archive.write(p,str(p.relative_to(package.parent)))
    print(f'Built: {output} ({output.stat().st_size/1024/1024:.1f} MiB)')
    print('SHA-256:',hashlib.sha256(output.read_bytes()).hexdigest())

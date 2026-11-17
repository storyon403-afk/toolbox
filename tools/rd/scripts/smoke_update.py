#!/usr/bin/env python3
"""Exercise native staged-version dispatch with temporary data and no network."""
import json
from pathlib import Path
import platform
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent

def main():
    goos = {'Darwin': 'darwin', 'Windows': 'windows', 'Linux': 'linux'}[platform.system()]
    arch = subprocess.check_output(['go', 'env', 'GOARCH'], text=True).strip()
    suffix = '.exe' if goos == 'windows' else ''
    with tempfile.TemporaryDirectory(prefix='pangzhu-update-smoke-') as tmp:
        install = Path(tmp) / 'Install with spaces'
        install.mkdir()
        current = install / '.updates/v0.2.0'
        current.mkdir(parents=True)
        for folder, version in [(install, '0.1.0'), (current, '0.2.0')]:
            subprocess.run(['go', 'build', '-buildvcs=false', '-ldflags=-X pangzhu/internal/update.Version=' + version, '-o', str(folder / ('pangzhu' + suffix)), './cmd/pangzhu'], cwd=ROOT, check=True)
        (current / ('cloudflared' + suffix)).write_text('unused fixture')
        manifest = dict(version='0.2.0', repository='storyon403-afk/RD', os=goos, arch=arch)
        (current / 'release.json').write_text(json.dumps(manifest))
        (install / '.updates/current.json').write_text(json.dumps(manifest))
        binary = str(install / ('pangzhu' + suffix))
        output = subprocess.check_output([binary, '--version'], text=True)
        assert 'Pangzhu 0.2.0 ' in output, output
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if goos == 'windows' else {}
        process = subprocess.Popen([binary, '--port', str(port), '--updates', 'off'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **options)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise AssertionError(process.stdout.read())
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/review/api/health', timeout=1) as response:
                        assert json.load(response)['instance']
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise AssertionError('service did not become ready')
            assert (install / 'data').is_dir(), 'data moved away from original installation'
            assert not (current / 'data').exists(), 'update split the database'
            assert not (install / '.updates/state.json').exists(), 'off mode performed an update check'
        finally:
            if process.poll() is None:
                process.send_signal(signal.CTRL_BREAK_EVENT if goos == 'windows' else signal.SIGTERM)
            try:
                output = process.communicate(timeout=20)[0]
            except subprocess.TimeoutExpired:
                process.kill()
                output = process.communicate()[0]
                raise AssertionError('dispatch did not stop on signal: ' + output)
        assert process.returncode == 0, output
        # The same original launcher must remain usable after restart.
        assert 'Pangzhu 0.2.0 ' in subprocess.check_output([binary, '--version'], text=True)
        print('PASS: version dispatch, argument forwarding, original data directory, off mode and graceful shutdown')

if __name__ == '__main__':
    main()

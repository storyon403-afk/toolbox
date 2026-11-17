#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for source in app/Web/*.js; do node --check "$source"; done
node --test tests/*.test.cjs
mkdir -p .build
xcrun swiftc -swift-version 6 app/Store.swift tests/StoreTests.swift -o .build/store-tests
.build/store-tests
bash scripts/build.sh
python3 - <<'PY'
import subprocess, tempfile
from pathlib import Path
root = Path.cwd()
test_dir = Path(tempfile.mkdtemp(prefix='LanguageMap-smoke-'))
app = root / 'dist/LanguageMap.app/Contents/MacOS/LanguageMap'
for test in ['fresh.js', 'smoke.js', 'reopen.js', 'quit.js', 'after-quit.js']:
    result = subprocess.run([str(app), '--self-test', str(test_dir), str(root/'tests'/test)], timeout=60, text=True, capture_output=True)
    print(result.stdout)
    if result.returncode:
        print(result.stderr)
        raise SystemExit(result.returncode)
    if test != 'quit.js':
        (root/'.build'/f'{test}.png').write_bytes((test_dir/'screenshot.png').read_bytes())
print(f'Test-only records: {test_dir}')
PY

#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DOTNET="${LANGUAGEMAP_DOTNET:-$ROOT/.build/dotnet/dotnet}"
if [[ ! -x "$DOTNET" ]]; then DOTNET="$(command -v dotnet)"; fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
mkdir -p .build/interop
"$DOTNET" run --project windows/LanguageMap.Tests -c Release -- tests/fixtures/cross-platform.json
xcrun swiftc -swift-version 6 app/Store.swift tests/Interop.swift -o .build/interop/swift-roundtrip
.build/interop/swift-roundtrip tests/fixtures/cross-platform.json .build/interop/from-mac.json
"$DOTNET" run --project windows/LanguageMap.Tests -c Release -- roundtrip .build/interop/from-mac.json .build/interop/from-windows.json
.build/interop/swift-roundtrip .build/interop/from-windows.json .build/interop/returned-to-mac.json
python3 - <<'PY'
from pathlib import Path
import json
original=json.loads(Path('tests/fixtures/cross-platform.json').read_text())
for name in ['from-mac','from-windows','returned-to-mac']:
    actual=json.loads(Path(f'.build/interop/{name}.json').read_text())
    assert actual==original, f'{name} lost data'
print('PASS: Mac → Windows → Mac: all dates, words, definitions, coordinates, connections, detached branches and preferences match exactly')
PY

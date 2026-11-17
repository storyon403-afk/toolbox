#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ARCH="${1:-x64}"
case "$ARCH" in x64|arm64) ;; *) echo 'Usage: bash scripts/build-windows.sh [x64|arm64]' >&2; exit 2;; esac
DOTNET="${LANGUAGEMAP_DOTNET:-$ROOT/.build/dotnet/dotnet}"
if [[ ! -x "$DOTNET" ]]; then DOTNET="$(command -v dotnet)"; fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
"$DOTNET" publish windows/LanguageMap.Windows/LanguageMap.Windows.csproj -c Release -r "win-$ARCH" \
  --self-contained true -p:RestoreLockedMode=true -p:DebugType=None -o "$ROOT/.build/windows-$ARCH"
mkdir -p .build/tools dist
if [[ ! -f .build/tools/MicrosoftEdgeWebview2Setup.exe ]]; then
  curl -fL --retry 2 https://go.microsoft.com/fwlink/p/?LinkId=2124703 -o .build/tools/MicrosoftEdgeWebview2Setup.exe
fi
python3 scripts/package-windows.py "$ARCH"

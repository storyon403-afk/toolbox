#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/LanguageMap.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Web" "$ROOT/.build"
xcrun swiftc -O -whole-module-optimization -swift-version 6 -target arm64-apple-macosx13.0 \
  "$ROOT/app/Store.swift" "$ROOT/app/Main.swift" -framework AppKit -framework WebKit \
  -o "$APP/Contents/MacOS/LanguageMap"
cp "$ROOT/app/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/app/Web/"* "$APP/Contents/Resources/Web/"
xcrun swift "$ROOT/scripts/Icon.swift" "$ROOT/.build/LanguageMap.iconset"
iconutil -c icns "$ROOT/.build/LanguageMap.iconset" -o "$APP/Contents/Resources/LanguageMap.icns"
codesign --force --sign - --options runtime "$APP"
codesign --verify --deep --strict "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/dist/LanguageMap-1.0.0-macOS-arm64.zip"
echo "Built: $APP"

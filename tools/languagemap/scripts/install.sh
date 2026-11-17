#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/dist/LanguageMap.app"
DEST="$HOME/Applications/LanguageMap.app"
BIN="$HOME/.local/bin"
if [[ ! -d "$SOURCE" ]]; then bash "$ROOT/scripts/build.sh"; fi
if pgrep -f "$DEST/Contents/MacOS/LanguageMap" >/dev/null; then
  echo '请先正常退出已安装的 LanguageMap，再安装更新。' >&2; exit 1
fi
codesign --verify --deep --strict "$SOURCE"
mkdir -p "$HOME/Applications" "$BIN"
STAGING="$(mktemp -d "$HOME/Applications/.languagemap-install.XXXXXX")"
trap 'rmdir "$STAGING" 2>/dev/null || true' EXIT
ditto "$SOURCE" "$STAGING/LanguageMap.app"
if [[ -e "$DEST" ]]; then
  mv "$DEST" "$HOME/Applications/LanguageMap.previous.$(date +%Y%m%d%H%M%S).app"
fi
mv "$STAGING/LanguageMap.app" "$DEST"
cat > "$BIN/languagemap" <<'LAUNCHER'
#!/bin/sh
APP="$HOME/Applications/LanguageMap.app"
case "${1:-}" in
  --version|-v) echo 'LanguageMap 1.0.0';;
  --help|-h) printf '%s\n' 'LanguageMap — 本机离线词网' 'languagemap             打开应用' 'languagemap --data-dir  显示资料目录' 'languagemap --version   显示版本';;
  --data-dir) printf '%s\n' "$HOME/Library/Application Support/LanguageMap";;
  '') if [ ! -d "$APP" ]; then echo "应用不存在：$APP" >&2; exit 1; fi; exec /usr/bin/open "$APP";;
  *) echo '未知参数。请使用 languagemap --help。' >&2; exit 2;;
esac
LAUNCHER
chmod 755 "$BIN/languagemap"
if ! /bin/zsh -lic 'command -v languagemap >/dev/null' >/dev/null 2>&1; then
  if [[ -f "$HOME/.zprofile" ]]; then cp -p "$HOME/.zprofile" "$HOME/.zprofile.languagemap-backup-$(date +%Y%m%d%H%M%S)"; fi
  printf '\n# LanguageMap user commands\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zprofile"
fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
echo "Installed: $DEST"
echo "Command: languagemap"

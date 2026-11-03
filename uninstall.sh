#!/bin/bash
# FreeDictate uninstaller. Keeps the speech model and Homebrew packages unless --purge.
set -uo pipefail

LABEL="dev.freedictate.whisper-server"
OLD_LABEL="com.owen.whisper-server"  # legacy label from pre-rename installs
MODEL="$HOME/.local/share/whisper/ggml-large-v3-turbo-q5_0.bin"
HS_DIR="$HOME/.hammerspoon"
INIT="$HS_DIR/init.lua"
UID_NUM="$(id -u)"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$*"; }

say "Stopping the speech engine"
for l in "$LABEL" "$OLD_LABEL"; do
  launchctl bootout "gui/$UID_NUM/$l" 2>/dev/null && ok "Stopped $l"
  rm -f "$HOME/Library/LaunchAgents/$l.plist"
done

say "Removing Hammerspoon wiring"
rm -f "$HS_DIR/freedictate.lua"
[ -L "$HS_DIR/dictate.lua" ] && rm -f "$HS_DIR/dictate.lua"
if [ -f "$INIT" ]; then
  sed -i '' -e '/require("freedictate")/d' -e '/require("dictate")/d' "$INIT"
  ok "Cleaned init.lua (left require(\"hs.ipc\") and your other config alone)"
fi
command -v hs >/dev/null 2>&1 && hs -c 'hs.reload()' >/dev/null 2>&1 || true

rm -f "$HOME/Library/Logs/freedictate-whisper-server.log"

if [ "$PURGE" = 1 ]; then
  say "Purging model and checkout"
  rm -f "$MODEL" && ok "Removed model"
  [ -d "$HOME/.freedictate" ] && rm -rf "$HOME/.freedictate" && ok "Removed ~/.freedictate"
else
  ok "Kept speech model at $MODEL (use --purge to remove)"
fi

echo
say "FreeDictate removed. Hammerspoon, whisper-cpp and ffmpeg were left installed:"
echo "    brew uninstall whisper-cpp ffmpeg && brew uninstall --cask hammerspoon"

#!/bin/bash
# FreeDictate installer — idempotent; safe to re-run.
#   From a clone:  ./install.sh
#   One-liner:     curl -fsSL https://raw.githubusercontent.com/owenmonagan/freedictate/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/owenmonagan/freedictate.git"
CLONE_DIR="$HOME/.freedictate"
LABEL="dev.freedictate.whisper-server"
OLD_LABEL="com.owen.whisper-server"  # legacy label from pre-rename installs; migration only
MODEL_NAME="ggml-large-v3-turbo-q5_0.bin"
MODEL_DIR="$HOME/.local/share/whisper"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"
AGENTS="$HOME/Library/LaunchAgents"
HS_DIR="$HOME/.hammerspoon"
INIT="$HS_DIR/init.lua"
UID_NUM="$(id -u)"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Platform ──────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || die "FreeDictate runs on macOS only."
case "$(uname -m)" in
  arm64)  ok "macOS on Apple Silicon" ;;
  x86_64) ok "macOS on Intel" ;;
  *)      die "Unsupported architecture: $(uname -m)" ;;
esac

# ── Locate the repo (clone if piped from curl) ────────────────────────────
DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -z "$DIR" ] || [ ! -f "$DIR/app/dictate.lua" ]; then
  say "Fetching FreeDictate into $CLONE_DIR"
  command -v git >/dev/null || die "git not found. Run: xcode-select --install"
  if [ -d "$CLONE_DIR/.git" ]; then
    git -C "$CLONE_DIR" pull --ff-only --quiet && ok "Updated"
  else
    git clone --quiet --depth 1 "$REPO_URL" "$CLONE_DIR" && ok "Cloned"
  fi
  DIR="$CLONE_DIR"
fi
ok "Using $DIR"

# ── Homebrew + dependencies ───────────────────────────────────────────────
say "Checking dependencies"
if ! command -v brew >/dev/null; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done
fi
command -v brew >/dev/null || die "Homebrew is required. Install it from https://brew.sh and re-run."
BREW="$(brew --prefix)"
ok "Homebrew at $BREW"

for f in whisper-cpp ffmpeg; do
  if brew list --formula "$f" >/dev/null 2>&1; then ok "$f already installed"
  else say "Installing $f"; brew install "$f"; ok "$f installed"; fi
done
if [ -d /Applications/Hammerspoon.app ] || brew list --cask hammerspoon >/dev/null 2>&1; then
  ok "Hammerspoon already installed"
else
  say "Installing Hammerspoon"; brew install --cask hammerspoon; ok "Hammerspoon installed"
fi
[ -x "$BREW/bin/whisper-server" ] || die "whisper-server not found at $BREW/bin (try: brew reinstall whisper-cpp)"

# ── Speech model ──────────────────────────────────────────────────────────
mkdir -p "$MODEL_DIR"
if [ -s "$MODEL_DIR/$MODEL_NAME" ]; then
  ok "Model already downloaded"
else
  say "Downloading speech model (~550 MB, one time)"
  curl -fL --progress-bar -o "$MODEL_DIR/$MODEL_NAME.part" "$MODEL_URL"
  mv "$MODEL_DIR/$MODEL_NAME.part" "$MODEL_DIR/$MODEL_NAME"
  ok "Model saved to $MODEL_DIR"
fi

# ── Speech engine LaunchAgent ─────────────────────────────────────────────
say "Setting up the speech engine"
mkdir -p "$AGENTS" "$HOME/Library/Logs"
PLIST="$AGENTS/$LABEL.plist"
RENDERED="$(mktemp)"
sed -e "s|__HOME__|$HOME|g" -e "s|__BREW__|$BREW|g" "$DIR/launchd/$LABEL.plist.template" > "$RENDERED"
plutil -lint "$RENDERED" >/dev/null || die "Rendered LaunchAgent plist is invalid"

# Legacy migration: always retire the pre-rename agent (it binds the same port).
OLD_WAS_RUNNING=0
if launchctl print "gui/$UID_NUM/$OLD_LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_NUM/$OLD_LABEL" 2>/dev/null || true
  OLD_WAS_RUNNING=1
  ok "Stopped old agent $OLD_LABEL"
fi
rm -f "$AGENTS/$OLD_LABEL.plist"

if ! cmp -s "$RENDERED" "$PLIST" || ! launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  cp "$RENDERED" "$PLIST"
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$PLIST"
  ok "Speech engine started ($LABEL)"
elif [ "$OLD_WAS_RUNNING" = 1 ]; then
  # Old agent may have held the port; restart the new one so it can bind.
  launchctl kickstart -k "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  ok "Speech engine restarted ($LABEL)"
else
  ok "Speech engine already running"
fi
rm -f "$RENDERED"

# ── Hammerspoon config ────────────────────────────────────────────────────
say "Wiring up Hammerspoon"
mkdir -p "$HS_DIR"
ln -sfn "$DIR/app/dictate.lua" "$HS_DIR/freedictate.lua"
[ -L "$HS_DIR/dictate.lua" ] && rm -f "$HS_DIR/dictate.lua"   # legacy symlink
touch "$INIT"
grep -q 'require("hs.ipc")' "$INIT" || echo 'require("hs.ipc")' >> "$INIT"
if grep -q 'require("freedictate")' "$INIT"; then
  ok "init.lua already loads FreeDictate"
elif grep -q 'require("dictate")' "$INIT"; then
  sed -i '' 's|require("dictate")\.start()|require("freedictate").start()|; s|require("dictate")|require("freedictate")|' "$INIT"
  ok "Updated init.lua (dictate → freedictate)"
else
  echo 'require("freedictate").start()' >> "$INIT"
  ok "Added FreeDictate to init.lua"
fi

# ── Launch ────────────────────────────────────────────────────────────────
open -a Hammerspoon
if command -v hs >/dev/null 2>&1; then hs -c 'hs.reload()' >/dev/null 2>&1 || true; fi

echo
say "FreeDictate is installed."
echo "    Grant Hammerspoon Accessibility + Microphone access when asked,"
echo "    then choose your button in the setup window. Hold it, talk, let go."

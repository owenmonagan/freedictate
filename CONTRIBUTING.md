# Contributing to FreeDictate

Thanks for helping. FreeDictate's whole point is that there is nothing to configure, so
the bar for new features is high and the bar for fixes is low.

## Good contributions

- Bug fixes, especially permission, audio-device and paste edge cases
- Reliability and speed improvements
- Docs and install fixes

Before building a new feature or setting, open an issue so we can talk about whether it
fits the one-button idea.

## Development

1. Fork and clone, then run `./install.sh` (it symlinks `app/dictate.lua` into `~/.hammerspoon`).
2. Edit, then reload Hammerspoon's config to test.
3. UI follows `design/DESIGN.md` and `design/MOTION.md`; use values from `design/tokens.css`.
4. The site lives in `site/` and is plain HTML/CSS/JS. Open `site/index.html` to preview.

## Pull requests

- Keep them small and focused, and describe how you tested.
- Never add network calls that send audio or text off the machine.

By contributing you agree your work is licensed under the MIT License.

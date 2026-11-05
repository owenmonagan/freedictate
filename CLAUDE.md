# FreeDictate

One-button, free, offline dictation for Mac. Install it, pick your button, hold it and talk, let go, and your words are pasted into whatever app has focus. It's an open-source Wispr Flow alternative.

- Repo: github.com/owenmonagan/freedictate (public, MIT). Site: https://owenmonagan.github.io/freedictate/. GitHub Pages deploys `site/` on every push to `main` (`.github/workflows/pages.yml`).
- Commits use the GitHub noreply email that is set in the repo's git config. Never commit a personal email, `/Users/<name>` paths, or anything tied to Owen's other companies.

## Pitch and positioning (keep every surface on-message)
- **Brand line:** "Free voice to text that works everywhere." The category is voice to text / speech to text for Mac.
- **Three reasons, in this order: Consistent. Free. Open source.**
  - Consistent: one button and the same Whisper large-v3 turbo accuracy in every app (Mail, Slack, editors, terminals), unlike dictation built into one tool (Apple Dictation, Claude Code's own voice input).
  - Free: no subscription, no word limit, no account, no pro tier.
  - Open source: MIT. Anyone can check that nothing leaves the Mac (whisper.cpp runs on-device).
- "AI" means AI speech recognition (OpenAI's Whisper, on-device). Never imply AI rewriting or editing: FreeDictate types what you said.
- Comparisons stay structural ("works in every app") until a dated side-by-side test backs an accuracy claim.
- SEO targets: ai voice to text mac, ai dictation mac, voice to text mac, speech to text mac free, free dictation app mac, free wispr flow alternative, offline speech to text mac, push to talk dictation mac, open source dictation mac, superwhisper alternative free, mouse button dictation.
- Competitors (Wispr Flow, Superwhisper, VoiceInk) sell features, modes and AI. We win on $0 plus zero configuration. Keep claims about them general and defensible.

## How it works
- `app/dictate.lua` is a Hammerspoon module, symlinked to `~/.hammerspoon/freedictate.lua`, and `init.lua` calls `require("freedictate").start()`.
- The talk key can be any key, combo, modifier, or the middle/back/forward mouse button. **Tap** to start and tap again to stop, or **hold** and release (the threshold is 0.35s). Esc cancels.
- ffmpeg records 16 kHz mono to `$TMPDIR/freedictate.wav`, with `astats` driving the level meter at about 15 Hz. The audio is posted to whisper-server at `127.0.0.1:8178` (LaunchAgent `dev.freedictate.whisper-server`, model `~/.local/share/whisper/ggml-large-v3-turbo-q5_0.bin`). If the server is down it falls back to whisper-cli. The text is pasted with ⌘V and the clipboard is restored afterwards.
- `app/hud/` is the recording pill, a transparent borderless `hs.webview`. `app/onboarding/` is the setup window (Welcome → Mic → Accessibility → Speech engine → Start at login → Your button → **Try it** live test). The JS↔Lua contract is in `design/DESIGN.md` §8: `setState`, `setLevel`, `EXIT_MS`, `onInit`, `onKeyChanged`, `onDictation`, `onLevel`, and the `dictate` message handler.
- `install.sh` and `uninstall.sh` are portable. They detect the Homebrew prefix and render the plist from `launchd/*.template`.

## Dev loop
- Reload Hammerspoon with `hs -t 3 -c 'hs.timer.doAfter(0.5, hs.reload)'`. A plain `hs -c 'hs.reload()'` hangs.
- Syntax check: `hs -c 'local f,e=loadfile("app/dictate.lua"); return tostring(f~=nil).." "..tostring(e)'` (there's no luac on this machine).
- Preview a HUD state without recording: `hs -c 'require("freedictate").preview("done",{text="Hi"})'`. Open setup: `require("freedictate").showOnboarding()`.
- Browser previews: `app/hud/preview.html`, and `app/onboarding/index.html`, which runs a simulator via `window.__sim` when `window.webkit` is missing.

## Brand: FD-1, Apple-like (not Realize, not Layup)
The source of truth is `design/tokens.css`, copied into `app/hud/`, `app/onboarding/` and `site/`. Change all copies together. The full spec is in `design/DESIGN.md`, the motion spec in `design/MOTION.md`, and the reasoning in `design/decisions.md`.

- **Type:** the system SF Pro stack (`-apple-system`, "SF Pro Display" for headings, "SF Mono" for code). Hero `clamp(44px,7vw,80px)` with -0.022em tracking. Body 13–17px. Weights 400/510/590/700.
- **Concept:** FreeDictate is drawn as one machined object: bead-blast aluminum, engraved graphite, one key, one light.
- **The signal rule:** orange (`--record`) means the mic is live. It is never decoration, never a text accent. Buttons are graphite pills.
- **Color:**

| Token | Light | Dark |
|---|---|---|
| bg / elevated | `#E6E7E9` / `#F7F7F8` | `#141518` / `#1C1D20` |
| label / 2 / 3 | `#1D1E21` / `#55585E` / `#6B6E75` | `#F2F2F4` / `#A3A7AF` / `#7C8088` |
| accent (buttons) | `#1D1E21` graphite | `#F2F2F4` |
| record (signal) | `#FF5B14` | `#FF6A2B` |
| success | `#2FBF71` | `#3DDC84` |
| warning | `#F0A01A` | `#FFB020` |
| aluminum | `--alu-1 #F7F7F8` to `--alu-2 #D3D5D8`, edge `#B7B9BE` | `#3A3C42` to `#232428` |

- **HUD:** always dark graphite `rgba(24,25,28,.92)` with a 0.5px white hairline, 40px tall, 20px radius, `--shadow-hud`, and a warm glow behind it that follows the voice level. The light: hollow ring = starting, solid orange = listening, green = pasted, amber = nothing heard or error, gray = cancelled. Real `backdrop-filter` can't see the desktop through a transparent WKWebView.
- **Anti-slop rules:** sentence-case labels like engraved hardware legends. No tracked all-caps eyebrows, no mono labels except real code or timecode, no "A · B · C" strings, no gradient text, no one-word colored headline accents, no identical card grids, no emoji. Put boldness in one place (the key).
- **Glass (site and onboarding):** `rgba(255,255,255,.62)` light or `rgba(30,30,32,.58)` dark, with `blur(30px) saturate(180%)` and a 0.5px border.
- **Space:** a 4pt scale (4 to 128). **Radius:** 6, 8, 12, 18, 26, and pill.
- **Motion:** durations are micro 140ms, small 240ms, enter 280ms, morph 300ms, large 420ms, and exit 180ms. Exits are faster than enters.
  - Easing: standard `cubic-bezier(0.2,0,0,1)`, enter `cubic-bezier(0.16,1,0.3,1)`, exit `cubic-bezier(0.4,0,1,1)`.
  - Springs use CSS `linear()`. `--spring-morph` is critically damped. `--spring-snappy` overshoots by 2% and is for success only.
  - Animate only transform and opacity. Every surface honors `prefers-reduced-motion` by crossfading instead and stepping the meter.
- **Voice:** short, plain, confident. No emoji in the UI. The product name is always written "FreeDictate".

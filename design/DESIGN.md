# Dictate: Design Spec (committee-final)

Status: final, chaired resolution of the 5-role committee (Visual/Brand, Motion, Interaction/UX, Copy, Engineering realist). Conflicts and reasons are in `decisions.md`. Motion detail is in `MOTION.md`. Every value comes from `tokens.css`.

## 1. Principles
1. **It is part of macOS.** The look is quiet system chrome: SF Pro, neutral grays, hairlines and one blue accent. No brand color, no gradients used as decoration, no emoji.
2. **One object that changes shape.** The HUD is a single capsule that morphs between states, in the manner of Dynamic Island. It is never several popups.
3. **Red means the mic is live.** `--record` appears only while audio is being captured. Errors use amber.
4. **Status, not settings.** The HUD never shows a model name, a mode name, "whisper", ms or Hz.
5. **Never steal focus and never delay the paste.** Paste fires when the HUD enters `done`, so animations never hold up text.
6. **Honest claims.** We say only what the architecture makes true (see 5.9).
7. **Motion is restrained and never the only signal.** Every state has a label, a glyph and a color. Reduced Motion swaps movement for crossfades.

## 2. Tokens
`tokens.css` covers type, light and dark color, glass, the HUD material, 4pt spacing, radii, shadows and motion. The rules:
- `--accent` is used only for interactive elements. Status colors are for glyphs only and are never large fills.
- **HUD glass is faked.** It uses `--hud-bg` rgba(28,28,30,.78), the inset hairline `--hud-hairline` and `--shadow-hud`. The HUD never uses `backdrop-filter`, because a transparent WKWebView cannot blur the desktop behind it.
- Real `backdrop-filter: var(--glass-blur)` is used only on the site, the demo and the onboarding nav. The blur radius is never animated. Fade the opacity of the layer instead.
- Contrast must be measured in the build against WCAG AA: 4.5:1 for body text and 3:1 for large text and glyphs.

## 3. HUD (`app/hud/hud.html`)
### 3.1 Window and anatomy
- **Lua window:** 320×96 transparent, borderless, nonactivating, overlay level, ignores the mouse. It is centered, with its bottom edge 48px above the bottom of `screen:frame()`. That puts the visible capsule about 76px above the bottom. The 20px of slack on each side absorbs the shake, the overshoot and the shadow. The contract says "approx 280x72"; the page must lay out correctly in any viewport of at least 280×72.
- **Page:** `html,body{background:transparent;margin:0;overflow:hidden}`. The capsule is centered in the viewport both ways.
- **Capsule:** height `--hud-h` (40px), radius 20px. It is built from 3 compositor layers so the end caps never stretch:
  - a left cap, 20px wide
  - a center slab animated with `scaleX`
  - a right cap animated with `translateX`
  - a content layer above them, which is never scaled
- **Content layout:** padding 0 14px with `--s2` (8px) gaps. Three zones: leading glyph (16px box), center (meter or label) and trailing (optional).
- **Text:** `--fs-body` (13px) at `--fw-medium` in `--hud-fg`, with `font-variant-numeric: tabular-nums` and a single line using `white-space:nowrap; text-overflow:ellipsis`.
- **Accessibility:** a visually hidden `role="status" aria-live="polite"` node mirrors the state label.

### 3.2 States
| State | Width | Leading | Center | Trailing |
|---|---|---|---|---|
| `hidden` | (window hidden) | | | |
| `listening` (pending, before mode is known, or no mode given) | 176 | 8px `--hud-record` dot | 7-bar meter | none |
| `listening`, `mode:'hold'` | 176, capsule `scale(.97)` "pressed" | 8px red dot | 7-bar meter | none |
| `listening`, `mode:'tap'` | 216 | 8px red dot + 10px lock glyph (1.5px stroke, `--hud-fg-2`), 4px apart | 7-bar meter | "esc" keycap: 11px `--fw-semibold`, `--hud-fg-2`, 1px border rgba(255,255,255,.22), radius 4px, padding 1px 5px |
| `transcribing` | 168 | 14px spinner: 2px-stroke 270° arc in `--hud-fg-2` | "Transcribing…" with shimmer | none |
| `done`, text present | fits content, clamped to 120–264 | 16px check, stroke `--hud-success`, drawn | "Pasted" in `--hud-fg`, then " · " and a preview in `--hud-fg-2` | none |
| `done`, empty or whitespace text | 148 | 14px open circle in `--hud-fg-3` (no check) | "Nothing heard" in `--hud-fg-2` | none |
| `cancelled` | 132 | 12px × glyph in `--hud-fg-2` | "Cancelled" in `--hud-fg-2` | none |
| `error` | fits content, at most 264 | 14px triangle-exclamation in `--hud-warning` | message, 1 line, ellipsized | none |

**Done preview.** Take the first 24 characters of `payload.text` after trimming and collapsing whitespace. If the text is longer, cut back to the last word boundary and append "…". Wrap it in curly quotes: `Pasted · "Let's meet at four…"`. Measure the width once, before the morph starts, never per frame.

**Meter.** 7 bars, each 3px wide with a 3px gap, radius 1.5px, color `--hud-fg` at .92 opacity. Each bar is a fixed 24px high and animated with `transform: scaleY` only. The rest height is 4px (scaleY ≈ .17). There is no idle animation. See `MOTION.md` §3.

**Error copy.** Lua passes `payload.message`. If it is missing, the page shows "Something went wrong". Canonical messages, which Lua should send:

| Cause | message |
|---|---|
| server down | Can't reach speech engine — restart it from the menu bar |
| mic denied / no input | Microphone access needed — allow it in Settings |
| no speech | (use `done` with empty text → "Nothing heard", not an error) |
| paste failed (no Accessibility) | Copied instead — press ⌘V to paste |
| generic | Something went wrong — try again |

The message is one line, ellipsized at 264px. The full string goes into the aria-live node. **Engine requirement:** on paste failure Lua must *skip* the clipboard restore, so "Copied instead" is true.

**No hint lines in the HUD.** Hint copy ("Release to finish" and "Tap again to finish") lives in onboarding. The 40px capsule is one line.

### 3.3 Lifecycle and timing (Lua side)
- **Startup:** create the webview once and load it once. Warm it up with `:alpha(0)`, show, then hide. Afterwards use only show and hide plus `evaluateJavaScript`.
- **Key down:** `:show()` and `setState('listening')` in the same tick. Mode is pending.
- **At the 0.35s hold threshold:** send `setState('listening',{mode:'hold'})`. If the key was released before 0.35s, it was a tap: send `setState('listening',{mode:'tap'})`. The page retargets in place and never re-enters.
- **While listening:** `setLevel(x)` at ≤15Hz, rounded to 2 decimals, and skipped if the change is under 0.02.
- **Stop:** send `setState('transcribing')`. When the paste completes, send `setState('done',{text})`. Then wait `0.7s` if there is text, or `0.42s` for empty text, and send `setState('hidden')`. Then `hs.timer.doAfter(EXIT_MS/1000 + 0.03, hide window)`. Cancel that timer if any new state arrives.
- **Esc:** send `setState('cancelled')`, then `setState('hidden')` after 0.5s, then hide after EXIT_MS.
- **Error:** send `setState('error',{message})`, then `setState('hidden')` after 2.4s, then hide after EXIT_MS.
- `window.EXIT_MS = 200` is a single constant and covers every exit in both motion modes.
- **Fallback:** if `hs.webview` is missing or `didFail`, use the existing `hs.canvas` pill with a static dot and a text label, without motion.

### 3.4 Menubar
- **Icons:** template images (monochrome SF-style mic, built from an inline SVG via `hs.image`), with no emoji and no animation.
  - Idle: outline mic.
  - Listening: filled mic with a 4px red badge dot.
  - Transcribing: mic with an ellipsis.
  - Error: mic with a slash, shown for 5s.
- **Swap rate:** the icon swaps at most once per second.
- **Menu items:**
  - `Dictate: Ready`, `Dictate: Listening` or `Dictate: Transcribing…` (disabled title)
  - `Talk key: <label>` (disabled)
  - `Change Talk Key…`
  - separator
  - `Speech engine: Running` or `Speech engine: Not running` (disabled)
  - `Restart Speech Engine`
  - separator
  - `Set Up Dictate…`
  - `Quit Dictate`

## 4. Onboarding (`app/onboarding/index.html`, 760×560 titled window)
### 4.1 Layout
- **Page:** body is `--bg`, with a centered 520px content column.
- **Top bar:** a 32px top bar holding a progress label in `--fs-footnote` `--label-3`, reading "Step N of 5", plus 5 dots (6px; the active dot is `--accent`).
- **Content:**
  - Header: a 56px app glyph, then the H1 in `--fs-title2`, `--fw-bold`, `--track-title`.
  - Body text: `--fs-callout`, `--label-2`, max 46ch.
- **Grouped card:** for permission and key rows. `--bg-elevated`, `--r-md`, hairline separators, rows 52px tall with `0 var(--s4)` padding.
- **Footer:** 56px, sticky, with a top hairline. Back on the left (secondary). The primary button is on the right, with a text link to its left when one applies.
- **Buttons:**
  - Size: 28px tall, `0 14px` padding, `--r-sm`, `--fs-body` `--fw-medium`.
  - Primary is `--accent` with `--on-accent` text. Secondary is `--fill` with `--label` text.
  - Every button has a visible `--focus-ring` on `:focus-visible`.
  - Press scales to 0.97.
- **Keys:** Return activates the primary button. Esc goes Back, except on step 1. Tab order follows the visual order.
- **Status glyphs:** a 20px leading glyph with three states. Pending is an empty circle in `--label-3`. Allowed is a filled check in `--success`. Missing is an amber dot in `--warning`, with a text label beside it, so color is never the only signal.

### 4.2 Loading, empty and error states
- **Before `onInit` arrives:** all content is shown with a status row reading "Checking setup…" (12px spinner).
- **Whenever `serverOk === false`:** show a persistent banner above the footer, styled as a `--fill` card with a `--warning` glyph. Text: "Speech engine isn't running. Restart it from the menu bar, then try again."
- **Standalone** (`window.webkit` undefined):
  - Simulate `onInit({keyLabel:'Right ⌥', serverOk:true, accessibility:false})` after 300ms.
  - `setKey` resolves `onKeyChanged('F5')` after 1.2s.
  - `openAccessibility` flips accessibility to true after 1.5s.
  - `close` logs to the console.

### 4.3 Steps and strings
**Step 1: Welcome**
- H1: "Talk instead of type."
- Body: "Hold a key, say what you mean, let go. Dictate types it into whatever you're working in. Everything stays on your Mac."
- Primary: **Get Started**

**Step 2: Microphone**
- H1: "Let Dictate hear you."
- Body: "Dictate only listens while you hold or tap your talk key. Audio never leaves this Mac."
- Row: "Microphone" with buttons **Test Microphone** (secondary) and **Open Microphone Settings** (secondary).
  - Without Lua, the page cannot verify the mic. The Test button calls `openMicrophone` only (the contract has no test action). The row shows "Allow Dictate under Privacy & Security → Microphone." and is never "Allowed".
  - Status text stays neutral: "macOS asks the first time you talk."
- Footnote: "Turn on Hammerspoon under Privacy & Security → Microphone."
- Primary: **Continue** (always enabled)

**Step 3: Accessibility**
- H1: "Let Dictate type for you."
- Body: "macOS needs Accessibility access so Dictate can paste into the app you're using. Your clipboard is put back afterward."
- Row: "Accessibility", status "Allowed" or "Not allowed yet", button **Open Accessibility Settings** (posts `openAccessibility`).
- Footnote: "Find Hammerspoon in the list and switch it on."
- Primary: **Continue** (always enabled). If not allowed, a note reads "You can finish this later from the menu bar."

**Step 4: Talk key**
- H1: "Choose your talk key."
- Body: "Any key, shortcut, modifier, or mouse button works."
- Keycap:
  - Size: 56px tall, min-width 72px, `--r-sm`, `--bg-elevated`, a 1px `--separator` border and an inset bottom of `0 -2px 0 var(--fill-2)`.
  - Label: `--fs-title3` `--fw-semibold`, showing the current `keyLabel`.
- Buttons:
  - **Change Key** (primary-secondary) posts `setKey`. While capturing, the button label reads "Press a key or mouse button…", is disabled, and the keycap shows a pulsing accent outline.
  - `onKeyChanged(label)` updates the keycap with a pop.
  - **Reset to Default** (text link) posts `resetKey`.
- Helper: "Avoid keys you type with. Right Option or a mouse side button work well."
- Three explainer chips (each also used as a hover tip):
  - "Tap: starts listening. Tap again to stop."
  - "Hold: listens while held. Release to finish."
  - "Esc: cancels. Nothing gets pasted."
- An embedded mini HUD sits under the chips, using the same component, driven by a simulated level. Hovering or focusing a chip plays that mode. With Reduced Motion it shows a static frame and a **Play** button.
- Primary: **Continue**

**Step 5: Try it**
- H1: "Give it a try."
- Body: "Click the box, then hold {key} and say something."
- Field: a 96px textarea, `--r-md`, `--fill` background, placeholder "Your words will appear here…".
- When `input` fires with non-empty text: show the success line "That's it. Dictate is ready." with a `--success` check.
- Primary: **Done**, which posts `close`. The secondary link **Skip** also posts `close`.

## 5. Marketing site (`site/index.html`, single page, offline, inline assets)
### 5.1 Global
- Page background `--bg`, max width 1080px. Side gutters are 24px, or 16px at ≤480px. No horizontal scroll at 375px.
- Section rhythm is `--s10`, or `--s8` on mobile. Light and dark both follow the system.
- **One CTA everywhere:** "Coming soon". It is a disabled-style pill (`--fill` background, `--label-2` text) with `aria-disabled="true"`. There is no form, since no list backend exists.

### 5.2 Nav
- 52px tall, sticky, with `--glass-bg` + `--glass-blur` and a bottom hairline.
- Wordmark "Dictate" in 17px `--fw-semibold`, then "for Mac" in `--label-3`.
- Anchors: How it works · Privacy · FAQ.
- Button: **Coming soon**.
- At ≤640px the anchors hide and only the wordmark and CTA remain.

### 5.3 Hero
- Eyebrow: "For Mac"
- H1: **"Speak. It types."**, set at `--fs-hero`, `--fw-bold`, `--track-hero`, `--lh-tight`, max-width 14ch, centered.
- Subhead: "Dictate turns your voice into text in any app. It runs entirely on your Mac, so nothing you say is ever uploaded." Set at `--fs-title3` in `--label-2`.
- CTA: **Coming soon**.
- **Demo window:** 720px wide (100% on mobile), `--bg-elevated`, `--r-lg`, `--shadow-window`, with a title bar of three 12px dots at 40% opacity.
  - Contents: a mock Notes document. The live HUD component sits at bottom-center, and text types itself into the document when the HUD reaches done.
  - Reduced Motion: a static frame with the done state and the text present, plus **Play demo**, **Pause** and **Replay** controls.

### 5.4 Benefits (3 tiles; 3 columns, 1 column under 760px)
Tile style: `--bg-elevated`, `--r-xl`, `--s6` padding, `--shadow-1`, a 28px line glyph in `--accent`, a 20px semibold title and 17px `--label-2` body.
1. **Private by design.** Speech is turned into text on your Mac. No account, no cloud, works offline.
2. **Fast enough to forget.** Your words land in the text field a moment after you stop talking.
3. **Tap or hold.** Hold to talk for quick bursts. Tap once to talk hands-free for longer thoughts.

### 5.5 How it works (`id="how"`)
H2: "Three steps. No new habits."
1. **Press your talk key.** Pick any key or mouse button.
2. **Say it.** Talk naturally. Pause, rephrase, keep going.
3. **It's pasted.** Your text appears where your cursor is.

### 5.6 See every state (interactive simulator, shared with `demo/`)
- H2: "See every state."
- Sub: "Hold the key to talk. Click it to tap. Press Esc to cancel."
- **Controls:** a large on-page keycap. A press longer than 350ms is a hold; a shorter press is a tap. Pointer and Space both work while the keycap is focused. Esc cancels.
- **Buttons:** **Start listening**, **Finish**, **Cancel**, **Simulate error**.
- **Sim error copy:** "Can't reach speech engine — restart it from the menu bar".

### 5.7 Works everywhere
- H2: "Works in every app you type in."
- Body: "Mail, Slack, Notes, your code editor, a browser form. If it has a cursor, Dictate can fill it."
- Visual: 4 generic category glyph cards (mail, chat, code, browser). No third-party logos.

### 5.8 Privacy (`id="privacy"`, full-bleed inverse band)
- Inverse colors: `--label` background with `--bg` text. This is the page's one dramatic moment.
- H2: "Your voice stays yours."
- Body: "Dictate uses an open-source speech model running on your own machine. Audio is processed and discarded. There's nothing to sign in to and nothing to sync."
- CTA: **Coming soon** (inverse style).

### 5.9 FAQ (`id="faq"`)
Built from `details`/`summary` with hairline separators and a visible focus ring.
- **Does it need the internet?** No. After setup, Dictate works fully offline.
- **Which Macs does it run on?** Apple silicon Macs running macOS 13 or later.
- **What happens to my clipboard?** Dictate pastes your text, then restores whatever you had copied.
- **How do I cancel?** Press Esc while listening. Nothing is pasted.
- **Can I use a mouse button?** Yes. Middle, back, and forward buttons all work as a talk key.
- **Is it free?** Pricing will be announced at launch.

### 5.10 Footer
- H2: "Stop typing what you could say."
- CTA: **Coming soon**.
- Text: "© 2026 Dictate. Made on a Mac."

**Claims we don't make:** no "4x", no accuracy %, no "100%", no latency number and no price claim. "Nothing leaves your Mac" is used because the only network call is to 127.0.0.1, which Engineering confirmed.

## 6. Demo page (`demo/index.html`)
- **Left:** the state simulator. Segmented controls cover every state × mode, plus a level slider (0–1), a text field for the done payload, a message field for error, a theme toggle and a reduced-motion toggle (forced via a class).
- **Right:** a mock Notes window with the HUD at bottom-center, at 320×96 real size.
- **"Play the story":** hold → transcribe → paste → tap → Esc cancel → server error.
- **Keyboard:** Space is the talk key and Esc cancels.
- **Shared code:** the demo, onboarding mini-HUD and site all embed the same HUD module (copied inline, since there is no build step and no CDN).

## 7. File layout
```
freedictate/
  app/dictate.lua, install.sh, uninstall.sh   (engine)
  launchd/dev.freedictate.whisper-server.plist.template
  app/hud/hud.html          app/onboarding/index.html
  demo/index.html           site/index.html
  design/{DESIGN.md,MOTION.md,tokens.css,decisions.md}
```

## 8. JS<->LUA CONTRACT (verbatim, fixed)
- HUD page app/hud/hud.html is loaded in a transparent borderless hs.webview (approx 280x72 px, bottom-center of main screen, ~60px above bottom). Background must be transparent (html,body background: transparent).
  Page exposes: window.setState(state, payload?) where state ∈ 'hidden'|'listening'|'transcribing'|'done'|'cancelled'|'error'; payload is optional {mode:'tap'|'hold', text?:string, message?:string}. window.setLevel(x) with x in 0..1 (called ~15Hz while listening). Lua hides the webview window itself ~after the page's exit animation; page must expose window.EXIT_MS (number, ms the hide/exit animation takes) so Lua knows when to hide.
- Onboarding page app/onboarding/index.html is shown in a normal titled hs.webview window (~760x560). It talks to Lua via window.webkit.messageHandlers.dictate.postMessage({action:'setKey'}|{action:'resetKey'}|{action:'close'}|{action:'openAccessibility'}|{action:'openMicrophone'}). Lua calls back window.onKeyChanged(label) after a key is captured, and window.onInit({keyLabel, serverOk:boolean, accessibility:boolean}) once the page loads. Page must work standalone in a normal browser (guard window.webkit undefined: simulate).
- No network/CDN dependencies in app/ pages (offline). Site may use only inline assets too.

Committee additions that do not change the contract:
- `window.EXIT_MS = 200`.
- Lua's window is 320×96 for slack. The page is viewport-agnostic, so 280×72 also works.
- The page may also expose `window.__dictateHud` for the demo and site to embed.

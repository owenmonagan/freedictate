# Dictate: Motion Spec

Sources: subframe.com/motion (interruption, Esc cancel, release-to-settle, reduced-motion stepping), Apple HIG Motion and Reduce Motion, WWDC23 "Animate with springs". The SwiftUI spring numbers are recalled from memory, not checked against the source. The `linear()` curves below are therefore the spec. Tokens are in `tokens.css`.

## 0. Rules
- Animate only `transform`, `opacity` and the check's `stroke-dashoffset`.
- Never animate `width`, `height`, `top`, `left`, `border-radius` or `backdrop-filter`.
- Width morph: the capsule has a left cap, a center slab and a right cap. Morph the slab with `scaleX(w-40)/basis` and the right cap with `translateX`. The content layer is never scaled.
- HUD motion stays at 300ms or less. Exits run at 60–75% of the matching enter. Cancel and error are faster than entrances and never bounce.
- The only overshoot anywhere is the 2% on the success check (`--spring-snappy`).
- **Interruption.** Every `setState` does four things:
  1. Read the current values of all running WAAPI animations (`getAnimations()` → `commitStyles()`).
  2. Cancel them.
  3. Start the new transition from those values.
  4. Coalesce calls under 16ms apart, so the last one wins.
- Nothing snaps back to the start. Input is never blocked.
- While listening, the meter is the only thing that moves.
- When `hidden`, cancel the rAF loop and pause CSS animations. The target is 0% CPU.

## 1. HUD state × transition matrix
Width W comes from DESIGN.md §3.2. "XF" means crossfade the content: outgoing opacity reaches 0 by 40% of the morph, and incoming starts at 30%.

| From → To | Trigger | Duration | Easing | Properties |
|---|---|---|---|---|
| hidden → listening | key down | 280ms (opacity 160ms) | `--spring-morph`; opacity `ease-out` | opacity 0→1, capsule scale .92→1, translateY 6→0. The bars rise from their 4px stub in 3 center-out groups, 30ms apart. |
| listening(pending) → listening·hold | 0.35s threshold | 140ms | `--ease-standard` | capsule scale 1→.97. No re-enter. |
| listening(pending) → listening·tap | release before 0.35s | 300ms morph; glyphs 140ms, 80ms delay | `--spring-morph` | Width 176→216. The lock glyph and the Esc keycap fade in (opacity 0→1, translateX 4→0). |
| listening → transcribing | release / 2nd tap | 300ms | `--spring-morph` | Width →168. Scale →1. The bars collapse to scaleY .17 and fade out over 0–120ms. The red dot fades out over 0–120ms. The spinner and label fade in over 90–270ms. The shimmer starts. |
| transcribing → done (text) | paste completed | 300ms morph | `--spring-snappy` for the check scale; `--spring-morph` for width | Width →fit. Spinner out by 120ms. The check is drawn by `stroke-dashoffset` 1→0 over 240ms `--ease-enter`, starting at 90ms. Check scale .8→1 (2% overshoot). The label and preview XF in. |
| transcribing → done (empty) | paste skipped | 240ms | `--ease-standard` | Width →148. Spinner out. The open-circle glyph and "Nothing heard" XF in. No check and no overshoot. |
| done → hidden | after the 700/420ms hold | 180ms | `--ease-exit` | opacity →0, scale →.96. No translate. |
| listening → cancelled | Esc | shake 120ms, overlapped with a 150ms exit | shake: linear keyframes; exit: `--ease-exit` | The bars freeze. translateX 0,−4,4,−4,4,0 (2 cycles). Label XF to "Cancelled" in 80ms. Lua then sends hidden, and the exit runs: opacity →0, scale →.96 over 150ms. |
| transcribing → cancelled | Esc | 150ms | `--ease-exit` | No shake. Width →132. XF label. |
| any → error | Lua | 240ms | `--ease-standard` | Width →fit (≤264), scale →1. XF to the amber glyph and message. No shake, no bounce. Held 2400ms by Lua. |
| error/cancelled → hidden | Lua | 180ms (cancel 150ms) | `--ease-exit` | opacity →0, scale →.96 |
| any → listening (re-entry mid-exit) | key down during exit | 280ms from current values | `--spring-morph` | Retarget from the current opacity and scale. No reset to .92. |

`window.EXIT_MS = 200` covers the longest exit (180ms) plus margin. Lua adds 30ms of timer slack.

**Shimmer** (transcribing only): the label gets a `background: linear-gradient(90deg, hud-fg-2 0 40%, hud-fg 50%, hud-fg-2 60% 100%)` with `background-size: 250%` and `background-clip:text`. Its `background-position` loops linearly over 1400ms. The animation is paused in every other state.
**Spinner:** a 270° arc rotating linearly at 900ms per turn.

## 2. Hold vs tap
- The capsule always enters as pending.
- **Hold:** looks pressed, with the capsule at scale .97 and no extra glyphs.
- **Tap:** looks latched, with the lock and Esc keycap at full scale.
- A `setState('listening',{mode})` that arrives while already listening never replays the enter. It only retargets.

## 3. Waveform
- **Input:** `setLevel(x)` at ≤15Hz, x in 0..1. Lua maps astats RMS from −60 to −10 dBFS onto 0..1 and applies a gamma of 0.6.
- **Loop:** a 60fps rAF loop runs only in `listening`. Each frame, `display` follows `target` using a critically damped spring with ω = 40 rad/s (about 80ms response). The attack is fast. On decay, `target` is multiplied by 0.85 per frame when no new sample has arrived, so the bars fall smoothly between samples.
- **Bar i height:** `h = 4 + 20 × display × profile[i] × jitter[i]`. The profile is `[.45,.7,.9,1,.9,.7,.45]`. Jitter is in 0.92..1.08 and is resampled on each `setLevel`, not each frame. Apply it as `scaleY(h/24)`.
- **Silence:** below 0.04 the bars rest at 4px. There is no idle animation, and the bars never collapse to 0.
- **Performance:** set `will-change: transform` on the bars and the capsule layers only.

## 4. Reduced motion (`prefers-reduced-motion: reduce`; WKWebView follows the system)
- Every transition becomes an opacity crossfade: enter 160ms `ease-out`, exit 120ms. Widths snap with no scale, translate, morph or shake. The pressed scale is dropped; hold vs tap still differ by the glyphs.
- **Meter:** the bars still follow the level, because this is feedback and not decoration. They quantize to 3 steps (low, mid, high), update at most every 200ms, and use no spring.
- **Transcribing:** no spinner rotation and no shimmer. The label "Transcribing…" steps its ellipsis `.` → `..` → `...` every 500ms.
- **Done:** the check appears already drawn.
- **Unchanged:** `EXIT_MS` stays 200. Every label, color and glyph is preserved.

## 5. Onboarding motion
- **Step change:** the outgoing step goes to opacity 0 and translateX −16px over 180ms `--ease-exit`. The incoming step comes from translateX 24px to 0 and opacity 0→1 over 420ms `--ease-enter`, starting at 120ms. Back mirrors this. Reduced motion uses a 200ms crossfade.
- **Permission turning allowed:** the glyph crossfades over 140ms and the check draws over 240ms `--ease-enter`, with no bounce.
- **Key capture waiting:** a 2px `--accent` outline pulses in opacity between .4 and 1 over 1200ms. When `onKeyChanged` fires, the label crossfades over 140ms and the keycap pops from scale .94 to 1 on `--spring-snappy`.
- **Buttons:** press scales to .97 over 100ms and releases on `--spring-snappy` over 240ms.
- **Mini HUD:** uses exactly the HUD transitions. Its loop is: pending 300ms → mode → listening 1.6s with a sine+noise level → transcribing 700ms → done 700ms → hidden → a 600ms pause.

## 6. Site and demo motion
- **Hero loop** (autoplay only without reduced motion, and only while visible via IntersectionObserver; pauses when the tab is hidden):
  1. The pill enters at the field.
  2. Listening for 2.4s with a recorded level curve.
  3. Transcribing for 0.9s.
  4. Done: the text types into the mock at 28 chars/s, starting when done begins.
  5. A 700ms hold, then exit.
  6. A 2s pause, then the text clears with a 240ms fade and the loop repeats.
- **Pill travel (first loop only):** the pill starts at hero center and moves to the field anchor with a 420ms `--spring-morph` translate.
- **Scroll reveal:** opacity 0→1 and translateY 12→0 over 420ms `--ease-enter`. Each element reveals once. Stagger at most 4 items, 40ms apart. Reduced motion shows everything immediately.
- **Hover lift on tiles:** translateY −2px plus a shadow-opacity change over 140ms `--ease-standard`.
- **Not used:** parallax, animated blur, and any decorative loop other than the hero.
- **Simulator and demo:** run the same HUD module and the same transition table.

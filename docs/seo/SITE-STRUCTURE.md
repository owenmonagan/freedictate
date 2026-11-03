# Site Structure

```
/                                  Home (exists)
/how-it-works/                     Architecture: whisper.cpp, offline, any button
/install/                          Install + uninstall + troubleshooting
/vs/wispr-flow/                    FreeDictate vs Wispr Flow
/vs/superwhisper/
/vs/voiceink/
/vs/macwhisper/
/vs/apple-dictation/
/alternatives/wispr-flow/          "Free Wispr Flow alternatives" (honest list, us first)
/alternatives/superwhisper/
/guides/
  /guides/mouse-button-dictation-mac/
  /guides/push-to-talk-dictation-mac/
  /guides/offline-speech-to-text-mac/
  /guides/mac-dictation-not-working/
  /guides/dictation-for-coding/
  /guides/dictation-for-rsi/
  /guides/whisper-on-mac/
/changelog/
/privacy/                          "Nothing leaves your Mac", stated as fact
```

## Rules
- Use trailing-slash folders with an `index.html` in each (this matches how GitHub Pages serves files). Every page reuses `tokens.css` and `styles.css`.
- Internal links: Home → every /vs/ page, plus /install and /how-it-works. Each /vs/ page → the matching /alternatives/ page, /install, and 2 guides. Each guide → /install plus 1 /vs/ page. Use descriptive anchor text, not "click here".
- Schema: Home has SoftwareApplication, FAQPage and Person (already there). /vs/ and /alternatives/ pages get Article and ItemList. Guides get HowTo-style Article and BreadcrumbList. Every subpage gets BreadcrumbList.
- Sitemap quality gate: a page only goes in the sitemap if it has at least 600 words of unique content and real screenshots or steps. Update `lastmod` only when the content actually changes.

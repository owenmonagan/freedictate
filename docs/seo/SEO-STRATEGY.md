# FreeDictate SEO Strategy

Updated 2026-11-03. Site: https://owenmonagan.github.io/freedictate/ (a single page on GitHub Pages, built from `site/`).

## Position
FreeDictate is free, open-source, offline, one-button dictation for Mac. The paid competitors (Wispr Flow, Superwhisper, VoiceInk) compete on features. We compete on costing $0 and needing no configuration. Every page should repeat three things: **One button. Actually free. Nothing leaves your Mac.**

Business type: open-source developer tool (we use the SaaS template, adapted). Nothing is sold, so there's no pricing funnel, case studies or sales pages. "Conversion" means a GitHub star, a clone, or running `install.sh`.

## Goals and KPIs
| Metric | Baseline (Nov 2026) | 3 mo | 6 mo | 12 mo |
|---|---|---|---|---|
| Indexed pages | 1 | 10 | 20 | 30 |
| Organic clicks/mo (GSC) | ~0 | 300 | 1,500 | 5,000 |
| Top-10 rankings, target set | 0 | 3 (long-tail) | 10 | 20 incl. 2 head terms |
| Referring domains | few (GitHub) | 15 | 40 | 100 |
| GitHub stars | current | +250 | +1,000 | +3,000 |
| Core Web Vitals | pass (static) | pass | pass | pass |
| AI-answer citations (manual check of 10 prompts) | 0 | 2 | 5 | 8 |

These targets are estimates. We have no keyword-volume data (DataForSEO isn't connected), so re-base them once 4 weeks of GSC data come in.

## Keyword pillars
1. **Free / alternative (bottom of funnel, best fit):** free wispr flow alternative, superwhisper alternative free, voiceink alternative, free dictation app mac, open source dictation mac.
2. **Offline / private:** offline speech to text mac, private dictation mac, whisper dictation mac, local whisper mac app.
3. **Push-to-talk / hardware (a niche we can win):** push to talk dictation mac, mouse button dictation, dictate with mouse button mac, hold key to dictate mac.
4. **Problem / how-to (top of funnel):** how to dictate on mac, mac dictation not working, mac dictation vs whisper, dictation for coding / Slack / email, voice typing for RSI.

## Findings on the current site
- **The custom robots.txt is ignored.** Crawlers only read `owenmonagan.github.io/robots.txt`, and `/freedictate/robots.txt` is not at the root. The sitemap therefore has to be submitted in Google Search Console and Bing Webmaster Tools. `og.html` should get `<meta name="robots" content="noindex">` instead.
- The site is one page, so the alternative, how-to and push-to-talk terms have no page that can rank for them. This is the biggest gap.
- What's already good: the title and meta are on-message; SoftwareApplication, FAQPage and Person JSON-LD are in place; the OG image exists; the site is static and fast.
- The domain is a github.io subdomain. A custom domain (for example `freedictate.app`) would build authority that we own, and should be done **before** the backlinks start to come in. Every URL after that is permanent.

## Strategy in one line
Make `/vs/` and `/alternatives/` pages for each competitor, add `/guides/` how-to content, launch on HN, Product Hunt, Reddit and the awesome-lists, and let the GitHub repo bring in the links.

## Risks
| Risk | Mitigation |
|---|---|
| Competitor claims go out of date or can't be defended | Keep claims general (price model, offline vs cloud), date-stamp the tables, check them every quarter |
| Thin programmatic pages | Each page has to show real setup steps or screenshots. No pages that just swap in a keyword |
| Migrating to a custom domain later loses equity | Decide on the domain in Phase 1 |
| Apple ships better built-in dictation | Lean on push-to-talk and the any-button angle, plus Whisper accuracy |

See SITE-STRUCTURE.md, CONTENT-CALENDAR.md, COMPETITOR-ANALYSIS.md and IMPLEMENTATION-ROADMAP.md.

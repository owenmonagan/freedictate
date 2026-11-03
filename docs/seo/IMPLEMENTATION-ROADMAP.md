# Implementation Roadmap

## Phase 1: Foundation (weeks 1–4)
- [ ] Decide on a custom domain now (a CNAME on GitHub Pages) and update the canonical, OG and sitemap URLs.
- [ ] Verify GSC and Bing Webmaster and submit the sitemap. The root robots.txt isn't under our control on github.io.
- [x] Add `noindex` to `site/og.html`.
- [x] Add a canonical `<link>` and a BreadcrumbList to the home page. Add `downloadUrl`, `softwareVersion` and `codeRepository` to the SoftwareApplication schema.
- [ ] Add privacy-friendly analytics (or rely on GSC alone, which fits the brand).
- [x] Ship /install/, /how-it-works/ and the first /vs/ page.
- [ ] Submit PRs to the awesome-lists.

## Phase 2: Expansion (weeks 5–12)
- [x] Ship the remaining /vs/ and /alternatives/ pages and the first 4 guides (see the calendar).
- [ ] Do the Show HN, Product Hunt and Reddit launches.
- [x] Build the internal-link matrix described in SITE-STRUCTURE.md.
- [ ] Record a demo GIF/video (holding the mouse button, then the text appears) and embed it with VideoObject schema.

## Phase 3: Scale (weeks 13–24)
- [ ] Do listicle and blogger outreach, and ask for a "free" spot in the "best dictation apps for Mac" roundups.
- [ ] GEO: write clear, quotable fact passages ("FreeDictate is free, MIT-licensed, and runs whisper.cpp locally"), add `llms.txt` (optional), and check 10 AI prompts every month.
- [ ] Add a lite YouTube video for each guide.
- [ ] Look at the GSC queries and build pages for the terms that come up.

## Phase 4: Authority (months 7–12)
- [ ] Write technical posts (whisper.cpp latency on Apple Silicon, building a HUD in Hammerspoon). These get links from dev communities.
- [ ] Highlight contributors and publish the changelog cadence.
- [ ] Refresh the competitor tables every quarter and keep `lastmod` honest.

## Dependencies
The domain decision blocks every other change to URLs. Analytics depends on GSC verification. The launch posts need the /install/ and /vs/ pages live first.

## Resources
Owen plus Claude: about 3 to 4 hours a week for writing, 0 budget. A domain costs about $10 to $15 a year if you choose to get one.

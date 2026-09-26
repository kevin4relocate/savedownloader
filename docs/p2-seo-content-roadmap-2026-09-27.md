# P2 SEO implementation and measurement plan
Updated 2026-09-27. Scope: SaveDownloader's existing English-language site. No claimed ranking, search volume, CPC, or Search Console result without verified account data.

## Implemented in this iteration
- Added the substantive [Instagram carousel ZIP guide](/instagram-carousel-zip-guide/), describing how iPhone Safari and Android Chrome handle files, browser ZIP safeguards, and troubleshooting steps specific to the current product.
- Added contextual internal links from homepage, Guides hub, Instagram tool page, existing Instagram guide and troubleshooting guide.
- Added its canonical URL, Article + BreadcrumbList JSON-LD and sitemap entry.
- Updated sitemap modification dates only on pages with meaningful changes in this iteration. Kept dates for untouched pages rather than mass-updating them.
- Strengthened SEO CI to check the complete sitemap, on-disk page targets, canonical consistency, indexability, new guide's internal discovery and parsable structured data.

## Next steps requiring first-party evidence
1. In Google Search Console, export the last 28 and 90 days for pages and queries. Keep branded and nonbranded searches separate. Note clicks, impressions, CTR, average position and the actual coverage/URL Inspection outcome for each priority page. Do not use GA4 traffic as a substitute for organic-search clicks.
2. Segment pages into: (a) existing downloader/product pages, (b) relevant original help content, (c) policy/trust pages. For 'Discovered – currently not indexed', check internal link depth, crawl response, significant unique value and duplicate intent rather than assuming a sitemap entry forces indexing.
3. Check Core Web Vitals/PageSpeed Insights on actual deployed mobile pages, with attention to LCP from cover images, consent UI effects and DOM size of the Instagram carousel. Distinguish field data from lab simulations.
4. Inspect mobile rendering and successful download flows with authorized public examples. Do not publish unsupported capability claims (watermark removal, private accounts, login-only content or lossless formats).
5. After metrics identify genuine user needs, consider a *distinct* guide for troubleshooting temporary CDN links and browser download locations only if it adds evidence/screenshots beyond the current troubleshooting and ZIP guides. Avoid near-duplicate iPhone/Android/platform permutation pages.

## Content acceptance checklist
- A real user question not adequately answered by the existing hub.
- Explanations refer to actual product capabilities or independently verifiable official browser guidance.
- Original practical information; no competitor copying or keyword stuffing.
- Precise title, meta description, visible H1, canonical and contextual internal links.
- Structured data only when consistent with visible content; Article schema is descriptive, not a promise of Google rich results.
- Update sitemap <lastmod> only for significant changes. Use a verified edit date rather than a date bump made solely for SEO.
- Do not imply public posts are free to copy or that platform restrictions can be ignored.

## Release validation
Run Code Check and SEO Crawl Check. If GitHub Actions does not pass, fix CI before promotion. Confirm deployment, fetch the canonical URLs and sitemap from the live site and use Search Console URL Inspection for crawl/index status. Repository checks cannot confirm production or indexing.

## Official references
- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://developers.google.com/search/docs/essentials
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/appearance/structured-data/sd-policies

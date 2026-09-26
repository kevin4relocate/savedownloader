# P1: Search visibility and traffic measurement

This document records the next operating steps; publishing code alone does not verify Search Console ownership, indexing, or measured traffic.

## Google Search Console

1. Add **Domain property** `savedownloader.com` in Search Console. Verify DNS ownership using the DNS TXT token supplied by Google; never commit the token or assume DNS is verified from a repository change.
2. Submit `https://savedownloader.com/sitemap.xml` after the changed static site is promoted to production. The sitemap contains canonical public pages and excludes API URLs, privacy-sensitive parameters, and worker preview origins.
3. Inspect the homepage, three downloader pages, guides hub, and new troubleshooting guide using URL Inspection. Record **Google-selected canonical**, indexing state, last crawl, and reasons for exclusion. Do not request indexing for duplicate, thin, or broken pages before addressing the underlying issue.
4. In Performance, compare 28-day clicks, impressions, CTR, and average position against the prior equal-length period. Segment by page and query; prioritize useful fixes over publishing many similar pages.

## Why GA4 is not a complete visitor count

The site loads GA4 only after a visitor accepts optional analytics; privacy and cookies pages intentionally do not load it. Consequently, GA4 totals omit visitors who reject or never answer the banner. The GA4 **event count** is not a count of visitors, visits, or downloads. Source / medium `(direct) / (none)` does not prove that every recorded visit was genuinely typed/bookmarked traffic.

Use the Cloudflare dashboard's available request/traffic metrics as **a separate directional source**, not a drop-in count of GA4 active users. Cloudflare request counts include page resources and possibly bots, depending on the product and filtering. Even Cloudflare Web Analytics and GA4 may use different tracking, consent, bot filtering, and definitions.

### Weekly measurement worksheet

For identical **UTC or specified local-time** calendar dates, record:

| Metric | GA4 | Cloudflare | Notes |
| --- | --- | --- | --- |
| Users / visitors | Active users | Unique visitors if available | Different definitions; never compute an exact consent rate by dividing |
| Visits | Sessions | Visits if the chosen Cloudflare product exposes them | Different session rules |
| Page views | Views (filter page_view as appropriate) | Page views if available | Compare trend, not equality |
| Acquisition | Organic search sessions and landing pages | Referrer/search breakdown if available | GA4 only covers consented visitors |
| Downloader use | GA4 resolve_success / resolve_failed / download_* | Not equivalent to HTTP requests | A download click is not a confirmed completed file |

Capture dates, timezone, Cloudflare product name, consent-banner version, known internal test traffic, and any bot-filtering configuration. Compare **trends and large disparities**, not exact totals.

Do not bypass consent or secretly introduce a tracking pixel to force counts to match. The existing analytics consent architecture must remain unchanged unless privacy requirements and notices are reviewed.

## Content and publishing quality

- Maintain the troubleshooting guide using observed, reproducible user issues; distinguish a successful post resolution from a successful binary download.
- Use original explanations based on actual product behavior and never generate near-duplicate landing pages solely to target keyword variants.
- Link useful guides from the home page and guides hub, maintain one canonical URL per real page, and change sitemap `lastmod` only when that URL's content meaningfully changes.
- Avoid claims that public posts are automatically licensed or that passing SEO checks implies AdSense approval. Review rights and platform terms independently before monetization.

## Release validation

On every P1 content change, run **SEO Crawl Check** and the standard code checks. Run **Production Smoke Test** after Cloudflare promotion. Use an authorized public Instagram fixture for optional Instagram download checks. A green local/repository SEO workflow alone does not establish successful Google indexing.

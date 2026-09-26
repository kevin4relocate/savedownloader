# Monetization and responsible-use release gate
Updated: 2026-09-27. Internal review checklist; not a statement of Google approval or legal compliance.

## Keep the existing SaveDownloader product
No downloader feature is automatically disabled by this checklist. However, public availability, notice-and-takedown text, or a competitor displaying ads do **not** establish that a platform permits third-party downloads.

## Before applying for or enabling AdSense
- [ ] Review and record relevant current rules and permissions for each supported Instagram, TikTok, and Douyin use case. If source-provider rules prohibit a particular download behavior, do not monetize or continue that behavior without an appropriate authorized basis.
- [ ] Confirm the site's actual features and download flow match Privacy, Terms, Copyright, About, and user-facing claims. Obtain qualified legal advice if material permissions remain unclear.
- [ ] Confirm each indexed guide is accurate, independently useful, and not a near-duplicate written just to display advertisements.
- [ ] Run Code Check, SEO Crawl Check, GA4 Consent Check, and the production smoke workflow against the promoted deployment. Configure an authorized INSTAGRAM_TEST_URL if validating successful Instagram downloads.
- [ ] Verify site ownership, page indexing, canonical selection, performance, and major user-facing errors in Search Console.
- [ ] Verify download buttons are visibly distinct and physically separated from any ad placement on desktop and mobile. Do not label sponsored placements as a download button; do not trigger unwanted downloads or pop-ups.
- [ ] Review location-specific consent obligations and adopt appropriate certified CMP functionality **before** Google advertising where required. The current custom banner implements optional analytics consent, not a full AdSense consent deployment.
- [ ] Test before requesting review with a clean browser, rejected consent, accepted consent, and mobile screens.
- [ ] After approval, monitor AdSense Policy Center for policy restrictions, warnings, and violations.

## No unsafe shortcuts
Do not replicate another downloader's copy, legal pages, advertising markup, or hidden navigation. Do not state that public media is free to reuse. Do not add AdSense tags to pages with unresolved policy concerns merely to test revenue.

## References
- https://support.google.com/publisherpolicies/answer/10436828?hl=en
- https://support.google.com/adsense/answer/1346295?hl=en
- https://support.google.com/adsense/answer/48182?hl=en
- https://support.google.com/adsense/answer/10008391?hl=en

## External verification still required
GitHub checks can validate static HTML/JS and response contracts, but they cannot verify actual third-party licensing, successful browser completion of a downloaded file, account-specific AdSense approval, or Search Console indexing.

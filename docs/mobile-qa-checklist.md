# P1 Mobile QA — Safari and Chrome

## What is covered

The manual **Mobile Browser Smoke (emulated)** GitHub Actions workflow runs a Linux WebKit browser with an iPhone 13 device preset and Chromium with a Pixel 7 device preset. It checks navigation, the consent banner, horizontal overflow, Instagram gallery/ZIP handoff, TikTok downloads and visible API errors. Responses are deterministic fixtures, so the workflow does **not** establish live TikTok, Douyin or Instagram download availability.

The browser emulations are useful regression checks but **not equivalent to testing Safari on a real iPhone or Chrome on a real Android phone**. Real-device acceptance is still required before marking mobile P1 complete.

## Real-device release acceptance

Test in portrait and landscape on at least one current iPhone using Safari and one Android phone using Chrome:

1. Open homepage, all three downloader pages, the guide hub and copyright/privacy pages. Confirm there is no horizontal scrolling at approximately 320, 375, 390 and 430 CSS-pixel widths. Rotate the device.
2. Open the mobile navigation; tap all links and the close button. Verify keyboard focus and Escape where a keyboard is connected.
3. With no stored consent choice, test the consent banner with large-text accessibility settings and a small screen. Confirm both accept and reject buttons remain reachable and the banner does not cover the download field permanently.
4. Tap the URL field and confirm iOS does not zoom due to text below 16px. Paste valid and invalid authorized public links from each supported platform.
5. Instagram: test photo, Reel, a mixed carousel and the 'Download all (.zip)' flow. On iOS, use the explicit **Save file** action after preparation, then inspect Safari Downloads and Files. On Android, verify the browser handles the ZIP. For files beyond the browser ZIP cap, confirm the 'download individually' error is displayed.
6. TikTok and Douyin: use authorized public fixtures and confirm the media can be saved; iOS explicitly displays the final **Save file** action. Also test errors returned from backend, long waits and temporary link expiry.
7. Test slow network / interrupted connection; ensure UI doesn't declare that a file was saved without confirmation. Refresh between tests.
8. Verify that controls have at least 44px target height where practical, results are readable, the status text wraps, and the screen doesn't get stuck after errors.

## Conditions before deployment

- Verify GitHub **Code Check**, **SEO Crawl Check**, and **GA4 Consent Check**.
- Manually run **Mobile Browser Smoke (emulated)** and inspect report and failure traces.
- Deploy the Cloudflare Worker and static assets **together**; the TikTok Vercel backend's first-party CORS change must be deployed independently before new frontend error handling can work reliably.
- Run the production smoke workflow after publishing and complete the real-device checklist.
- Keep the existing free service and avoid introducing rate limiting or paid infrastructure without a separate decision.

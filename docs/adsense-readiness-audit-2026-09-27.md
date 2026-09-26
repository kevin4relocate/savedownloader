# SaveDownloader — AdSense readiness audit
Audit date: 2026-09-27
Scope: repository-level review of existing SaveDownloader, not Google approval or a legal opinion.

## Outcome: NOT YET VERIFIED FOR ADS
Keep the existing downloaders, but do not deploy AdSense ad tags or claim policy compliance while the source-platform authorization questions below remain open. Adding a rights notice, original guides, cookie banner or legal pages does not make otherwise prohibited downloading permissible.

| Area | Finding | Gate |
| --- | --- | --- |
| Original content | Dedicated guide hub, device/platform guides, troubleshooting, and creator-rights guidance exist. Independent editorial quality and indexing still require review. | Human editorial + Search Console checks |
| Navigation | Homepage, About, Contact, Privacy, Cookies, Terms, Copyright and guide pages are linked. | Verify deployed pages and mobile navigation |
| Copyright | Rights-request contact and a guide exist. They are not substitutes for lawful platform access. | Confirm actual operational handling of reports |
| Analytics | GA4 is loaded only after optional analytics consent on production (except privacy/cookies by design). Ad-related Consent Mode fields remain denied. | Run GA4 Consent Check after deployment |
| Advertising | No AdSense script or publisher ID configured in the inspected source. No `ads.txt` file found. | Wait for account and eligibility decisions |
| Advertising consent | Existing banner controls analytics **only**; it is not a Google-certified TCF advertising CMP. | Adopt/configure suitable certified CMP before serving Google ads to visitors in EEA, UK or Switzerland where required |
| Ad placement | Ads have not been added, so placement cannot be validated yet. | If approved, keep ads unambiguously separate from download/results controls; test mobile |
| Core downloader policy | Each public-link resolver and media download path must be assessed independently against Google policy and its source provider's current terms and actual permissions. | **Blocking policy/legal review** |

## Primary policy concern
Google Publisher Policy 'Enabling dishonest behavior' specifically lists pages that assist or enable streaming-video downloads **when prohibited by the content provider** as an example of disallowed content. Public visibility, a user checkbox, owner permission, an existing competitor running ads, or a standalone educational section does not resolve the provider-authorization issue by itself.

- TikTok: Review the current applicable regional TikTok consumer Terms of Service and any written authorization actually held by SaveDownloader. Some regional terms restrict automated content extraction without written approval. Do not assume a creator's ability to export their own data permits this service to extract it independently.
- Instagram: Review Meta/Instagram terms, authorized download/export options, and the specific service's extraction method. Record regional/contract-specific evidence rather than assuming public posts are unrestricted.
- Douyin: Review the current applicable Chinese user agreement and any applicable commercial developer terms/permissions with a qualified Chinese reader or lawyer if needed.
- For each route: record the terms' precise clause + version/date, behavior in the repository, access method, owner/platform permissions where documented, outcome and reviewer. If the platform disallows a particular method and there is no authorized basis, don't place AdSense ads on that behavior; decide whether an authorized alternative exists.

## Consent implementation gate
Do not flip `ad_storage`, `ad_user_data`, or `ad_personalization` to granted merely because somebody opted into analytics. Google-certified IAB TCF CMP must be appropriately configured for Google advertising in relevant regions. Choose the consent product with your actual AdSense account; implement and test before enabling ads. If using Google Privacy & Messaging, follow the publisher dashboard instructions rather than inventing a custom TCF implementation.

## Operational checks before asking Google for review
- [ ] Run GitHub Code Check, SEO Crawl Check, GA4 Consent Check and the production smoke workflow on the deployed release.
- [ ] Run the emulated mobile workflow and verify core downloads on actual iPhone Safari and Android Chrome.
- [ ] Inspect the deployed homepage, three downloader pages, guide hub and five trust/legal pages, including Contact links and rights-request process.
- [ ] Verify indexed/canonical pages in Search Console and review performance/mobile layout.
- [ ] Review what analytics signals represent: request/button tap versus verified upstream response, and avoid public claims that all saved files were confirmed.
- [ ] Verify the privacy notice matches actual infrastructure logs, retention and third-party services. Do not publish invented retention periods.
- [ ] Document platform-policy authorization and independent legal review, where needed.
- [ ] After eligibility resolution, select a Google-certified CMP as appropriate, configure advertiser ID, authorized `ads.txt`, test ad placements and monitor the account's Policy Center.

## Evidence and sources checked
- Google publisher policy: https://support.google.com/publisherpolicies/answer/10436828?hl=en
- Google AdSense eligibility: https://support.google.com/adsense/answer/9724?hl=en
- Google site readiness: https://support.google.com/adsense/answer/7299563?hl=en
- Google AdSense program policies: https://support.google.com/adsense/answer/48182?hl=en
- Google certified CMP publisher requirements: https://support.google.com/adsense/answer/13554116?hl=en
- Current US TikTok Terms (regional example; NOT a global determination): https://t.tiktok.com/legal/page/us/terms-of-service/en
- Douyin user agreement (Chinese; verify applicable version): https://www.douyin.com/agreements/?id=6773906068725565448

Repository/source code review alone cannot establish Google approval, platform authorization, production deployment, real-device functioning, account-level consent settings, or actual Search Console indexing.

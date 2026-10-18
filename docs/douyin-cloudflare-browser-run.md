# Douyin on Cloudflare: optional Browser Run canary

The public Douyin resolver runs on Cloudflare Workers, **not Vercel**. The observed public test link returned:

- IES v2 iteminfo: HTTP 200, empty body
- IES detail and desktop detail: HTTP 403
- Public HTML pages: anti-bot challenge indicators

Those upstream responses contain no usable public media to parse. Adding more JSON selectors alone cannot recover unavailable data.

## What this branch changes

- Adds a Cloudflare Browser Run **binding** (Quick Actions `content`) to the existing Worker.
- Adds a very small Cloudflare Rate Limiting binding (maximum two browser attempts per minute **per Cloudflare location**, not a hard global spending cap).
- Adds a **protected**, explicit browser-only canary for a public Douyin post.
- Adds an **optional** browser fallback for regular Douyin resolve and download requests.
- Keeps normal Douyin, Instagram and TikTok API flow unchanged while browser fallback is disabled.
- Parses only the same public matching post ID. Browser Run never receives an arbitrary user URL.

**Browser Run does not defeat CAPTCHAs or anti-bot challenges**, and it consumes Cloudflare Browser Run usage. A successful build is not a guarantee that public Douyin metadata is accessible.

## Deployment

Cloudflare Workers Builds is connected to `kevin4relocate/savedownloader`, branch `main` with `npx wrangler deploy`. Once this branch is merged and the Cloudflare build succeeds, verify `/api/health` reports a **new** `deployment.id` and `douyinBrowserRun.available: true`. If the domain still serves an old deployment, check Deployments and routing before testing.

**No Browser Run browser instances launch merely from deployment or normal traffic.** The default `DOUYIN_BROWSER_FALLBACK` value is absent/off.

## Step 1 — Safely test a single public link

1. In Cloudflare, open Workers & Pages → savedownloader → Settings → Variables and Secrets.
2. Add a **Secret** (not a public variable) named `DOUYIN_BROWSER_TEST_TOKEN` using a random value at least 20 characters. For example, run `openssl rand -hex 24` locally. **Do not share the token in chat or commit it to GitHub.**
3. Make sure the Secret is active on the production Worker deployment.
4. Run the command below, replacing `<PRIVATE_TOKEN>` locally. Do not post the full curl command with your real token.

```sh
curl -sS -X POST 'https://savedownloader.com/api/resolve?diagnose=1&browser=1' \
  -H 'Content-Type: application/json' \
  -H 'x-douyin-browser-token: <PRIVATE_TOKEN>' \
  --data '{"url":"https://v.douyin.com/oY9iS-whNIQ"}'
```

The canary runs **only one browser quick action** against `https://www.douyin.com/video/<resolved_public_post_id>` and returns the usual downloader response. On failure, share only `error` and `diagnostics` (not tokens).

Expected diagnostic classifications include:

- `browser-run:challenge-page` — rendered page is still gated.
- `browser-run:http-429` — Cloudflare Browser Run browser quota/rate restrictions.
- `browser-run:no-matching-public-media` — browser loaded a page, but no **matching** downloadable video data was present.
- `browser-run:rate-limited` — rate limiter refused a browser launch.
- `browser-run:invalid-response` / `browser-run:network-or-response-error` — browser action failed.

If Browser Run also receives a challenge, **do not treat CAPTCHA avoidance as a parser fix**. Investigate a permitted source/authorized integration instead.

## Step 2 — Enable fallback only after proof of success and cost review

If the canary really resolves an authorized, public Douyin video, the owner may decide to set the Worker runtime variable `DOUYIN_BROWSER_FALLBACK=1` in Cloudflare Settings (or configure it via Wrangler / a reviewed GitHub change). This allows the public downloader to try Browser Run **only after normal metadata sources fail**.

Caution: enabling a public fallback can consume Browser Run usage; the included per-location rate limit reduces abuse but is **not** a global monthly billing cap. Review current Cloudflare Browser Run usage limits and set account-level budgets or extra WAF limits first. Do not enable this flag merely because deployment succeeded.

To switch it off, remove the variable or set it to `0`. The canary can still be run independently when the secret is configured.

## Security and compatibility

- The browser-only endpoint requires a secret header and is limited to the Douyin resolver; it is not an open web rendering proxy.
- The browser target is built from an extracted numeric Douyin post ID.
- Diagnostic logs and API responses do not include HTML, cookies, tokens or user URLs.
- No changes were made to Vercel, DNS, routes or other providers.
- Tests: `npm run typecheck` and `node --test tests/douyin-parser.test.mjs`.
- Documentation: https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/ and https://developers.cloudflare.com/browser-run/pricing/.

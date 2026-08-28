# SaveDownloader

SaveDownloader is a lightweight public Douyin and TikTok media resolver designed for Cloudflare Workers + Static Assets.

The current public release supports Douyin and TikTok.

> Use SaveDownloader only for media you own or have permission to save. Private/authenticated, paywalled, DRM-protected, and other access-controlled content is out of scope.

## Architecture

```text
Browser
  ├─ static HTML/CSS/JS (Workers Static Assets)
  └─ POST /api/resolve
          ├─ Douyin resolver
          │    └─ public Douyin web data
          └─ TikTok resolver
               └─ public TikTok page data
```

Only `/api/*` is configured to invoke Worker code. Normal pages and assets are served as static assets. Resolved media is returned to the browser rather than permanently archived by the Worker.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run typecheck
npm run dev
```

Wrangler starts the site locally and routes `/api/*` through the Worker.

## Deploy to Cloudflare

The project uses manual production promotion. Cloudflare Builds uploads new Worker versions with:

```bash
npx wrangler versions upload
```

After a version is tested, promote that version to production in Cloudflare. The repository also keeps `npm run deploy` for an explicit Wrangler deployment when intentionally used.

The Cloudflare project uses `wrangler.jsonc` as the source of truth. Static files live in `public/`, Worker code in `src/`, and provider implementations in `src/providers/`.

## Release pages

- `/` — multi-platform SaveDownloader homepage
- `/douyin-downloader/` — Douyin downloader landing page
- `/tiktok-downloader/` — TikTok downloader landing page
- `/how-to-download-douyin-videos/` — Douyin help and troubleshooting guide
- `/about/`, `/contact/` — trust and contact pages
- `/privacy/`, `/terms/`, `/copyright/` — legal pages

## Safety and privacy boundaries

- Supported public Douyin and TikTok URLs only.
- No account credentials or private login cookies.
- No private/login-only or paywalled content.
- No DRM/access-control bypass.
- No permanent media library by design.
- Input URLs are host-validated before outbound requests to reduce SSRF risk.

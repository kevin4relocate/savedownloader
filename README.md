# SaveDownloader

SaveDownloader is a lightweight public Douyin media resolver designed for Cloudflare Workers + Static Assets.

The current public release supports Douyin only.

> Use SaveDownloader only for media you own or have permission to save. Private/authenticated content and DRM bypass are out of scope.

## Architecture

```text
Browser
  ├─ static HTML/CSS/JS (Workers Static Assets)
  └─ POST /api/resolve
          └─ Douyin resolver
               └─ public Douyin web data
```

Only `/api/*` is configured to invoke Worker code. Normal pages and assets are served as static assets.

## Local development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run typecheck
npm run dev
```

Wrangler starts the site locally and routes `/api/*` through the Worker.

## Deploy to Cloudflare

After connecting the repository or authenticating Wrangler:

```bash
npm install
npm run deploy
```

The Cloudflare project uses `wrangler.jsonc` as the source of truth. Static files live in `public/`, Worker code in `src/`, and the Douyin resolver in `src/providers/douyin.ts`.

## Release pages

- `/` — SaveDownloader homepage
- `/douyin-downloader/` — primary Douyin downloader landing page
- `/how-to-download-douyin-videos/` — help and troubleshooting guide
- `/about/`, `/contact/` — trust and contact pages
- `/privacy/`, `/terms/`, `/copyright/` — legal pages

## Safety and privacy boundaries

- Public Douyin URLs only.
- No account credentials.
- No private/login-only content.
- No DRM/access-control bypass.
- No permanent media library by design.
- Input URLs are host-validated before outbound requests to reduce SSRF risk.

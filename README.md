# SaveDownloader

**Live website:** [https://savedownloader.com/](https://savedownloader.com/)

SaveDownloader is a lightweight browser-based downloader for supported public Instagram, Douyin, and TikTok media. The main website, static assets, resolvers, Instagram delivery, and Douyin delivery run on Cloudflare Workers + Static Assets. TikTok video delivery uses a small Vercel backend because TikTok media CDN requests were unreliable from Cloudflare egress.

The current public release supports Instagram Reels, videos, photos and compatible carousels; public Douyin videos and supported share links; and supported public TikTok media.

> Use SaveDownloader only for media you own or have permission to save. Private/authenticated, paywalled, DRM-protected, and other access-controlled content is out of scope.

## Architecture

```text
Browser
  ├─ static HTML/CSS/JS → Cloudflare Static Assets
  ├─ POST /api/resolve → Cloudflare Worker
  │    ├─ Instagram resolver → public Instagram web data
  │    ├─ Douyin resolver → public Douyin web data
  │    └─ TikTok resolver → public TikTok page data
  ├─ Instagram download
  │    └─ /api/download/instagram → Cloudflare Worker
  ├─ Douyin download
  │    ├─ direct public media CDN when allowed
  │    └─ /api/download/douyin → Cloudflare Worker fallback
  └─ TikTok download
       └─ savedownloader-tiktok-api.vercel.app/api/download → Vercel Node Function
```

Only `/api/*` is configured to invoke Worker code. Normal pages and assets are served as static assets. Media is streamed on demand and is not permanently archived by SaveDownloader.

## Analytics

Production pages load Google Analytics only on `savedownloader.com` and `www.savedownloader.com` after analytics consent is granted. The frontend records aggregate product events without sending the pasted media URL, including provider resolution and download actions.

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

The TikTok Vercel backend lives in `vercel-tiktok-api/` and is deployed separately from the Cloudflare Worker.

## Release pages

- [SaveDownloader homepage](https://savedownloader.com/) — multi-platform entry point
- [Instagram Downloader](https://savedownloader.com/instagram-downloader/) — public Reels, videos, photos, and supported carousel media
- [Douyin Downloader](https://savedownloader.com/douyin-downloader/) — public Douyin videos and supported share-link formats
- [TikTok Downloader](https://savedownloader.com/tiktok-downloader/) — supported public TikTok media
- [Guides](https://savedownloader.com/guides/) — platform and troubleshooting guides
- `/about/`, `/contact/` — trust and contact pages
- `/privacy/`, `/cookies/`, `/terms/`, `/copyright/` — legal and consent pages

## Safety and privacy boundaries

- Supported public Instagram, Douyin, and TikTok URLs only.
- No account credentials or private login cookies.
- No private/login-only or paywalled content.
- No DRM/access-control bypass.
- No permanent media library by design.
- Input URLs and outbound media hosts are validated to reduce SSRF risk.

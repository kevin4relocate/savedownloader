# SaveDownloader

SaveDownloader is a lightweight multi-platform public-media resolver designed for Cloudflare Workers + Static Assets.

The first supported platform is Douyin. The architecture is provider-based so TikTok, Instagram, and other public-media sources can be added later without changing the frontend API contract.

> Use SaveDownloader only for media you own or have permission to save. Private/authenticated content and DRM bypass are out of scope.

## Architecture

```text
Browser
  ├─ static HTML/CSS/JS (Workers Static Assets)
  └─ POST /api/resolve
          └─ provider resolver
               └─ public platform share page
```

Only `/api/*` is configured to invoke Worker code. Normal page/assets requests are served as static assets.

## Local development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run typecheck
npm run dev
```

Wrangler will start the site locally and route `/api/*` through the Worker.

## Deploy to Cloudflare

After connecting the repository or authenticating Wrangler:

```bash
npm install
npm run deploy
```

The Cloudflare project uses `wrangler.jsonc` as the source of truth. Static files live in `public/`, Worker code in `src/`, and platform-specific code in `src/providers/`.

## Adding another platform

1. Add a provider under `src/providers/`.
2. Validate allowed hostnames before making outbound requests.
3. Return the same normalized media shape used by the Douyin provider.
4. Add provider detection in `src/index.ts`.
5. Add a dedicated SEO landing page under `public/`.

## Safety and privacy boundaries

- Public share URLs only.
- No account credentials.
- No private/login-only content.
- No DRM/access-control bypass.
- No permanent media library by design.
- Input URLs are host-validated before outbound requests to reduce SSRF risk.

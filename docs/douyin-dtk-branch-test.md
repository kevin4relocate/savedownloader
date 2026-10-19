# Evil0ctal DTK v5: private Douyin branch preview

**Branch:** feature/douyin-evil0ctal-preview-20261019

This is a private test integration. It does not replace the main website's
Douyin, TikTok or Instagram flows. It requires your **own running instance**
of Evil0ctal/Douyin_TikTok_Download_API v5 and a read-only API key.

<!-- Branch-only rebuild after Cloudflare Preview settings were confirmed in dashboard, 2026-10-19. No production configuration changes. -->

## Evil0ctal integration — optional until a real backend is connected

The user requested merging this branch into main before finishing external DTK
server setup. The frontend therefore **preserves the existing Vercel Douyin
resolver by default**, just as before this PR. Evil0ctal remains available for
explicit opt-in testing with **?dtk=1** on the Douyin downloader page. Do not
enable it for everyone until a self-hosted DTK instance successfully resolves
and downloads real public video.

Cloudflare's true isolated Worker Preview was verified on 2026-10-19:
https://feature-douyin-evil0ctal-preview-20261019-savedownloader.kevin4relocate.workers.dev/douyin-downloader/?dtk=1

GitHub: https://github.com/kevin4relocate/savedownloader/pull/40

Use the normal page without any query for the existing downloader flow.
Use the ?dtk=1 query only when testing an already-configured DTK backend.
The test-token form appears only in that opt-in mode. The endpoint
GET /api/dtk/status reports booleans about backend readiness without returning
credentials. CI and successful Worker Preview deployment do not demonstrate
that Evil0ctal can fetch the public Douyin video yet.

### Important: Cloudflare cannot run the full Evil0ctal v5 stack

The branch Preview hosts only the frontend and Cloudflare Worker adapter.
DTK v5 includes Python/FastAPI, PostgreSQL + TimescaleDB, Redis and an optional
browser container. It needs an external Docker host. Until a DTK HTTPS service
is connected, the page shows backend not configured and cannot fetch media.
A Preview deployment success does not prove Douyin metadata can be parsed.

### Connect a self-hosted DTK backend securely

Use an already-hosted authorized DTK v5 instance if available. For a free trial,
you can run DTK Docker on Mac and expose a **Cloudflare Access-protected HTTPS
Tunnel** to the Preview Worker. Mac must remain on during testing.

1. Start DTK on Mac as documented below. In its admin console create an API
   key with scope douyin:read only. Test the key in DTK's own Playground.
2. In Cloudflare Zero Trust → Networks → Tunnels create a named Tunnel.
   Configure public hostname dtk-test.savedownloader.com (or your chosen name)
   to route to http://127.0.0.1:8000 on your Mac. Run cloudflared on your Mac.
3. In Zero Trust → Access → Applications protect the hostname using a
   **Service Auth** policy with a newly created Access service token.
   Do not set public Bypass. Keep DTK admin accessible at localhost on Mac.
   Protect the hostname before sharing it.
4. Open Cloudflare Workers & Pages → savedownloader, switch from Production
   to this Preview branch, then go to Settings → Variables and Secrets.
   Add all **five Preview-only secrets**:

   - DTK_API_URL = https://dtk-test.savedownloader.com/ (or your HTTPS URL)
   - DTK_API_KEY = DTK read-only API key scoped douyin:read
   - DTK_TEST_TOKEN = independent random password (at least 24 characters)
   - DTK_ACCESS_CLIENT_ID = Cloudflare Access service-token client ID
   - DTK_ACCESS_CLIENT_SECRET = matching Access client secret

   If your DTK service uses a different trusted HTTPS authentication method,
   the Access ID and secret can be omitted **together**. Do not make an admin
   console publicly accessible solely for testing.

   Do not add credentials to GitHub commits, public vars, URLs or chat. Set
   them only on this Preview, never on Production.

5. Reload the Preview URL above. Check that the status says DTK settings
   are present. Enter the DTK_TEST_TOKEN in the password-style field, paste
   https://www.douyin.com/video/7668944508008610298, click Get media, and if
   metadata succeeds click Download video. Verify an MP4 was actually saved.

### Cloudflare Preview status and settings

- GET /api/dtk/status returns booleans for backend configuration and rate-limit
  binding. It does not verify connectivity or disclose origin/credentials.
- The two test endpoints require x-dtk-test-token.
- Preview rate-limit namespace 716034 is separate from production 716032:
  2 preview requests per 60 seconds per Cloudflare location, not globally.
- Preview uses Wrangler 4.136.3 and the previews block in wrangler.jsonc.
- If builds stop, confirm Workers & Pages → savedownloader → Settings → Builds →
  Preview Builds enabled, Preview command: npx wrangler preview.
- Worker Previews are public by default. To make the staging UI itself private,
  protect the Preview hostname with Cloudflare Access too.

Official documentation:
- https://developers.cloudflare.com/workers/previews/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
- https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/

---

## 1. Start Evil0ctal on Mac

Install Docker Desktop and make sure it is running. Follow the official installer:

~~~bash
mkdir -p ~/Tools/Evil0ctal && cd ~/Tools/Evil0ctal
curl -fsSL https://raw.githubusercontent.com/Evil0ctal/Douyin_TikTok_Download_API/main/install/install.sh -o install.sh
less install.sh
bash install.sh --check
bash install.sh
~~~

Use localhost port 8000, enable its browser component **if you have the RAM**,
media downloads on, transcription off. Upstream recommends ~4 GB RAM for the core
stack or ~8 GB with the browser, plus ~15 GB free disk.

After installation, open the local setup link printed by the installer.
Create the admin account, then visit API keys and create a new key with
**douyin:read only**. Do not send or share any secrets.

**Important:** DTK's pool starts empty if its browser container is disabled.
In that case it cannot parse posts until you configure an authorized identity.
Using the browser also does not guarantee Douyin will allow requests.

Official setup: https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/main/documents/en/01-quickstart.md

## 2. Get the SaveDownloader branch

~~~bash
git clone --branch feature/douyin-evil0ctal-preview-20261019 https://github.com/kevin4relocate/savedownloader.git
cd savedownloader
npm install
cp .dev.vars.example .dev.vars
~~~

Edit .dev.vars to contain these three lines (use your own secrets):

~~~dotenv
DTK_API_URL=http://127.0.0.1:8000/
DTK_API_KEY=YOUR_DTK_READ_ONLY_API_KEY
DTK_TEST_TOKEN=YOUR_RANDOM_PRIVATE_TOKEN_AT_LEAST_24_CHARACTERS
~~~

Generate the preview token using: openssl rand -hex 24

SaveDownloader only reads DTK_API_KEY on the server. The browser receives
neither DTK_API_KEY nor DTK cookies. Do not commit .dev.vars to GitHub.
Its .gitignore entry is included on this branch.

## 3. Run SaveDownloader locally

~~~bash
npm run dev
~~~

Open:

**http://localhost:8787/douyin-downloader/?dtk=1**

You will see a private DTK test-token field. Paste DTK_TEST_TOKEN there,
then paste the sample public post URL:

https://www.douyin.com/video/7668944508008610298

Click **Get media**. If metadata is returned, click **Download video** to test
the actual transfer. Metadata success does not prove video transfer works.

On main and on staging, the normal Douyin URL uses Vercel by default.
Add ?dtk=1 to explicitly test the self-hosted Evil0ctal integration.

### Test the API directly (optional)

~~~bash
curl -sS -X POST http://localhost:8787/api/dtk/resolve \
  -H 'Content-Type: application/json' \
  -H 'x-dtk-test-token: YOUR_PRIVATE_TEST_TOKEN' \
  --data '{"url":"https://www.douyin.com/video/7668944508008610298"}'
~~~

The optional adapter uses the real DTK v5 API: POST /api/v1/parse?wait=25,
and GET /api/v1/tasks/{id} if parsing takes longer. It validates matching
public Douyin media and only allows specified public media CDN domains.

If the Worker reports that DTK has no healthy identity, resolve that in the
DTK admin console before trying again. If metadata works but download fails,
the original media CDN may still refuse the Cloudflare Worker request.
For this private preview, authenticated fallback downloads bigger than 48 MB
are not supported by the in-browser transfer helper.

## Test isolation and security

- The normal public endpoints are unchanged.
- Private preview APIs: POST /api/dtk/resolve and GET /api/dtk/download.
- Both require the DTK_TEST_TOKEN header, which is never stored in browser
  storage or the URL.
- A Cloudflare rate-limit binding restricts previews to 2 requests/minute
  per edge location. Allow one for parse and one for download.
- The preview Worker only accepts a locally hosted HTTP DTK URL when accessed
  locally on localhost / 127.0.0.1. Hosted Workers require an HTTPS DTK origin.
- Branch Version URLs and real Worker Previews are different. Cloudflare
  Worker Previews are now enabled and the isolated branch URL is active.
  Do not put private credentials in git; hosted DTK requests require your own
  authorized HTTPS DTK service.
- This branch does not automatically expose a running Docker service on the Mac
  to Cloudflare on the internet.

## Local checks

~~~bash
npm run typecheck
node --test tests/dtk-preview.test.mjs
node --test tests/douyin-ui-flow.test.mjs
npx wrangler deploy --dry-run --outdir /tmp/savedownloader-dtk-preview-build
~~~

Only a real DTK instance can verify your sample video's availability. The
production user interface keeps its existing Vercel flow until Evil0ctal is
proven working and the operator explicitly chooses to enable it.

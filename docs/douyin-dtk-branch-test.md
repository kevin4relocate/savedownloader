# Evil0ctal DTK v5: private Douyin branch preview

**Branch:** feature/douyin-evil0ctal-preview-20261019

This is a private test integration. It does not replace the main website's
Douyin, TikTok or Instagram flows. It requires your **own running instance**
of Evil0ctal/Douyin_TikTok_Download_API v5 and a read-only API key.

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

Without the ?dtk=1 query flag, SaveDownloader keeps its existing Vercel flow.

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
- **A Git branch is not a deployed preview website.** Test via npm run dev first.
  Do not deploy the branch to the production Cloudflare Worker or copy secrets
  into the repo. Hosting this later requires a separate staging Worker and a
  private HTTPS DTK service.
- This branch does not automatically expose a running Docker service on the Mac
  to Cloudflare on the internet.

## Local checks

~~~bash
npm run typecheck
node --test tests/dtk-preview.test.mjs
node --test tests/douyin-ui-flow.test.mjs
npx wrangler deploy --dry-run --outdir /tmp/savedownloader-dtk-preview-build
~~~

Only a real DTK instance can verify your sample video's availability.

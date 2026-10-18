import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const text = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const dataModule = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const douyin = dataModule(compile(text('src/providers/douyin.ts')));
const tiktok = dataModule(compile(text('src/providers/tiktok.ts')));
const instagram = dataModule(compile(text('src/providers/instagram.ts')));
const compiledWorker = compile(text('src/index.ts'))
  .replaceAll('from "./providers/douyin"', 'from "' + douyin + '"')
  .replaceAll('from "./providers/tiktok"', 'from "' + tiktok + '"')
  .replaceAll('from "./providers/instagram"', 'from "' + instagram + '"');
const { default: worker } = await import(dataModule(compiledWorker));

const id = '1234567890123456789';
const video = 'https://v3.douyinvod.com/example-media.mp4';
const sourceUrl = 'https://www.douyin.com/video/' + id;
const sample = {aweme_id: id, video: {playAddr: {urlList: [video]}}, desc: 'Public sample'};
const html = '<script type="application/json" id="__NEXT_DATA__">' +
  JSON.stringify({props: {pageProps: {aweme_detail: sample}}}) + '</script>';

async function withWorkerMocks(action) {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const memory = new Map();
  const stats = {upstreams: 0, renders: 0, mediaFetches: 0, limitCalls: 0};
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {default: {
      async match(request) {
        const response = memory.get(request.url);
        return response?.clone();
      },
      async put(request, response) {
        memory.set(request.url, response.clone());
      }
    }}
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith(video)) {
      stats.mediaFetches += 1;
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {'content-type': 'video/mp4', 'content-length': '4'}
      });
    }
    stats.upstreams += 1;
    if (url.includes('/web/api/v2/aweme/iteminfo/')) return new Response('', {status: 200});
    if (url.includes('/aweme/v1/web/aweme/detail/')) return new Response('', {status: 403});
    if (url.includes('ttwid.bytedance.com')) return new Response('{}', {status: 200});
    return new Response('<html>__ac_nonce</html>', {status: 200});
  };
  const env = {
    BROWSER: {
      async quickAction(actionType, args) {
        assert.equal(actionType, 'content');
        assert.equal(args.url, sourceUrl);
        stats.renders += 1;
        return new Response(JSON.stringify({success: true, result: html}), {
          status: 200, headers: {'content-type': 'application/json'}
        });
      }
    },
    DOUYIN_BROWSER_RATE_LIMIT: {
      async limit({key}) {
        assert.equal(key, 'douyin-browser-global');
        stats.limitCalls += 1;
        return {success: true};
      }
    }
  };
  try {
    await action({env, stats, memory});
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor);
    else delete globalThis.caches;
  }
}
function resolveRequest(query) {
  return new Request('https://savedownloader.com/api/resolve' + query, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({url: sourceUrl})
  });
}

test('existing Douyin form uses the bounded browser fallback without needing an admin token', async () => {
  await withWorkerMocks(async ({env, stats}) => {
    const response = await worker.fetch(resolveRequest('?tryBrowser=1&diagnose=1'), env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.platform, 'douyin');
    assert.equal(payload.data.videoUrl, video);
    assert.equal(stats.renders, 1);
    assert.equal(stats.limitCalls, 1);
  });
});

test('download endpoint reuses recently resolved video instead of launching Browser Run twice', async () => {
  await withWorkerMocks(async ({env, stats}) => {
    const resolve = await worker.fetch(resolveRequest('?tryBrowser=1&diagnose=1'), env);
    assert.equal(resolve.status, 200);

    const download = await worker.fetch(new Request(
      'https://savedownloader.com/api/download/douyin?tryBrowser=1&url=' + encodeURIComponent(sourceUrl)
    ), env);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'video/mp4');
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="douyin-' + id + '.mp4"');
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    assert.equal(stats.renders, 1);
    assert.equal(stats.mediaFetches, 1);
  });
});

test('regular Douyin API without UI opt-in does not launch a billable browser', async () => {
  await withWorkerMocks(async ({env, stats}) => {
    const response = await worker.fetch(resolveRequest('?diagnose=1'), env);
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(stats.renders, 0);
    assert.equal(stats.limitCalls, 0);
    assert.ok(!payload.diagnostics.some(x => x.startsWith('browser-run:')));
  });
});

test('secret-only browser canary is still protected by its token', async () => {
  await withWorkerMocks(async ({env, stats}) => {
    const response = await worker.fetch(resolveRequest('?browser=1'), env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'Authorized browser test token required.');
    assert.equal(stats.renders, 0);
  });
});

test('existing website routes Douyin to Vercel and keeps non-Douyin on Cloudflare', () => {
  const app = text('public/assets/app.js');
  assert.match(app, /DOUYIN_RESOLVE_API=VERCEL_BASE\+'\/api\/douyin-resolve'/);
  assert.match(app, /DOUYIN_DOWNLOAD_API=VERCEL_BASE\+'\/api\/douyin-download'/);
  assert.match(app, /requestedPlatform==='douyin'\?DOUYIN_RESOLVE_API:'\/api\/resolve'/);
  assert.match(app, /explainDouyinError/);
  assert.match(app, /through the Vercel server/);
  assert.match(app, /AbortSignal\.timeout\(requestedPlatform==='douyin'\?90000:35000\)/);
});

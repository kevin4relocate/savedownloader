import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/providers/douyin.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { resolveDouyin, DouyinParseError } = await import('data:text/javascript;base64,' + Buffer.from(transpiled).toString('base64'));

const id = '1234567890123456789';
const mediaUrl = 'https://v3.douyinvod.com/public-example.mp4';
const item = {
  aweme_id: id,
  desc: 'Public example',
  video: { playAddr: { urlList: [mediaUrl] } }
};
const asJson = (body) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' }
});
const asHtml = (body) => new Response(body, {
  status: 200, headers: { 'content-type': 'text/html' }
});

async function withMockFetch(mock, task) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await task(); } finally { globalThis.fetch = previous; }
}

test('Douyin falls back to public IES detail when legacy API lacks media', async () => {
  const calls = [];
  const result = await withMockFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/web/api/v2/aweme/iteminfo/')) return asJson({ item_list: [] });
    if (url.includes('/aweme/v1/web/aweme/detail/')) return asJson({ aweme_detail: item });
    throw new Error('Unexpected upstream: ' + url);
  }, () => resolveDouyin(new URL('https://www.douyin.com/video/' + id)));

  assert.equal(result.videoUrl, mediaUrl);
  assert.equal(result.id, id);
  assert.equal(result.type, 'video');
  assert.equal(calls.length, 2);
});

test('Douyin extracts hydrated JSON scripts with attributes in any order', async () => {
  const html = '<script type="application/json" data-foo="x" id="__NEXT_DATA__">' +
    JSON.stringify({ props: { pageProps: { aweme_detail: item } } }) + '</script>';
  const result = await withMockFetch(async (input) => {
    const url = String(input);
    if (url.includes('/web/api/v2/aweme/iteminfo/')) return asJson({});
    if (url.includes('/aweme/v1/web/aweme/detail/')) return asJson({});
    return asHtml(html);
  }, () => resolveDouyin(new URL('https://www.douyin.com/video/' + id)));
  assert.equal(result.videoUrl, mediaUrl);
});

test('Douyin rejects media tied to a different post ID', async () => {
  const wrongItem = { ...item, aweme_id: '9999999999999999999' };
  await assert.rejects(withMockFetch(async (input) => {
    const url = String(input);
    if (url.includes('/web/api/v2/aweme/iteminfo/')) return asJson({ item_list: [wrongItem] });
    if (url.includes('/aweme/v1/web/aweme/detail/')) return asJson({ aweme_detail: wrongItem });
    return asHtml('<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ aweme_detail: wrongItem }) + '</script>');
  }, () => resolveDouyin(new URL('https://www.douyin.com/video/' + id))), /could not be parsed/i);
});

test('Douyin diagnostics distinguish empty API, HTTP block and challenge page without leaking input', async () => {
  const result = withMockFetch(async (input) => {
    const url = String(input);
    if (url.includes('ttwid.bytedance.com')) return asJson({});
    if (url.includes('/web/api/v2/aweme/iteminfo/')) return new Response('', {status: 200});
    if (url.includes('www.iesdouyin.com/aweme/v1/web/aweme/detail/')) {
      return new Response('blocked', {status: 403});
    }
    if (url.includes('www.douyin.com/aweme/v1/web/aweme/detail/')) {
      return new Response('', {status: 200});
    }
    if (url.includes('m.ixigua.com')) return asHtml('<html>No public item</html>');
    return asHtml('<html>__ac_nonce</html>');
  }, () => resolveDouyin(new URL('https://www.douyin.com/video/' + id)));

  await assert.rejects(result, (error) => {
    assert.ok(error instanceof DouyinParseError);
    assert.match(error.message, /could not be parsed/i);
    assert.ok(error.diagnostics.includes('ies-iteminfo:empty-body'));
    assert.ok(error.diagnostics.includes('ies-detail:http-403'));
    assert.ok(error.diagnostics.includes('desktop-detail:empty-body'));
    assert.ok(error.diagnostics.includes('shared-page:challenge-page'));
    assert.ok(error.diagnostics.includes('ixigua-share:no-matching-public-media'));
    const serialized = JSON.stringify(error.diagnostics);
    assert.ok(!serialized.includes(id), 'must not contain post ID');
    assert.ok(!serialized.includes('https://'), 'must not contain upstream URL');
    return true;
  });
});

test('Douyin diagnostics distinguish valid but unrelated media', async () => {
  const differentId = {...item, aweme_id: '9999999999999999999'};
  await assert.rejects(withMockFetch(async (input) => {
    const url = String(input);
    if (url.includes('ttwid.bytedance.com')) return asJson({});
    if (url.includes('/web/api/v2/aweme/iteminfo/')) return asJson({ item_list: [differentId] });
    if (url.includes('/aweme/v1/web/aweme/detail/')) return asJson({ aweme_detail: differentId });
    return asHtml('<html>Only unrelated media</html>');
  }, () => resolveDouyin(new URL('https://www.douyin.com/video/' + id))), error => {
    assert.ok(error instanceof DouyinParseError);
    assert.ok(error.diagnostics.includes('ies-iteminfo:no-matching-public-media'));
    return true;
  });
});


function browserWithHtml(html, calls = []) {
  return {
    async quickAction(action, options) {
      calls.push({ action, options });
      return asJson({ success: true, result: html });
    }
  };
}

const renderedHtml = '<script data-x="y" type="application/json" id="__NEXT_DATA__">' +
  JSON.stringify({ props: { pageProps: { aweme_detail: item } } }) + '</script>';

test('Browser-only canary parses a public matching post and uses only a fixed canonical Douyin URL', async () => {
  const calls = [];
  const counters = [];
  const result = await withMockFetch(() => {
    throw new Error('Browser-only mode must not hit ordinary metadata APIs for full post URLs');
  }, () => resolveDouyin(new URL('https://www.douyin.com/video/' + id), {
    browser: browserWithHtml(renderedHtml, calls),
    browserOnly: true,
    browserRateLimit: { async limit(input) { counters.push(input.key); return { success: true }; } }
  }));
  assert.equal(result.videoUrl, mediaUrl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'content');
  assert.equal(calls[0].options.url, 'https://www.douyin.com/video/' + id);
  assert.equal(calls[0].options.gotoOptions.timeout, 15000);
  assert.deepEqual(counters, ['douyin-browser-global']);
});

test('Browser-only canary reports a challenge without treating its HTML as media', async () => {
  await assert.rejects(
    resolveDouyin(new URL('https://www.douyin.com/video/' + id), {
      browserOnly: true,
      browser: browserWithHtml('<html><h1>__ac_nonce</h1></html>'),
      browserRateLimit: { async limit() { return { success: true }; } }
    }),
    (error) => {
      assert.ok(error instanceof DouyinParseError);
      assert.ok(error.diagnostics.includes('browser-run:challenge-page'));
      assert.ok(!JSON.stringify(error.diagnostics).includes(id));
      return true;
    }
  );
});

test('Browser-only canary handles missing binding and global rate limit without a browser launch', async () => {
  await assert.rejects(
    resolveDouyin(new URL('https://www.douyin.com/video/' + id), { browserOnly: true }),
    (error) => {
      assert.ok(error.diagnostics.includes('browser-run:not-configured'));
      return true;
    }
  );
  let launched = 0;
  await assert.rejects(
    resolveDouyin(new URL('https://www.douyin.com/video/' + id), {
      browserOnly: true,
      browser: { async quickAction() { launched += 1; throw new Error('unexpected'); } },
      browserRateLimit: { async limit() { return { success: false }; } }
    }),
    (error) => {
      assert.ok(error.diagnostics.includes('browser-run:rate-limited'));
      return true;
    }
  );
  assert.equal(launched, 0);
});

test('Douyin normal parser never launches Browser Run unless fallback explicitly enabled', async () => {
  let launched = 0;
  const browser = { async quickAction() { launched += 1; return asJson({ success: true, result: renderedHtml }); } };
  const failure = async (input) => {
    const url = String(input);
    if (url.includes('ttwid.bytedance.com')) return asJson({});
    if (url.includes('/aweme/')) return asJson({});
    return asHtml('<html>No media</html>');
  };

  await assert.rejects(withMockFetch(failure, () => resolveDouyin(
    new URL('https://www.douyin.com/video/' + id),
    { browser, browserRateLimit: { async limit() { return { success: true }; } } }
  )), /could not be parsed/i);
  assert.equal(launched, 0);

  const media = await withMockFetch(failure, () => resolveDouyin(
    new URL('https://www.douyin.com/video/' + id),
    { browser, browserFallback: true, browserRateLimit: { async limit() { return { success: true }; } } }
  ));
  assert.equal(media.videoUrl, mediaUrl);
  assert.equal(launched, 1);
});

test('Cloudflare Browser Run is protected and opt-in at Worker entrypoint', () => {
  const worker = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(worker, /Authorized browser test token required/);
  assert.match(worker, /x-douyin-browser-token/);
  assert.match(worker, /DOUYIN_BROWSER_FALLBACK === "1"/);
  const config = JSON.parse(wrangler);
  assert.equal(config.browser.binding, 'BROWSER');
  assert.equal(config.ratelimits[0].name, 'DOUYIN_BROWSER_RATE_LIMIT');
  assert.ok(config.ratelimits[0].simple.limit <= 2);
  assert.equal(config.ratelimits[0].simple.period, 60);
});

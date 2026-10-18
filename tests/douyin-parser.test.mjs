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

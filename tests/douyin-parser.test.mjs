import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/providers/douyin.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { resolveDouyin } = await import('data:text/javascript;base64,' + Buffer.from(transpiled).toString('base64'));

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

import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const sitemap=read('public/sitemap.xml');
const urls=[...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<\/url>/g)];
assert.ok(urls.length>=15,'expected the existing core pages in the sitemap');
const seen=new Set();
for(const [,url,lastmod] of urls){
  assert.ok(url.startsWith('https://savedownloader.com/'),'only canonical site URLs in sitemap');
  assert.ok(!seen.has(url),'duplicate sitemap URL: '+url);
  seen.add(url);
  assert.match(lastmod,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(lastmod<='2026-09-27','sitemap cannot claim a future lastmod');
  const route=new URL(url).pathname;
  const pathname=route==='/'?'public/index.html':'public'+route+'index.html';
  assert.ok(existsSync(new URL(pathname,root)),url+' sitemap target missing: '+pathname);
  const html=read(pathname);
  assert.ok(html.includes('rel="canonical" href="'+url+'"'),pathname+' canonical mismatch');
  assert.ok(html.includes('name="robots" content="index,follow'),pathname+' should be indexable');
}
const article='https://savedownloader.com/instagram-carousel-zip-guide/';
assert.ok(seen.has(article),'mobile ZIP guide missing from sitemap');
for(const file of ['public/index.html','public/guides/index.html','public/instagram-downloader/index.html','public/how-to-download-instagram-videos-and-photos/index.html']){
  assert.ok(read(file).includes('href="/instagram-carousel-zip-guide/"'),file+' is not linked to new guide');
}
const guide=read('public/instagram-carousel-zip-guide/index.html');
for(const route of ['/guides/','/instagram-downloader/','/responsible-media-downloads/','/video-download-troubleshooting/']){
  assert.ok(guide.includes('href="'+route+'"'),'guide lacks relevant link to '+route);
}
const script=guide.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.ok(script,'missing guide structured data');
const ld=JSON.parse(script[1]);
assert.equal(ld['@graph'][0].mainEntityOfPage,article);
console.log('Sitemap, canonical, internal discovery and article schema checks passed ('+seen.size+' pages).');

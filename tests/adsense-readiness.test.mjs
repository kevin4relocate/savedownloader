import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('three downloader pages accurately disclose permissions and link rights guide',()=>{
  for(const page of ['public/instagram-downloader/index.html','public/tiktok-downloader/index.html','public/douyin-downloader/index.html']){
    const html=read(page);
    assert.match(html,/Public visibility alone does not grant download rights/);
    assert.match(html,/href="\/responsible-media-downloads\/"/);
    assert.match(html,/href="\/privacy\/"/);
    assert.match(html,/href="\/terms\/"/);
    assert.match(html,/href="\/copyright\/"/);
  }
});
test('rights guide and legal pages have navigable supporting policy text',()=>{
  const guide=read('public/responsible-media-downloads/index.html');
  for(const term of ['Public media does not automatically mean permission','/copyright/','/terms/'])assert.ok(guide.includes(term));
  for(const page of ['public/terms/index.html','public/copyright/index.html']){
    assert.match(read(page),/href="\/responsible-media-downloads\/"/);
  }
});
test('analytics consent never enables ad consent, and no ad script is deployed in source',()=>{
  const analytics=read('public/assets/analytics.js');
  for(const field of ['ad_storage','ad_user_data','ad_personalization']){
    assert.match(analytics,new RegExp(field+': ["\\\']denied["\\\']'));
  }
  const homepage=read('public/index.html');
  assert.doesNotMatch(homepage,/adsbygoogle|pagead2\\.googlesyndication/i);
  assert.equal(existsSync(new URL('../public/ads.txt',import.meta.url)),false,'Do not invent an AdSense publisher ID or ads.txt before account setup');
});
test('readiness gate preserves provider-policy review and certified CMP requirement',()=>{
  const doc=read('docs/adsense-readiness-audit-2026-09-27.md');
  assert.match(doc,/NOT YET VERIFIED FOR ADS/);
  assert.match(doc,/Google-certified IAB TCF CMP/);
  assert.match(doc,/Blocking policy\/legal review/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('all downloader pages enable mobile viewport and mobile navigation styles',()=>{
  for(const page of ['public/index.html','public/douyin-downloader/index.html','public/tiktok-downloader/index.html','public/instagram-downloader/index.html']){
    const html=read(page);
    assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1">/);
    assert.match(html,/\/assets\/nav\.css/);
    assert.match(html,/\/assets\/analytics\.js/);
    assert.match(html,/<label class="visually-hidden"/);
  }
});
test('iPhone users get explicit save-file actions rather than async automatic blob clicks',()=>{
  for(const name of ['public/assets/app.js','public/assets/tiktok.js','public/assets/instagram.js']){
    const js=read(name);
    assert.match(js,/const isIOS=/);
    assert.match(js,/navigator\.maxTouchPoints>1/);
    assert.match(js,/Save file/);
  }
  const ig=read('public/assets/instagram.js');
  assert.match(ig,/showManualSave\(zip/);
  assert.match(ig,/showNativeLink/);
  const app=read('public/assets/app.js');
  assert.match(app,/if\(isIOS\(\)\)downloadDouyinViaBackend/);
});
test('touch target CSS and Safari focus input size remain legible',()=>{
  const styles=read('public/assets/styles.css');
  const nav=read('public/assets/nav.css');
  const gallery=read('public/assets/media-gallery.css');
  const consent=read('public/assets/consent.css');
  assert.match(styles,/\.urlbox\{font-size:16px/);
  assert.match(styles,/\.mobile-save-link/);
  assert.match(nav,/min-height:44px/);
  assert.match(gallery,/\.media-save-link/);
  assert.match(consent,/safe-area-inset-bottom/);
});

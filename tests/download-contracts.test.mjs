import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../vercel-tiktok-api/api/download.js';

const file=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

function mockResponse(){
  const headers=new Map();
  return {
    statusCode:200,
    headers,
    payload:null,
    setHeader(name,value){headers.set(name.toLowerCase(),value);return this;},
    status(code){this.statusCode=code;return this;},
    json(value){this.payload=value;return this;},
    end(){return this;}
  };
}
function req(url,origin='https://savedownloader.com'){
  return {method:'GET',query:{url},headers:{origin}};
}
const postUrl='https://www.tiktok.com/@fixture/video/1234567890';
const html='<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'+
  JSON.stringify({__DEFAULT_SCOPE__:{'webapp.video-detail':{itemInfo:{itemStruct:{
    id:'1234567890',
    video:{playAddr:{urlList:['https://v.tiktokcdn.com/fixture.mp4']}}
  }}}}})+'</script>';
function tiktokPostResponse(){
  const response=new Response(html,{status:200,headers:{'content-type':'text/html'}});
  Object.defineProperty(response,'url',{value:postUrl});
  return response;
}
async function withMockFetch(callback,run){
  const previous=globalThis.fetch;
  globalThis.fetch=callback;
  try{return await run();}finally{globalThis.fetch=previous;}
}
test('rejects unsupported TikTok URLs without outbound fetch',async()=>{
  const res=mockResponse();
  await withMockFetch(()=>{throw Error('must not fetch')},()=>handler(req('https://example.com/post'),res));
  assert.equal(res.statusCode,422);
  assert.equal(res.payload.ok,false);
});
test('TikTok download rejects non-video upstream payloads',async()=>{
  const res=mockResponse();
  let calls=0;
  await withMockFetch(async()=>{
    calls++;
    return calls===1?tiktokPostResponse():new Response('<html>Blocked</html>',{status:200,headers:{'content-type':'text/html'}});
  },()=>handler(req(postUrl),res));
  assert.equal(res.statusCode,502);
  assert.equal(res.payload.ok,false);
  assert.equal(calls,2);
  assert.equal(res.headers.get('access-control-allow-origin'),'https://savedownloader.com');
});
test('TikTok timeout returns actionable 504',async()=>{
  const res=mockResponse();
  await withMockFetch(async()=>{throw new DOMException('Timed out','TimeoutError')},()=>handler(req(postUrl),res));
  assert.equal(res.statusCode,504);
  assert.match(res.payload.error,/too long/i);
});
test('first-party CORS rejects arbitrary origins',async()=>{
  const res=mockResponse();
  await withMockFetch(async()=>{throw new DOMException('Timed out','TimeoutError')},()=>handler(req(postUrl,'https://example.com'),res));
  assert.equal(res.headers.has('access-control-allow-origin'),false);
});
test('download frontends use explicit error and response events',()=>{
  for(const path of ['public/assets/app.js','public/assets/tiktok.js','public/assets/instagram.js']){
    const source=file(path);
    assert.match(source,/download_failed/);
    assert.match(source,/download_response_ok/);
    assert.match(source,/AbortSignal\.timeout|controller\.abort/);
  }
  const instagram=file('public/assets/instagram.js');
  assert.match(instagram,/maxZipBytes/);
  assert.match(instagram,/Download items individually/i);
});
test('Worker media routes reject non-media upstream responses',()=>{
  const worker=file('src/index.ts');
  assert.match(worker,/setTimeout\(\(\) => controller\.abort\(\), 25000\)/);
  assert.match(worker,/clearTimeout\(timer\)/);
  assert.match(worker,/application\\\/octet-stream/);
  assert.match(worker,/timedOut \? 504/);
});

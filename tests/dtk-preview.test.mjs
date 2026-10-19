import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const mod=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const dtkSrc=mod(compile(read('src/providers/dtk.ts')));
const {resolveDouyinDtk,validateDtkBaseUrl,DtkPreviewError}=await import(dtkSrc);
const workerSrc=compile(read('src/index.ts'))
  .replaceAll('from "./providers/dtk"','from "'+dtkSrc+'"')
  .replaceAll('from "./providers/douyin"','from "'+mod(compile(read('src/providers/douyin.ts')))+'"')
  .replaceAll('from "./providers/tiktok"','from "'+mod(compile(read('src/providers/tiktok.ts')))+'"')
  .replaceAll('from "./providers/instagram"','from "'+mod(compile(read('src/providers/instagram.ts')))+'"');
const worker=(await import(mod(workerSrc))).default;
const id='7668944508008610298';
const post='https://www.douyin.com/video/'+id;
const media='https://v3.douyinvod.com/example.mp4';
const key='dtk_mock_test_key_private';
const token='test-token-that-is-long-enough-for-private-branch';
const content={platform:'douyin',content_id:id,kind:'video',title:'Public post',
  author:{nickname:'Uploader'},is_private:false,is_deleted:false,
  media:{video:{url:media},covers:[{url:'https://v3.douyinvod.com/cover.jpg'}],images:[]}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const valid=json({success:true,data:content,error:null,meta:{}});
const env=()=>({DTK_API_URL:'https://dtk.example.com/',DTK_API_KEY:key,DTK_TEST_TOKEN:token,
  DOUYIN_BROWSER_RATE_LIMIT:{limit:async({key:bucket})=>{assert.equal(bucket,'dtk-preview-public');return{success:true}}}});
const workerReq=(uri,secret=token,method='POST')=>new Request('https://preview.example.com'+uri,{
  method,headers:{'content-type':'application/json','x-dtk-test-token':secret},
  ...(method==='POST'?{body:JSON.stringify({url:post})}:{})
});
async function withMock(fn,run){const prev=globalThis.fetch;globalThis.fetch=fn;try{return await run()}finally{globalThis.fetch=prev}}

test('DTK v5 normalises the actual Content shape and keeps api key server-side',async()=>{
  let count=0;
  const result=await resolveDouyinDtk(new URL(post),{
    baseUrl:'https://dtk.example.com/',apiKey:key,
    fetcher:async(url,init)=>{
      count++;
      assert.equal(url,'https://dtk.example.com/api/v1/parse?wait=25');
      assert.equal(init.headers['x-api-key'],key);
      assert.equal(JSON.parse(init.body).include_raw,false);
      return valid.clone();
    }
  });
  assert.equal(result.id,id);
  assert.equal(result.videoUrl,media);
  assert.equal(result.author,'Uploader');
  assert.equal(result.provider,'dtk');
  assert.equal(count,1);
  assert.ok(!('raw' in result));
});

test('DTK v5 async 202 completion uses task poll endpoint',async()=>{
  const uuid='12345678-1234-1234-1234-123456789012';
  let count=0;
  const result=await resolveDouyinDtk(new URL(post),{
    baseUrl:'https://dtk.example.com/',apiKey:key,sleep:async()=>{},
    fetcher:async(url)=>{
      count++;
      if(count===1)return json({success:true,data:{task_id:uuid,state:'running'}},202);
      assert.equal(url,'https://dtk.example.com/api/v1/tasks/'+uuid);
      if(count===2)return json({success:true,data:{state:'running'}});
      return json({success:true,data:{state:'done',data:content}});
    }
  });
  assert.equal(result.videoUrl,media);
  assert.equal(count,3);
});

test('server URL validation refuses unsafe origins and unrelated source inputs',async()=>{
  for(const u of ['http://127.0.0.1:8000/','http://dtk.example.com/',
    'https://127.0.0.1/','https://dtk.example.com/path',
    'https://user:pass@dtk.example.com/']){
    assert.throws(()=>validateDtkBaseUrl(u,false));
  }
  assert.equal(validateDtkBaseUrl('http://127.0.0.1:8000/',true),'http://127.0.0.1:8000');
  await assert.rejects(resolveDouyinDtk(new URL('https://notdouyin.example/video/'+id),{
    baseUrl:'https://dtk.example.com/',apiKey:key,
    fetcher:async()=>{throw Error('should not fetch')}
  }),e=>e.reason==='invalid-input');
});

test('DTK rejects mismatched, private and invalid CDN media results',async()=>{
  const cases=[{...content,content_id:'99999999999999999'},
    {...content,is_private:true},
    {...content,media:{video:{url:'https://invalid.example/mp4'}}}];
  for(const item of cases){
    await assert.rejects(resolveDouyinDtk(new URL(post),{
      baseUrl:'https://dtk.example.com/',apiKey:key,
      fetcher:async()=>json({success:true,data:item})
    }),e=>e instanceof DtkPreviewError);
  }
});

test('DTK identity exhaustion does not leak remote messages',async()=>{
  await assert.rejects(resolveDouyinDtk(new URL(post),{
    baseUrl:'https://dtk.example.com/',apiKey:key,
    fetcher:async()=>json({success:false,error:{code:'IDENTITY_POOL_EXHAUSTED',message:'cookie=abc'}},503)
  }),e=>e.reason==='no-identity'&&!e.message.includes('cookie'));
});

test('preview endpoint rejects missing operator token before accessing DTK',async()=>{
  await withMock(async()=>{throw Error('must not be called')},async()=>{
    const resp=await worker.fetch(workerReq('/api/dtk/resolve','wrong'),env());
    assert.equal(resp.status,403);
    assert.equal((await resp.json()).ok,false);
  });
});

test('preview Worker resolves public video using self-hosted DTK',async()=>{
  await withMock(async(input,init)=>{
    assert.match(String(input),/\/api\/v1\/parse\?wait=25$/);
    assert.equal(init.headers['x-api-key'],key);
    return valid.clone();
  },async()=>{
    const resp=await worker.fetch(workerReq('/api/dtk/resolve'),env());
    assert.equal(resp.status,200);
    const body=await resp.json();
    assert.equal(body.data.videoUrl,media);
  });
});

test('preview download fetches matching media file and streams it',async()=>{
  let calls=0;
  await withMock(async(input)=>{
    calls++;
    const url=String(input);
    if(url.includes('/api/v1/parse'))return valid.clone();
    if(url.startsWith(media))return new Response(new Uint8Array([1,2,3]),{
      headers:{'content-type':'video/mp4','content-length':'3'}
    });
    throw Error('unexpected URL');
  },async()=>{
    const resp=await worker.fetch(workerReq('/api/dtk/download?url='+encodeURIComponent(post),token,'GET'),env());
    assert.equal(resp.status,200);
    assert.equal(resp.headers.get('content-type'),'video/mp4');
    assert.equal(resp.headers.get('content-disposition'),'attachment; filename="douyin-'+id+'.mp4"');
    assert.deepEqual([...new Uint8Array(await resp.arrayBuffer())],[1,2,3]);
    assert.equal(calls,2);
  });
});

test('staging Douyin page defaults to DTK and ?dtk=0 compares the Vercel baseline',()=>{
  const app=read('public/assets/app.js');
  assert.match(app,/new URLSearchParams\(location.search\)\.get\('dtk'\)!=='0'/);
  assert.match(app,/\/api\/dtk\/resolve/);
  assert.match(app,/\/api\/dtk\/download/);
  assert.match(app,/dtkPreviewTokenInput\.type='password'/);
  assert.match(app,/DOUYIN_RESOLVE_API=VERCEL_BASE/);
  assert.ok(!app.includes(key));
});


test('DTK Cloudflare Access service token is forwarded only as server-side request headers',async()=>{
  const clientId='example-client-id.access';
  const clientSecret='example-client-secret';
  let authCalled=false;
  const result=await resolveDouyinDtk(new URL(post),{
    baseUrl:'https://dtk.example.com/',apiKey:key,
    accessClientId:clientId,accessClientSecret:clientSecret,
    fetcher:async(_url,init)=>{
      assert.equal(init.headers['CF-Access-Client-Id'],clientId);
      assert.equal(init.headers['CF-Access-Client-Secret'],clientSecret);
      assert.equal(init.headers['x-api-key'],key);
      authCalled=true;
      return valid.clone();
    }
  });
  assert.ok(authCalled);
  assert.equal(result.id,id);
  assert.ok(!JSON.stringify(result).includes(clientSecret));
});
test('DTK refuses half-configured Cloudflare Access tokens before network calls',async()=>{
  let contacted=false;
  await assert.rejects(resolveDouyinDtk(new URL(post),{
    baseUrl:'https://dtk.example.com/',apiKey:key,
    accessClientId:'id-only',
    fetcher:async()=>{contacted=true;return valid.clone()}
  }),e=>e.reason==='bad-config');
  assert.equal(contacted,false);
});
test('Cloudflare staging configuration is independently rate-limited and has no production routes',()=>{
  const jsonc=JSON.parse(read('wrangler.jsonc'));
  assert.equal(jsonc.name,'savedownloader');
  assert.ok(jsonc.previews);
  assert.equal(jsonc.previews.vars.DTK_PREVIEW_MODE,'1');
  assert.notEqual(jsonc.ratelimits[0].namespace_id,jsonc.previews.ratelimits[0].namespace_id);
  assert.equal(jsonc.previews.ratelimits[0].name,'DOUYIN_BROWSER_RATE_LIMIT');
  assert.ok(!('routes' in jsonc.previews));
  const manifest=JSON.parse(read('package.json'));
  assert.ok(Number(manifest.devDependencies.wrangler.split('.')[1])>=136);
  assert.equal(manifest.scripts.preview,'wrangler preview');
});

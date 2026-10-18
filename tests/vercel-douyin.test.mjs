import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import resolveHandler from '../vercel-tiktok-api/api/douyin-resolve.js';
import downloadHandler from '../vercel-tiktok-api/api/douyin-download.js';
import { assertPublicDouyinUrl, resolvePublicDouyin, DouyinUnavailable } from '../vercel-tiktok-api/lib/douyin.js';

const id = '7668944508008610298';
const post = 'https://www.douyin.com/video/' + id;
const file = 'https://v3.douyinvod.com/public-test.mp4';
const item = {aweme_id:id,desc:'Public test',author:{nickname:'Creator'},video:{playAddr:{urlList:[file]}}};
const asJson = data => new Response(JSON.stringify(data), {
  status:200,headers:{'content-type':'application/json'}
});

class MockResponse extends PassThrough {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.payload = null;
    this.bodyChunks = [];
    this.on('data',chunk=>this.bodyChunks.push(chunk));
  }
  status(code) {this.statusCode=code;return this;}
  setHeader(name,value) {this.headers.set(name.toLowerCase(),value);return this;}
  getHeader(name) {return this.headers.get(name.toLowerCase());}
  removeHeader(name) {this.headers.delete(name.toLowerCase());}
  json(value) {this.payload=value;this.end(JSON.stringify(value));return this;}
}
async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {return await run();} finally {globalThis.fetch=previous;}
}
function resolveRequest(url=post, origin='https://savedownloader.com') {
  return {method:'POST', headers:{origin,'content-type':'application/json'},body:{url}};
}

test('Vercel Douyin resolver returns matching, validated public media without credentials',async()=>{
  const calls=[];
  const response=new MockResponse();
  await withFetch(async input=>{
    const url=String(input);
    calls.push(url);
    assert.match(url,/^https:\/\/www\.iesdouyin\.com/);
    return asJson({item_list:[item]});
  },()=>resolveHandler(resolveRequest(),response));
  assert.equal(response.statusCode,200);
  assert.equal(response.payload.ok,true);
  assert.equal(response.payload.data.platform,'douyin');
  assert.equal(response.payload.data.id,id);
  assert.equal(response.payload.data.videoUrl,file);
  assert.equal(response.getHeader('access-control-allow-origin'),'https://savedownloader.com');
  assert.equal(response.getHeader('x-savedownloader-resolver'),'vercel-douyin');
  assert.equal(calls.length,1);
});

test('Vercel accepts redirecting public Douyin short links but never follows external redirect hosts',async()=>{
  const touched=[];
  await withFetch(async input=>{
    const url=String(input);touched.push(url);
    if(url.startsWith('https://v.douyin.com/')) return new Response(null,{
      status:302,headers:{location:post}
    });
    return asJson({item_list:[item]});
  },async()=>{
    const result=await resolvePublicDouyin('https://v.douyin.com/test123');
    assert.equal(result.id,id);
    assert.equal(touched.length,3); // short URL, canonical URL, then metadata API
  });
  let hits=0;
  await assert.rejects(withFetch(async()=>{
    hits++;
    return new Response(null,{status:302,headers:{location:'https://internal.example/private'}});
  },()=>resolvePublicDouyin('https://v.douyin.com/test123')),error=>{
    assert.ok(error instanceof DouyinUnavailable);
    assert.ok(error.diagnostics.includes('share-link:network-error'));
    return true;
  });
  assert.equal(hits,1,'should never fetch the external redirect');
});

test('Vercel falls back to public hydration when API returns HTTP 403',async()=>{
  const html='<script id="__NEXT_DATA__" type="application/json">'+
    JSON.stringify({props:{pageProps:{aweme_detail:item}}})+'</script>';
  const response=new MockResponse();
  await withFetch(async input=>{
    const url=String(input);
    if(url.includes('/aweme/') || url.includes('/web/api/v2/'))return new Response('',{status:403});
    return new Response(html,{status:200,headers:{'content-type':'text/html'}});
  },()=>resolveHandler(resolveRequest(),response));
  assert.equal(response.statusCode,200);
  assert.equal(response.payload.data.videoUrl,file);
});

test('Vercel reports upstream 403 and challenge pages without exposing HTML or post IDs in diagnostics',async()=>{
  const response=new MockResponse();
  await withFetch(async input=>{
    const url=String(input);
    if(url.includes('/web/api/v2/'))return new Response('',{status:200});
    if(url.includes('/aweme/v1/web/'))return new Response('',{status:403});
    return new Response('<html>__ac_nonce required</html>',{status:200});
  },()=>resolveHandler(resolveRequest(),response));
  assert.equal(response.statusCode,422);
  assert.equal(response.payload.ok,false);
  assert.ok(response.payload.diagnostics.includes('ies-iteminfo:empty-body'));
  assert.ok(response.payload.diagnostics.includes('desktop-detail:http-403'));
  assert.ok(response.payload.diagnostics.includes('original-page:challenge-page'));
  assert.ok(!JSON.stringify(response.payload.diagnostics).includes(id));
  assert.ok(!JSON.stringify(response.payload.diagnostics).includes('http://'));
});

test('Vercel rejects unapproved URLs and never fetches private destinations',async()=>{
  for(const url of [
    'https://127.0.0.1/video/'+id,
    'https://example.org/video/'+id,
    'http://www.douyin.com/video/'+id,
    'https://douyin.com.evil.example/video/'+id,
    'https://u:p@www.douyin.com/video/'+id
  ]) {
    assert.throws(()=>assertPublicDouyinUrl(url));
  }
  const response=new MockResponse();
  await withFetch(()=>{throw Error('Must never fetch invalid host')},
    ()=>resolveHandler(resolveRequest('https://example.com/video/'+id),response));
  assert.equal(response.statusCode,422);
  assert.equal(response.payload.ok,false);
});

test('Vercel refuses unrelated post media and wrong CDN hosts',async()=>{
  const fake={...item,aweme_id:'9999999999999999999'};
  assert.equal(
    (await withFetch(async input=>{
      if(String(input).includes('/aweme/') || String(input).includes('/web/api/v2/')) return asJson({aweme_detail:fake});
      return new Response('<script type="application/json">'+JSON.stringify({item_list:[fake]})+'</script>');
    },async()=>{
      try{await resolvePublicDouyin(post);return 'wrong';}
      catch(error){return error instanceof DouyinUnavailable ? 'unavailable':'wrong';}
    })), 'unavailable'
  );
});

test('Vercel Douyin download streams media from validated CDN with first-party CORS',async()=>{
  const response=new MockResponse();
  let mediaCalls=0;
  await withFetch(async input=>{
    const url=String(input);
    if(url.includes('/web/api/v2/')) return asJson({item_list:[item]});
    if(url===file) {
      mediaCalls++;
      return new Response(new Uint8Array([1,2,3]),{
        status:200,headers:{'content-type':'video/mp4','content-length':'3'}
      });
    }
    throw Error('unexpected upstream: '+url);
  },async()=>{
    await downloadHandler({
      method:'GET',headers:{origin:'https://savedownloader.com'},
      query:{url:post}
    },response);
    await once(response,'finish');
  });
  assert.equal(response.statusCode,200);
  assert.equal(response.getHeader('content-type'),'video/mp4');
  assert.equal(response.getHeader('content-disposition'),'attachment; filename="douyin-'+id+'.mp4"');
  assert.equal(response.getHeader('access-control-allow-origin'),'https://savedownloader.com');
  assert.deepEqual(Buffer.concat(response.bodyChunks),Buffer.from([1,2,3]));
  assert.equal(mediaCalls,1);
});

test('Vercel does not permit arbitrary web origins in CORS',async()=>{
  const response=new MockResponse();
  await withFetch(async()=>asJson({item_list:[item]}),()=>resolveHandler(
    resolveRequest(post,'https://evil.example'),response
  ));
  assert.equal(response.statusCode,200);
  assert.equal(response.getHeader('access-control-allow-origin'),undefined);
});

test('Vercel uses an Asia region for Douyin without relocating TikTok',async()=>{
  const {readFileSync}=await import('node:fs');
  const config=JSON.parse(readFileSync(new URL('../vercel-tiktok-api/vercel.json',import.meta.url),'utf8'));
  assert.deepEqual(config.regions,['iad1']);
  assert.deepEqual(config.functions['api/douyin-resolve.js'].regions,['hkg1']);
  assert.deepEqual(config.functions['api/douyin-download.js'].regions,['hkg1']);
  assert.ok(config.functions['api/douyin-resolve.js'].maxDuration<=60);
});


test('Vercel can recover a matching public post from Xigua share HTML when Douyin APIs fail',async()=>{
  let ixiguaSeen=0;
  const html='<script type="application/json" id="__NEXT_DATA__">'+
    JSON.stringify({data:{aweme_detail:item}})+'</script>';
  const result=await withFetch(async input=>{
    const url=String(input);
    if(url.startsWith('https://m.ixigua.com/douyin/share/video/')) {
      ixiguaSeen++;
      return new Response(html,{status:200});
    }
    if(url.includes('/aweme/v1/')||url.includes('/web/api/v2/')) return new Response('',{status:403});
    return new Response('<html>__ac_nonce</html>',{status:200});
  },()=>resolvePublicDouyin(post));
  assert.equal(result.id,id);
  assert.equal(result.videoUrl,file);
  assert.equal(ixiguaSeen,1);
});

test('Vercel does not follow Xigua share redirects to unauthorized hosts',async()=>{
  const visited=[];
  await assert.rejects(withFetch(async input=>{
    const url=String(input);
    visited.push(url);
    if(url.startsWith('https://m.ixigua.com/douyin/share/video/')) {
      return new Response(null,{status:302,headers:{location:'https://internal.example/private'}});
    }
    if(url.includes('/aweme/v1/')||url.includes('/web/api/v2/')) return new Response('',{status:403});
    return new Response('<html>__ac_nonce</html>',{status:200});
  },()=>resolvePublicDouyin(post)),error=>{
    assert.ok(error instanceof DouyinUnavailable);
    assert.ok(error.diagnostics.includes('ixigua-share:network-error'));
    return true;
  });
  assert.ok(visited.some(url=>url.startsWith('https://m.ixigua.com/douyin/share/video/')));
  assert.ok(!visited.some(url=>url.startsWith('https://internal.example/')));
});

test('Vercel can recover public Jingxuan hydration by modal_id',async()=>{
  const html='<script type="application/json">'+
    JSON.stringify({aweme_detail:item})+'</script>';
  const result=await withFetch(async input=>{
    const url=String(input);
    if(url.includes('www.douyin.com/jingxuan?modal_id='))return new Response(html,{status:200});
    if(url.includes('/aweme/v1/')||url.includes('/web/api/v2/'))return new Response('',{status:403});
    return new Response('<html>__ac_nonce</html>',{status:200});
  },()=>resolvePublicDouyin(post));
  assert.equal(result.videoUrl,file);
});

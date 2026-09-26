/**
 * Read-only production audit. This checks live deployment freshness and negative
 * API contracts. It intentionally never downloads third-party media.
 * Run on GitHub Actions after deployment (node >=22).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const BASE=(process.env.BASE_URL||'https://savedownloader.com').replace(/\/$/,'');
const VERCEL=(process.env.TIKTOK_DOWNLOAD_API||'https://savedownloader-tiktok-api.vercel.app/api/download');
const report={checked_at:new Date().toISOString(),base_url:BASE,commit:process.env.GITHUB_SHA||null,checks:[],summary:{passed:0,failed:0,warnings:0}};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const local=file=>fs.readFileSync(file);
const check=(name,pass,details='',severity='error')=>{
  report.checks.push({name,status:pass?'PASS':severity==='warning'?'WARN':'FAIL',details});
  if(pass)report.summary.passed++;
  else if(severity==='warning')report.summary.warnings++;
  else report.summary.failed++;
  console.log(`[${pass?'PASS':severity==='warning'?'WARN':'FAIL'}] ${name}: ${details}`);
};
const fetchTimed=async(url,opts={})=>{
  const response=await fetch(url,{redirect:'follow',headers:{'accept-encoding':'identity',...(opts.headers||{})},...opts,signal:AbortSignal.timeout(18000)});
  return response;
};
const attempt=async(name,operation,verify,options={})=>{
  try{
    const value=await operation();
    const result=verify(value);
    const tuple=Array.isArray(result)?result:[result,''];
    check(name,Boolean(tuple[0]),String(tuple[1]||''),options.severity||'error');
  }catch(err){
    check(name,false,err instanceof Error?err.message:String(err),options.severity||'error');
  }
};
async function audit(){
  // Wait for the Cloudflare and Vercel deployments triggered by the latest
  // repository change. Never declare a stale asset fresh merely because 200 returned.
  const assets=[
    'assets/app.js','assets/tiktok.js','assets/instagram.js',
    'assets/styles.css','assets/nav.css','assets/media-gallery.css'
  ];
  const localHashes=new Map(assets.map(file=>[file,sha(local(path.join('public',file)))]));
  let assetResults=[];
  for(let cycle=0;cycle<7;cycle++){
    assetResults=await Promise.all(assets.map(async file=>{
      try{
        const response=await fetchTimed(`${BASE}/${file}?production_audit=${Date.now()}`,{headers:{'cache-control':'no-cache'}});
        const bytes=Buffer.from(await response.arrayBuffer());
        return {file,status:response.status,matching:response.ok&&sha(bytes)===localHashes.get(file),length:bytes.length};
      }catch(e){return{file,status:'network error',matching:false,error:String(e)};}
    }));
    if(assetResults.every(x=>x.matching))break;
    if(cycle<6)await new Promise(resolve=>setTimeout(resolve,20000));
  }
  for(const item of assetResults){
    check('deployed source '+item.file,item.matching,JSON.stringify(item));
  }

  await attempt('Cloudflare API health',()=>fetchTimed(BASE+'/api/health').then(r=>Promise.all([r,r.json()])),([r,data])=>[
    r.status===200&&data?.ok===true&&['tiktok','douyin','instagram'].every(x=>data.providers?.includes(x)),
    `HTTP ${r.status}, version ${data.version||'unknown'}, deployment ${data.deployment?.id||'unspecified'}`
  ]);
  const urls=[
    '/','/instagram-downloader/','/tiktok-downloader/','/douyin-downloader/',
    '/guides/','/how-to-download-instagram-videos-and-photos/',
    '/how-to-download-tiktok-videos/','/how-to-download-douyin-videos/',
    '/how-to-download-douyin-short-links/','/video-download-troubleshooting/',
    '/responsible-media-downloads/','/instagram-carousel-zip-guide/',
    '/about/','/contact/','/privacy/','/cookies/','/terms/','/copyright/'
  ];
  for(const route of urls){
    const canonical=BASE+route;
    await attempt('page '+route,async()=>{
      const response=await fetchTimed(canonical);
      return {response,html:await response.text()};
    },({response,html})=>[
      response.status===200&&html.includes('<h1')&&html.includes(`rel="canonical" href="${canonical}"`)&&!/name="robots"[^>]*noindex/i.test(html),
      `HTTP ${response.status}; canonical ${html.includes(`href="${canonical}"`)}; h1 ${html.includes('<h1')}`
    ]);
  }
  await attempt('deployed ZIP guide is current',()=>fetchTimed(BASE+'/instagram-carousel-zip-guide/').then(r=>r.text()),html=>[
    html.includes('64 MB total')&&html.includes('32 MB limit per item')&&html.includes('Saving a ZIP on iPhone Safari'),
    'Must include P2 guide content matching current browser ZIP implementation'
  ]);

  const currentSitemap=local('public/sitemap.xml').toString();
  await attempt('production sitemap matches repository',async()=>{
    const response=await fetchTimed(BASE+'/sitemap.xml');
    return {response,body:await response.text()};
  },({response,body})=>[
    response.ok&&sha(body)===sha(currentSitemap),
    `HTTP ${response.status}; exact sitemap hash match: ${sha(body)===sha(currentSitemap)}`
  ]);
  await attempt('robots contains canonical sitemap',()=>fetchTimed(BASE+'/robots.txt').then(r=>r.text()),body=>[
    body.includes('Sitemap: https://savedownloader.com/sitemap.xml')&&body.includes('Disallow: /api/'),
    'Canonical sitemap advertised; API routes blocked'
  ]);

  await attempt('resolver rejects unrelated source',async()=>{
    const response=await fetchTimed(BASE+'/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://example.com/unsupported'})});
    return {response,body:await response.json()};
  },({response,body})=>[response.status===422&&body.ok===false&&typeof body.error==='string',`HTTP ${response.status}`]);

  await attempt('Instagram invalid item is rejected',async()=>{
    const response=await fetchTimed(BASE+'/api/download/instagram?url='+encodeURIComponent('https://www.instagram.com/p/example/')+'&item=999');
    return {response,body:await response.json()};
  },({response,body})=>[response.status===400&&body.ok===false,`HTTP ${response.status}`]);

  await attempt('TikTok Vercel health',async()=>{
    const response=await fetchTimed(VERCEL.replace(/\/download(?:\?.*)?$/,'/health'));
    return {response,body:await response.json()};
  },({response,body})=>[response.status===200&&body.ok===true&&body.service==='savedownloader-tiktok-api',`HTTP ${response.status}`]);

  await attempt('Vercel first-party CORS + invalid URL',async()=>{
    const response=await fetchTimed(VERCEL+'?url=invalid',{headers:{origin:BASE}});
    const body=await response.json();
    return {response,body};
  },({response,body})=>[
    response.status===422&&response.headers.get('access-control-allow-origin')===BASE&&body.ok===false,
    `HTTP ${response.status}; access-control-allow-origin=${response.headers.get('access-control-allow-origin')||'missing'}`
  ]);

  // Negative API tests do not establish positive media download success.
  check('live third-party successful downloads verified',false,'NOT RUN: requires authorized working Instagram/Douyin/TikTok posts; run existing Production Smoke Test with approved fixtures.','warning');
  check('real mobile devices verified',false,'NOT RUN: GitHub-hosted workflow cannot establish actual iPhone Safari/Android Chrome behavior.','warning');
}
try{await audit();}catch(e){check('audit execution',false,String(e));}
fs.mkdirSync('audit-results',{recursive:true});
fs.writeFileSync('audit-results/production-audit.json',JSON.stringify(report,null,2)+'\n');
console.log('AUDIT SUMMARY:',JSON.stringify(report.summary));
if(report.summary.failed)process.exitCode=1;

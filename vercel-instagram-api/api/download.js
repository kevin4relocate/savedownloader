import { Readable } from 'node:stream';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MEDIA_ROOTS=['cdninstagram.com','fbcdn.net'];

function isInstagramHost(hostname){
  const host=hostname.toLowerCase();
  return host==='instagram.com'||host.endsWith('.instagram.com');
}
function hostMatches(hostname,root){
  const host=hostname.toLowerCase();
  return host===root||host.endsWith(`.${root}`);
}
function isMediaHost(hostname){return MEDIA_ROOTS.some((root)=>hostMatches(hostname,root));}
function assertInstagramUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||!isInstagramHost(url.hostname))throw new Error('Please provide a public Instagram post or Reel URL.');
  if(!/^\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,30}\/?/i.test(url.pathname))throw new Error('Stories, profiles, and login-only pages are not supported.');
  return url;
}
function shortcode(url){return url.pathname.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,30})/i)?.[1]??null;}
function decodeHtml(value){return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function metaContent(html,key){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const pattern of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,'i')
  ]){
    const match=html.match(pattern);
    if(match?.[1])return decodeHtml(match[1]);
  }
  return null;
}
function normalizeMediaUrl(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const url=new URL(decodeHtml(value));
    if(url.protocol==='http:')url.protocol='https:';
    if(url.protocol!=='https:'||!isMediaHost(url.hostname))return null;
    return url.toString();
  }catch{return null;}
}
function largestImage(node){
  const resources=Array.isArray(node?.display_resources)?node.display_resources:[];
  const resource=[...resources].sort((a,b)=>Number(b?.config_width??b?.width??0)-Number(a?.config_width??a?.width??0))[0];
  const fromResource=normalizeMediaUrl(resource?.src??resource?.url);
  if(fromResource)return fromResource;
  const candidates=Array.isArray(node?.image_versions2?.candidates)?node.image_versions2.candidates:[];
  const candidate=[...candidates].sort((a,b)=>Number(b?.width??0)-Number(a?.width??0))[0];
  return normalizeMediaUrl(candidate?.url)||normalizeMediaUrl(node?.display_url)||normalizeMediaUrl(node?.image_url);
}
function bestVideo(node){
  const direct=normalizeMediaUrl(node?.video_url);
  if(direct)return direct;
  const versions=Array.isArray(node?.video_versions)?node.video_versions:[];
  const version=[...versions].sort((a,b)=>Number(b?.width??0)*Number(b?.height??0)-Number(a?.width??0)*Number(a?.height??0))[0];
  return normalizeMediaUrl(version?.url);
}
function nodeShortcode(node){return String(node?.shortcode??node?.code??node?.media?.code??'');}
function nodeHasMedia(node){return Boolean(bestVideo(node)||largestImage(node)||Array.isArray(node?.carousel_media)||Array.isArray(node?.edge_sidecar_to_children?.edges));}
function parsePayloads(html){
  const payloads=[];
  for(const match of html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const parsed=JSON.parse(match[1]);if(parsed&&typeof parsed==='object')payloads.push(parsed);}catch{}
  }
  const shared=html.match(/window\._sharedData\s*=\s*({[\s\S]*?})\s*;<\/script>/i);
  if(shared?.[1]){try{payloads.push(JSON.parse(shared[1]));}catch{}}
  for(const match of html.matchAll(/__additionalDataLoaded\([^,]+,\s*({[\s\S]*?})\s*\);/gi)){
    try{payloads.push(JSON.parse(match[1]));}catch{}
  }
  return payloads;
}
function findPostNode(root,expectedCode){
  const preferred=[root?.xdt_shortcode_media,root?.shortcode_media,root?.data?.xdt_shortcode_media,root?.data?.shortcode_media,root?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0]].filter(Boolean);
  for(const node of preferred){if(nodeHasMedia(node)&&(!expectedCode||!nodeShortcode(node)||nodeShortcode(node)===expectedCode))return node;}
  const stack=[root];let visited=0;
  while(stack.length&&visited<12000){
    const node=stack.pop();
    if(!node||typeof node!=='object')continue;
    visited+=1;
    if(!Array.isArray(node)&&nodeHasMedia(node)){
      const code=nodeShortcode(node);
      if(expectedCode&&code===expectedCode)return node;
    }
    const values=Array.isArray(node)?node.slice(0,300):Object.values(node);
    for(let i=values.length-1;i>=0;i-=1){const child=values[i];if(child&&typeof child==='object')stack.push(child);}
  }
  return null;
}
function mediaFromNode(node){
  const children=Array.isArray(node?.carousel_media)?node.carousel_media:Array.isArray(node?.edge_sidecar_to_children?.edges)?node.edge_sidecar_to_children.edges.map((edge)=>edge?.node).filter(Boolean):[];
  const source=children.length?children:[node];
  const media=[];
  for(const child of source.slice(0,50)){
    const video=bestVideo(child);
    if(video){media.push({type:'video',url:video});continue;}
    const image=largestImage(child);
    if(image)media.push({type:'image',url:image});
  }
  const seen=new Set();
  return media.filter((item)=>{if(seen.has(item.url))return false;seen.add(item.url);return true;});
}
async function fetchPage(input){
  let current=assertInstagramUrl(input);
  for(let i=0;i<6;i+=1){
    const response=await fetch(current,{redirect:'manual',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','accept-language':'en-US,en;q=0.9','referer':'https://www.instagram.com/'}});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location)throw new Error('Instagram returned an invalid redirect.');
      const next=new URL(location,current);
      if(next.protocol!=='https:'||!isInstagramHost(next.hostname))throw new Error('Instagram redirected to an unsupported host.');
      current=next;continue;
    }
    if(!response.ok)throw new Error(`Instagram returned HTTP ${response.status}.`);
    return {html:await response.text(),finalUrl:assertInstagramUrl(current.toString())};
  }
  throw new Error('Too many Instagram redirects.');
}
async function resolvePost(input){
  const source=assertInstagramUrl(input);
  const {html,finalUrl}=await fetchPage(source.toString());
  const code=shortcode(finalUrl)||shortcode(source)||'post';
  let media=[];
  for(const payload of parsePayloads(html)){
    const node=findPostNode(payload,code);
    if(!node)continue;
    const items=mediaFromNode(node);
    if(items.length){media=items;break;}
  }
  if(!media.length){
    const video=normalizeMediaUrl(metaContent(html,'og:video:secure_url'))||normalizeMediaUrl(metaContent(html,'og:video'));
    const image=normalizeMediaUrl(metaContent(html,'og:image'));
    if(video)media.push({type:'video',url:video});else if(image)media.push({type:'image',url:image});
  }
  if(!media.length)throw new Error('Instagram did not expose downloadable media for this public post to logged-out visitors.');
  return {code,sourceUrl:finalUrl.toString(),media};
}
async function fetchMedia(url,sourceUrl,range){
  let current=new URL(url);
  for(let i=0;i<6;i+=1){
    if(current.protocol!=='https:'||!isMediaHost(current.hostname))return null;
    const headers={'user-agent':UA,'accept':'video/mp4,image/avif,image/webp,image/apng,image/*,*/*;q=0.8','accept-language':'en-US,en;q=0.9','referer':sourceUrl};
    if(range)headers.range=range;
    const response=await fetch(current,{method:'GET',redirect:'manual',headers});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location)return null;
      const next=new URL(location,current);
      if(next.protocol==='http:')next.protocol='https:';
      if(!isMediaHost(next.hostname))return null;
      current=next;continue;
    }
    if(response.status!==200&&response.status!==206)return null;
    const type=(response.headers.get('content-type')||'').toLowerCase();
    if(type.includes('text/html')||type.includes('application/json'))return null;
    return response;
  }
  return null;
}
function extension(contentType,mediaType){
  const type=(contentType||'').toLowerCase();
  if(type.includes('video/mp4'))return 'mp4';
  if(type.includes('image/png'))return 'png';
  if(type.includes('image/webp'))return 'webp';
  if(type.includes('image/avif'))return 'avif';
  return mediaType==='video'?'mp4':'jpg';
}
export default async function handler(req,res){
  res.setHeader('cache-control','private, no-store');
  res.setHeader('x-robots-tag','noindex, nofollow, noarchive');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const raw=typeof req.query?.url==='string'?req.query.url.trim():'';
  const indexRaw=typeof req.query?.item==='string'?req.query.item:'0';
  const index=Number(indexRaw);
  if(!raw||raw.length>2048)return res.status(400).json({ok:false,error:'Please provide a public Instagram post or Reel URL.'});
  if(!Number.isInteger(index)||index<0||index>49)return res.status(400).json({ok:false,error:'Invalid media item.'});
  try{
    const resolved=await resolvePost(raw);
    const selected=resolved.media[index];
    if(!selected)return res.status(404).json({ok:false,error:'That media item is not available in this public post.'});
    const range=typeof req.headers.range==='string'&&/^bytes=\d*-\d*$/i.test(req.headers.range)?req.headers.range:null;
    const media=await fetchMedia(selected.url,resolved.sourceUrl,range);
    if(!media)return res.status(502).json({ok:false,error:"Instagram's media server refused this public media item."});
    for(const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']){
      const value=media.headers.get(name);if(value)res.setHeader(name,value);
    }
    const ext=extension(media.headers.get('content-type'),selected.type);
    const safeCode=String(resolved.code).replace(/[^0-9A-Za-z_-]/g,'')||'post';
    res.setHeader('content-disposition',`attachment; filename="instagram-${safeCode}-${String(index+1).padStart(2,'0')}.${ext}"`);
    res.statusCode=media.status;
    if(!media.body)return res.end();
    Readable.fromWeb(media.body).pipe(res);
  }catch(error){
    return res.status(422).json({ok:false,error:error instanceof Error?error.message:'Unable to download this Instagram media.'});
  }
}

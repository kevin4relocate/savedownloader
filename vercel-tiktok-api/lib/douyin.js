// Douyin's public web responses are not guaranteed to be available from Vercel.
// This module deliberately uses no credentials, CAPTCHA solving or private data.
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MEDIA_HOSTS = ['douyinvod.com','idouyinvod.com','douyincdn.com','zjcdn.com','bytecdn.cn','bytecdn.com','bytetos.com','ixigua.com','ixiguavideo.com','pstatp.com','snssdk.com','toutiao.com'];

export class DouyinUnavailable extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'DouyinUnavailable';
    this.diagnostics = diagnostics;
  }
}
export function isDouyinHost(host) {
  const value = String(host).toLowerCase();
  return ['douyin.com','iesdouyin.com'].some(root => value === root || value.endsWith('.' + root));
}
export function isDouyinMediaHost(host) {
  const value = String(host).toLowerCase();
  return MEDIA_HOSTS.some(root => value === root || value.endsWith('.' + root));
}
export function assertPublicDouyinUrl(value) {
  const raw = String(value ?? '').trim();
  const extracted = raw.match(/https:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/, '') ?? raw;
  if (extracted.length > 2048) throw new Error('Please enter a valid public Douyin link.');
  const url = new URL(extracted);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !isDouyinHost(url.hostname)) throw new Error('Please enter a public Douyin link.');
  return url;
}
export function normalizeDouyinMediaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !isDouyinMediaHost(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}
// The only non-Douyin public source permitted is this fixed Xigua share route.
// User-supplied URLs are still always restricted to Douyin hosts.
function assertPublicFetchUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Unsupported public source URL.');
  }
  if (isDouyinHost(url.hostname)) return url;
  if (url.hostname === 'm.ixigua.com' &&
      /^\/douyin\/share\/video\/\d{8,}\/?$/.test(url.pathname)) return url;
  throw new Error('Unsupported public source URL.');
}
function extractId(value) {
  for (const pattern of [
    /\/(?:video|note)\/(\d{8,})/,
    /[?&](?:modal_id|aweme_id|item_id)=(\d{8,})/
  ]) {
    const match = String(value).match(pattern);
    if (match) return match[1];
  }
  return null;
}
function firstUrl(value) {
  if (typeof value === 'string') return normalizeDouyinMediaUrl(value);
  if (!value || typeof value !== 'object') return null;
  const urls = value.url_list ?? value.urlList ?? value.UrlList ?? value.urls;
  if (!Array.isArray(urls)) return null;
  for (const item of urls) {
    const url = normalizeDouyinMediaUrl(item);
    if (url) return url;
  }
  return null;
}
function videoUrl(item) {
  const video = item?.video ?? item?.videoInfo;
  const rates = Array.isArray(video?.bit_rate) ? video.bit_rate : [];
  const options = [
    video?.play_addr, video?.playAddr, video?.play_addr_h264, video?.playAddrH264,
    video?.download_addr, video?.downloadAddr, video?.play_addr_lowbr,
    ...rates.flatMap(rate => [rate?.play_addr, rate?.playAddr])
  ];
  return options.map(firstUrl).find(Boolean) || null;
}
function images(item) {
  if (!Array.isArray(item?.images)) return [];
  return item.images.map(image => firstUrl(image) || firstUrl(image?.display_image)).filter(Boolean).slice(0, 30);
}
function findItem(root, expected) {
  const stack = [root];
  let inspected = 0;
  while (stack.length && inspected++ < 6500) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (!Array.isArray(node)) {
      const id = String(node.aweme_id ?? node.awemeId ?? node.aweme_id_str ?? '');
      if (id === expected && (videoUrl(node) || images(node).length)) return node;
    }
    const values = Array.isArray(node) ? node.slice(0, 300) : Object.values(node);
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] && typeof values[i] === 'object') stack.push(values[i]);
    }
  }
  return null;
}
function parseJson(value, percentEncoded = false) {
  try {
    let text = value.trim().replace(/;$/, '');
    if (percentEncoded) text = decodeURIComponent(text);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}
function parseHtml(html, id) {
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let found;
  while ((found = scripts.exec(html)) !== null) {
    const attrs = found[1];
    const content = found[2].trim();
    const name = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? '';
    if (['RENDER_DATA','__NEXT_DATA__','__UNIVERSAL_DATA_FOR_REHYDRATION__'].includes(name) || type === 'application/json') {
      const data = parseJson(content, name === 'RENDER_DATA');
      const item = data && findItem(data, id);
      if (item) return item;
    }
    for (const key of ['_ROUTER_DATA','_SSR_DATA','_SSR_HYDRATED_DATA']) {
      const anchor = new RegExp('window\\.' + key + '\\s*=\\s*', 'i').exec(content);
      if (!anchor) continue;
      const payload = parseJson(content.slice(anchor.index + anchor[0].length));
      const item = payload && findItem(payload, id);
      if (item) return item;
    }
  }
  return null;
}
function diagnoseFetchError(label, error, diagnostics) {
  diagnostics.push(label + ':' +
    (['TimeoutError','AbortError'].includes(error?.name) ? 'timeout' : 'network-error'));
}
async function requestPublic(url, headers, ms = 7500) {
  // Limit redirects to avoid cross-domain forwarding and SSRF.
  let current = assertPublicFetchUrl(String(url));
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(current, {
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(ms)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return {response, finalUrl: current};
      current = assertPublicFetchUrl(new URL(location, current).toString());
      continue;
    }
    return {response, finalUrl: current};
  }
  throw new Error('Too many Douyin redirects');
}
async function expandLink(source, diagnostics) {
  const direct = extractId(source.toString());
  if (direct) return direct;
  try {
    const {response, finalUrl} = await requestPublic(source, {
      'user-agent': MOBILE_UA, accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9'
    });
    const id = extractId(finalUrl.toString());
    if (id) return id;
    if (!response.ok) {
      diagnostics.push('share-link:http-' + response.status);
      return null;
    }
    const html = await response.text();
    const inHtml = html.match(/(?:aweme_id|awemeId|item_id|modal_id)["'\s:=]+["']?(\d{8,})/)?.[1] ??
      html.match(/\/(?:video|note)\/(\d{8,})/)?.[1];
    if (inHtml) return inHtml;
    diagnostics.push('share-link:no-public-post-id');
  } catch (error) {
    diagnoseFetchError('share-link', error, diagnostics);
  }
  return null;
}
async function publicApi(label, url, id, diagnostics, userAgent = MOBILE_UA) {
  try {
    const {response} = await requestPublic(url, {
      'user-agent': userAgent,
      'referer': label === 'desktop-detail' ? 'https://www.douyin.com/' : 'https://www.iesdouyin.com/',
      accept: 'application/json,text/plain,*/*',
      'accept-language': 'zh-CN,zh;q=0.9'
    });
    if (!response.ok) { diagnostics.push(label + ':http-' + response.status); return null; }
    const text = await response.text();
    if (!text.trim()) { diagnostics.push(label + ':empty-body'); return null; }
    if (text.length > 3_000_000) { diagnostics.push(label + ':oversized-body'); return null; }
    const parsed = parseJson(text);
    if (!parsed) { diagnostics.push(label + ':invalid-json'); return null; }
    const item = findItem(parsed, id);
    if (!item) diagnostics.push(label + ':no-matching-public-media');
    return item;
  } catch (error) {
    diagnoseFetchError(label, error, diagnostics);
    return null;
  }
}
async function publicHtml(label, url, id, diagnostics, ua) {
  try {
    const {response} = await requestPublic(url, {
      'user-agent': ua,
      referer: 'https://www.douyin.com/',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
      'accept-language': 'zh-CN,zh;q=0.9'
    });
    if (!response.ok) { diagnostics.push(label + ':http-' + response.status); return null; }
    const html = await response.text();
    if (!html.trim()) { diagnostics.push(label + ':empty-body'); return null; }
    if (html.length > 5_000_000) { diagnostics.push(label + ':oversized-body'); return null; }
    const item = parseHtml(html, id);
    if (item) return item;
    diagnostics.push(label + ':' +
      (/__ac_nonce|__ac_signature|captcha|verify.*human/i.test(html) ? 'challenge-page' : 'no-matching-public-media'));
    return null;
  } catch (error) {
    diagnoseFetchError(label, error, diagnostics);
    return null;
  }
}
function format(item, url, id) {
  const video = videoUrl(item);
  const pictures = images(item);
  const cover = firstUrl(item?.video?.cover) || firstUrl(item?.video?.origin_cover);
  return {
    platform: 'douyin', id, type: video ? 'video' : 'images',
    title: String(item?.desc ?? item?.description ?? 'Douyin video').slice(0, 500),
    author: String(item?.author?.nickname ?? item?.author?.name ?? 'Douyin creator').slice(0, 150),
    cover, videoUrl: video, images: pictures, sourceUrl: url.toString(),
    notice: 'Download only media you own or have permission to save.'
  };
}
export async function resolvePublicDouyin(value) {
  const url = assertPublicDouyinUrl(value);
  const diagnostics = [];
  const id = await expandLink(url, diagnostics);
  if (!id) throw new DouyinUnavailable('Could not identify a public Douyin post.', diagnostics);

  const requests = [
    ['ies-iteminfo', 'https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=' + id, MOBILE_UA],
    ['ies-detail', 'https://www.iesdouyin.com/aweme/v1/web/aweme/detail/?aweme_id=' + id + '&aid=1128&device_platform=android', MOBILE_UA],
    ['desktop-detail', 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=' + id + '&aid=6383&device_platform=webapp', DESKTOP_UA]
  ];
  for (const [label, target, agent] of requests) {
    const item = await publicApi(label, target, id, diagnostics, agent);
    if (item) return format(item, url, id);
  }
  const pages = [
    ['original-page', url.toString(), MOBILE_UA],
    ['douyin-page', 'https://www.douyin.com/video/' + id, DESKTOP_UA],
    ['ies-share-page', 'https://www.iesdouyin.com/share/video/' + id + '/?from_ssr=1', MOBILE_UA],
    ['ies-note-page', 'https://www.iesdouyin.com/share/note/' + id + '/?from_ssr=1', MOBILE_UA],
    ['douyin-jingxuan', 'https://www.douyin.com/jingxuan?modal_id=' + id, DESKTOP_UA],
    ['ixigua-share', 'https://m.ixigua.com/douyin/share/video/' + id +
      '?aweme_type=107&schema_type=1&utm_source=copy&utm_campaign=client_share&utm_medium=android&app=aweme', DESKTOP_UA]
  ];
  const tried = new Set();
  for (const [label, target, ua] of pages) {
    if (tried.has(target)) continue;
    tried.add(target);
    const item = await publicHtml(label, target, id, diagnostics, ua);
    if (item) return format(item, url, id);
  }
  throw new DouyinUnavailable('Douyin did not expose downloadable public media to the Vercel server.', diagnostics);
}

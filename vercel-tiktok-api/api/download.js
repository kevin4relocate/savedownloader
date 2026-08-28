import { Readable } from 'node:stream';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

function isTikTokHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'tiktok.com' || host.endsWith('.tiktok.com');
}

function isTikTokMediaHost(hostname) {
  const host = hostname.toLowerCase();
  return ['tiktok.com','tiktokcdn.com','tiktokcdn-us.com','tiktokv.com','byteoversea.com','ibytedtos.com','muscdn.com','byteicdn.com']
    .some((root) => host === root || host.endsWith(`.${root}`));
}

function assertTikTokUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !isTikTokHost(url.hostname)) throw new Error('Please provide a public TikTok URL.');
  return url;
}

function itemId(item) {
  return String(item?.id ?? item?.itemId ?? item?.awemeId ?? '');
}

function extractItemId(value) {
  return value.match(/\/(?:video|photo)\/(\d{8,})/i)?.[1] ?? null;
}

function parseJsonScript(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<script[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i'));
  if (!match?.[1]) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function hasMedia(item) {
  const video = item?.video;
  return Boolean(video?.downloadAddr || video?.playAddr || video?.bitrateInfo?.some?.((entry) => entry?.PlayAddr?.UrlList?.length));
}

function findItem(root, expectedId) {
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < 8000) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    visited += 1;
    if (!Array.isArray(node) && hasMedia(node)) {
      const id = itemId(node);
      if (!expectedId || !id || id === expectedId) return node;
    }
    const values = Array.isArray(node) ? node.slice(0, 300) : Object.values(node);
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const child = values[i];
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
}

function normalizeMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || !isTikTokMediaHost(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

function urlList(value) {
  const list = value?.urlList ?? value?.UrlList ?? value?.url_list;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(normalizeMediaUrl).filter(Boolean))];
}

function videoCandidates(video) {
  const urls = [];
  const add = (url) => { if (url && !urls.includes(url)) urls.push(url); };
  add(normalizeMediaUrl(video?.downloadAddr));
  urlList(video?.downloadAddr).forEach(add);
  add(normalizeMediaUrl(video?.playAddr));
  urlList(video?.playAddr).forEach(add);
  if (Array.isArray(video?.bitrateInfo)) {
    const sorted = [...video.bitrateInfo].sort((a,b) => Number(b?.Bitrate ?? 0) - Number(a?.Bitrate ?? 0));
    for (const entry of sorted) {
      add(normalizeMediaUrl(entry?.PlayAddr));
      urlList(entry?.PlayAddr).forEach(add);
    }
  }
  return urls;
}

async function resolvePost(input) {
  const source = assertTikTokUrl(input);
  const response = await fetch(source, {
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'referer': 'https://www.tiktok.com/'
    }
  });
  if (!response.ok) throw new Error(`TikTok returned HTTP ${response.status}.`);
  const finalUrl = assertTikTokUrl(response.url);
  const html = await response.text();
  const expectedId = extractItemId(finalUrl.toString()) || extractItemId(source.toString());
  const universal = parseJsonScript(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
  const direct = universal?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
  const item = direct && hasMedia(direct) ? direct : findItem(universal, expectedId);
  if (!item) throw new Error('This public TikTok post could not be parsed.');
  const candidates = videoCandidates(item.video ?? {});
  if (!candidates.length) throw new Error('No downloadable public TikTok video was found.');
  return { id: itemId(item) || expectedId || 'video', sourceUrl: finalUrl.toString(), candidates };
}

async function fetchCandidate(url, sourceUrl, range) {
  let current = new URL(url);
  for (let i = 0; i < 6; i += 1) {
    if (current.protocol !== 'https:' || !isTikTokMediaHost(current.hostname)) return null;
    const headers = {
      'user-agent': UA,
      'accept': 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5',
      'accept-language': 'en-US,en;q=0.9',
      'referer': sourceUrl
    };
    if (range) headers.range = range;
    const response = await fetch(current, { method: 'GET', redirect: 'manual', headers });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      const next = new URL(location, current);
      if (next.protocol === 'http:') next.protocol = 'https:';
      if (!isTikTokMediaHost(next.hostname)) return null;
      current = next;
      continue;
    }
    if (response.status !== 200 && response.status !== 206) return null;
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html') || type.includes('application/json')) return null;
    return response;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const raw = typeof req.query?.url === 'string' ? req.query.url.trim() : '';
  if (!raw || raw.length > 2048) return res.status(400).json({ ok: false, error: 'Please provide a public TikTok URL.' });

  try {
    const resolved = await resolvePost(raw);
    const range = typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/i.test(req.headers.range) ? req.headers.range : null;
    for (const candidate of resolved.candidates) {
      const media = await fetchCandidate(candidate, resolved.sourceUrl, range);
      if (!media) continue;
      for (const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']) {
        const value = media.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      res.setHeader('content-disposition', `attachment; filename="tiktok-${resolved.id}.mp4"`);
      res.statusCode = media.status;
      if (!media.body) return res.end();
      Readable.fromWeb(media.body).pipe(res);
      return;
    }
    return res.status(502).json({ ok: false, error: "TikTok's media server refused this public video." });
  } catch (error) {
    return res.status(422).json({ ok: false, error: error instanceof Error ? error.message : 'Unable to download this TikTok video.' });
  }
}

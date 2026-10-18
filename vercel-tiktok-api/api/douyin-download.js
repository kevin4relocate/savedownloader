import { Readable } from 'node:stream';
import { resolvePublicDouyin, DouyinUnavailable, normalizeDouyinMediaUrl } from '../lib/douyin.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const ORIGINS = new Set([
  'https://savedownloader.com',
  'https://www.savedownloader.com',
  'https://savedownloader.kevin4relocate.workers.dev'
]);
function headers(req, res) {
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
  if (ORIGINS.has(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
    res.setHeader('access-control-allow-headers', 'range');
    res.setHeader('access-control-expose-headers', 'content-length,content-type,content-disposition,content-range,accept-ranges');
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  res.setHeader('x-savedownloader-region', process.env.VERCEL_REGION || 'unknown');
  res.setHeader('x-savedownloader-delivery', 'vercel');
}
async function fetchPublicMedia(mediaUrl, range) {
  const first = normalizeDouyinMediaUrl(mediaUrl);
  if (!first) return null;
  let current = new URL(first);
  for (let hop = 0; hop < 5; hop++) {
    const h = {
      'user-agent': UA,
      accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5',
      referer: 'https://www.douyin.com/',
      'accept-language': 'zh-CN,zh;q=0.9'
    };
    if (range) h.range = range;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await fetch(current, { redirect: 'manual', headers: h, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      const next = normalizeDouyinMediaUrl(new URL(location, current).toString());
      if (!next) return null;
      current = new URL(next);
      continue;
    }
    if (response.status !== 200 && response.status !== 206) return null;
    if (!/^(video\/|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      return null;
    }
    return response;
  }
  return null;
}
export default async function handler(req, res) {
  headers(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  const input = typeof req.query?.url === 'string' ? req.query.url.trim() : '';
  if (!input || input.length > 2048) {
    return res.status(400).json({ok:false,error:'Please provide a public Douyin post URL.'});
  }
  try {
    const resolved = await resolvePublicDouyin(input);
    if (!resolved.videoUrl || resolved.type !== 'video') {
      return res.status(422).json({ok:false,error:'This public Douyin post has no downloadable video.'});
    }
    const range = typeof req.headers?.range === 'string' && /^bytes=\d*-\d*$/i.test(req.headers.range) ?
      req.headers.range : null;
    const response = await fetchPublicMedia(resolved.videoUrl, range);
    if (!response) return res.status(502).json({
      ok:false,error:'Douyin refused the video file request from Vercel. Please try the original public post URL.'
    });
    for (const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const safeId = String(resolved.id || 'video').replace(/[^0-9A-Za-z_-]/g,'') || 'video';
    res.setHeader('content-disposition', 'attachment; filename="douyin-' + safeId + '.mp4"');
    res.statusCode = response.status;
    if (!response.body) return res.end();
    const stream = Readable.fromWeb(response.body);
    stream.on('error', error => {
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) res.destroy(error);
      else {
        for (const name of ['content-disposition','content-length','content-range','content-type','accept-ranges']) {
          res.removeHeader(name);
        }
        res.status(502).json({ok:false,error:'The public Douyin video stream stopped unexpectedly.'});
      }
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  } catch (error) {
    if (error instanceof DouyinUnavailable) {
      return res.status(422).json({ok:false,error:error.message,diagnostics:error.diagnostics});
    }
    const timeout = ['TimeoutError','AbortError'].includes(error?.name);
    return res.status(timeout ? 504 : 422).json({
      ok:false,error:timeout?'Douyin took too long to respond from Vercel.':
        error instanceof Error ? error.message : 'Unable to download this public Douyin post.'
    });
  }
}

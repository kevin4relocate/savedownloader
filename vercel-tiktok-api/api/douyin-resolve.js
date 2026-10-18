import { resolvePublicDouyin, DouyinUnavailable } from '../lib/douyin.js';

const ACCEPTED_ORIGINS = new Set([
  'https://savedownloader.com',
  'https://www.savedownloader.com',
  'https://savedownloader.kevin4relocate.workers.dev'
]);

export function setDouyinCors(req, res) {
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
  if (ACCEPTED_ORIGINS.has(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  res.setHeader('x-savedownloader-region', process.env.VERCEL_REGION || 'unknown');
  res.setHeader('x-savedownloader-resolver', 'vercel-douyin');
}

export default async function handler(req, res) {
  setDouyinCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  const body = typeof req.body === 'string' ? (() => {
    try { return JSON.parse(req.body); } catch { return null; }
  })() : req.body;
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url || url.length > 2048) {
    return res.status(400).json({ok:false,error:'Please enter a valid public Douyin link.'});
  }

  try {
    const data = await resolvePublicDouyin(url);
    return res.status(200).json({ok:true,data});
  } catch (error) {
    if (error instanceof DouyinUnavailable) {
      return res.status(422).json({ok:false,error:error.message,diagnostics:error.diagnostics});
    }
    const timeout = ['TimeoutError','AbortError'].includes(error?.name);
    const message = timeout ? 'Douyin took too long to respond from Vercel.' :
      (error instanceof Error ? error.message : 'Unable to resolve this public Douyin link.');
    return res.status(timeout ? 504 : 422).json({ok:false,error:message});
  }
}

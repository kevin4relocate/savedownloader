export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  res.status(200).json({
    ok: true,
    service: 'savedownloader-instagram-api',
    version: '0.1.0',
    region: process.env.VERCEL_REGION || null
  });
}

import { assertPublicDouyinUrl, DouyinParseError, resolveDouyin } from "./providers/douyin";
import type { DouyinBrowser } from "./providers/douyin";
import { DtkPreviewError, resolveDouyinDtk } from "./providers/dtk";
import { assertPublicTikTokUrl, isTikTokHost, resolveTikTok } from "./providers/tiktok";
import { assertPublicInstagramUrl, isInstagramHost, resolveInstagram } from "./providers/instagram";

type AnyRecord = Record<string, any>;
type Env = {
  BROWSER?: DouyinBrowser;
  DOUYIN_BROWSER_TEST_TOKEN?: string;
  DTK_API_URL?: string;
  DTK_API_KEY?: string;
  DTK_ACCESS_CLIENT_ID?: string;
  DTK_ACCESS_CLIENT_SECRET?: string;
  DTK_TEST_TOKEN?: string;
  DOUYIN_BROWSER_FALLBACK?: string;
  DOUYIN_BROWSER_RATE_LIMIT?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  CF_VERSION_METADATA?: {
    id?: string;
    tag?: string;
    timestamp?: string;
  };
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "x-robots-tag": "noindex, nofollow, noarchive"
};

const DOUYIN_MEDIA_ROOTS = [
  "douyinvod.com",
  "idouyinvod.com",
  "douyincdn.com",
  "zjcdn.com",
  "bytecdn.cn",
  "bytecdn.com",
  "bytetos.com",
  "ixigua.com",
  "ixiguavideo.com",
  "pstatp.com",
  "snssdk.com",
  "toutiao.com"
];

const INSTAGRAM_MEDIA_ROOTS = ["cdninstagram.com", "fbcdn.net"];
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const DOUYIN_MEDIA_UA = DESKTOP_UA;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function extractFirstUrl(input: string): string | null {
  return input.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function hostMatches(hostname: string, root: string): boolean {
  const host = hostname.toLowerCase();
  return host === root || host.endsWith(`.${root}`);
}

function isDouyinMediaHost(hostname: string): boolean {
  return DOUYIN_MEDIA_ROOTS.some((root) => hostMatches(hostname, root));
}

function isInstagramMediaHost(hostname: string): boolean {
  return INSTAGRAM_MEDIA_ROOTS.some((root) => hostMatches(hostname, root));
}

function normalizeDouyinMediaUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !isDouyinMediaHost(url.hostname)) {
    throw new Error("Douyin returned an unsupported media host.");
  }
  return url;
}

function normalizeInstagramMediaUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !isInstagramMediaHost(url.hostname)) {
    throw new Error("Instagram returned an unsupported media host.");
  }
  return url;
}

async function fetchDouyinMedia(value: string, range: string | null): Promise<Response | null> {
  let current = normalizeDouyinMediaUrl(value);

  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const headers: Record<string, string> = {
      "user-agent": DOUYIN_MEDIA_UA,
      accept: "video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      referer: "https://www.douyin.com/"
    };
    if (range) headers.range = range;

    // Timeout only the upstream response headers: never abort an active video stream.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let response: Response;
    try {
      response = await fetch(current, {
        signal: controller.signal,
        method: "GET",
        redirect: "manual",
        headers
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = normalizeDouyinMediaUrl(new URL(location, current).toString());
      continue;
    }

    if (response.status !== 200 && response.status !== 206) return null;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!/^(video\/|application\/octet-stream)/.test(contentType)) { await response.body?.cancel(); return null; }
    return response;
  }

  return null;
}

async function fetchInstagramMedia(value: string, sourceUrl: string, range: string | null): Promise<Response | null> {
  let current = normalizeInstagramMediaUrl(value);

  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const headers: Record<string, string> = {
      "user-agent": DESKTOP_UA,
      accept: "video/mp4,video/*;q=0.9,image/avif,image/webp,image/apng,image/*,*/*;q=0.6",
      "accept-language": "en-US,en;q=0.9",
      referer: sourceUrl
    };
    if (range) headers.range = range;

    // Timeout only the upstream response headers: never abort an active video stream.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let response: Response;
    try {
      response = await fetch(current, {
        signal: controller.signal,
        method: "GET",
        redirect: "manual",
        headers
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = normalizeInstagramMediaUrl(new URL(location, current).toString());
      continue;
    }

    if (response.status !== 200 && response.status !== 206) return null;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!/^(video\/|image\/|application\/octet-stream)/.test(contentType)) { await response.body?.cancel(); return null; }
    return response;
  }

  return null;
}

function instagramExtension(contentType: string | null, mediaType: string): string {
  const type = (contentType || "").toLowerCase();
  if (type.includes("video/mp4")) return "mp4";
  if (type.includes("image/png")) return "png";
  if (type.includes("image/webp")) return "webp";
  if (type.includes("image/avif")) return "avif";
  if (type.includes("image/gif")) return "gif";
  return mediaType === "video" ? "mp4" : "jpg";
}

// A short-lived edge cache lets the Download button reuse the video found
// by the preceding Get video request, without launching Browser Run twice.
// Only matching public Douyin video metadata is cached; no HTML or tokens.
type DouyinCachedVideo = {
  platform: "douyin";
  sourceUrl: string;
  id: string;
  videoUrl: string;
  [key: string]: any;
};
type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};
function douyinEdgeCache(): EdgeCache | null {
  const storage = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches;
  return storage?.default ?? null;
}
async function douyinCacheRequest(sourceUrl: string): Promise<Request> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceUrl));
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://savedownloader.com/__internal/douyin/" + hex);
}
async function cacheDouyinVideo(sourceUrl: string, result: AnyRecord): Promise<void> {
  const cache = douyinEdgeCache();
  if (!cache || typeof result?.videoUrl !== "string") return;
  try {
    normalizeDouyinMediaUrl(result.videoUrl);
    await cache.put(await douyinCacheRequest(sourceUrl), new Response(JSON.stringify(result), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=120"
      }
    }));
  } catch {
    // Cache failure must never block a successful resolve.
  }
}
async function getCachedDouyinVideo(sourceUrl: string): Promise<DouyinCachedVideo | null> {
  const cache = douyinEdgeCache();
  if (!cache) return null;
  try {
    const response = await cache.match(await douyinCacheRequest(sourceUrl));
    if (!response?.ok) return null;
    const result = await response.json() as AnyRecord;
    if (result?.platform !== "douyin" || result?.sourceUrl !== sourceUrl ||
        typeof result?.videoUrl !== "string" || !/^\d{8,}$/.test(String(result?.id ?? ""))) return null;
    normalizeDouyinMediaUrl(result.videoUrl);
    return result as DouyinCachedVideo;
  } catch {
    return null;
  }
}

async function handleResolve(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return json({ error: "Expected application/json" }, 415);

  let body: AnyRecord;
  try {
    body = await request.json() as AnyRecord;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const rawInput = typeof body?.url === "string" ? body.url.trim() : "";
  if (!rawInput || rawInput.length > 2048) return json({ error: "Please enter a valid public media link." }, 400);
  const extracted = extractFirstUrl(rawInput) ?? rawInput;

  try {
    const url = new URL(extracted);
    const browserTest = new URL(request.url).searchParams.get("browser") === "1";
    if (browserTest &&
        (!env.DOUYIN_BROWSER_TEST_TOKEN ||
          env.DOUYIN_BROWSER_TEST_TOKEN.length < 20 ||
          request.headers.get("x-douyin-browser-token") !== env.DOUYIN_BROWSER_TEST_TOKEN)) {
      return json({ ok: false, error: "Authorized browser test token required." }, 403);
    }
    if (url.hostname === "douyin.com" || url.hostname.endsWith(".douyin.com") || url.hostname === "iesdouyin.com" || url.hostname.endsWith(".iesdouyin.com")) {
      const sourceUrl = assertPublicDouyinUrl(extracted);
      const requestBrowserFallback = new URL(request.url).searchParams.get("tryBrowser") === "1";
      const resolved = await resolveDouyin(sourceUrl, {
        browser: env.BROWSER,
        browserOnly: browserTest,
        browserFallback: !browserTest && (requestBrowserFallback || env.DOUYIN_BROWSER_FALLBACK === "1"),
        browserRateLimit: env.DOUYIN_BROWSER_RATE_LIMIT
      });
      if (!browserTest) await cacheDouyinVideo(sourceUrl.toString(), resolved);
      return json({ ok: true, data: resolved });
    }
    if (isTikTokHost(url.hostname)) {
      return json({ ok: true, data: await resolveTikTok(assertPublicTikTokUrl(extracted)) });
    }
    if (isInstagramHost(url.hostname)) {
      return json({ ok: true, data: await resolveInstagram(assertPublicInstagramUrl(extracted)) });
    }
    return json({ ok: false, error: "This platform is not supported yet." }, 422);
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = timedOut ? "The source platform took too long. Please retry the original post link." : error instanceof Error ? error.message : "Unable to resolve this link.";
    // Never log upstream response bodies, shared URLs or user data.
    if (error instanceof DouyinParseError) console.warn("Douyin upstream diagnostics:", error.diagnostics.join(","));
    const diagnose = new URL(request.url).searchParams.get("diagnose") === "1";
    const diagnostics = diagnose && error instanceof DouyinParseError ? { diagnostics: error.diagnostics } : {};
    return json({ ok: false, error: message, ...diagnostics }, timedOut ? 504 : 422);
  }
}

async function handleDouyinDownload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const requestUrl = new URL(request.url);
  const rawInput = requestUrl.searchParams.get("url")?.trim() ?? "";
  if (!rawInput || rawInput.length > 2048) return json({ ok: false, error: "Please provide a public Douyin URL." }, 400);

  try {
    const extracted = extractFirstUrl(rawInput) ?? rawInput;
    const sourceUrl = assertPublicDouyinUrl(extracted);
    const cached = await getCachedDouyinVideo(sourceUrl.toString());
    const resolved = cached ?? await resolveDouyin(sourceUrl, {
      browser: env.BROWSER,
      browserFallback: requestUrl.searchParams.get("tryBrowser") === "1" || env.DOUYIN_BROWSER_FALLBACK === "1",
      browserRateLimit: env.DOUYIN_BROWSER_RATE_LIMIT
    }) as AnyRecord;
    const videoUrl = typeof resolved?.videoUrl === "string" ? resolved.videoUrl : "";
    if (!videoUrl) return json({ ok: false, error: "No downloadable public Douyin video was found." }, 422);

    const rangeHeader = request.headers.get("range");
    const range = rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader) ? rangeHeader : null;
    const media = await fetchDouyinMedia(videoUrl, range);
    if (!media) {
      return json({ ok: false, error: "Douyin's media server refused this public video. Please resolve the original post again." }, 502);
    }

    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = media.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    const id = String(resolved?.id ?? "video").replace(/[^0-9A-Za-z_-]/g, "") || "video";
    headers.set("content-disposition", `attachment; filename="douyin-${id}.mp4"`);

    return new Response(media.body, { status: media.status, headers });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = timedOut ? "The media server took too long. Please retry using the original post link." : error instanceof Error ? error.message : "Unable to download this Douyin video.";
    return json({ ok: false, error: message }, timedOut ? 504 : 422);
  }
}

async function handleInstagramDownload(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const requestUrl = new URL(request.url);
  const rawInput = requestUrl.searchParams.get("url")?.trim() ?? "";
  const itemRaw = requestUrl.searchParams.get("item") ?? "0";
  const itemIndex = Number(itemRaw);

  if (!rawInput || rawInput.length > 2048) {
    return json({ ok: false, error: "Please provide a public Instagram post or Reel URL." }, 400);
  }
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex > 49) {
    return json({ ok: false, error: "Invalid Instagram media item." }, 400);
  }

  try {
    const extracted = extractFirstUrl(rawInput) ?? rawInput;
    const sourceUrl = assertPublicInstagramUrl(extracted);
    const resolved = await resolveInstagram(sourceUrl) as AnyRecord;
    const items = Array.isArray(resolved?.media) ? resolved.media : [];
    const selected = items[itemIndex] as AnyRecord | undefined;
    if (!selected || !["image", "video"].includes(String(selected.type)) || typeof selected.url !== "string") {
      return json({ ok: false, error: "That media item is not available in this public Instagram post." }, 404);
    }

    const resolvedSource = assertPublicInstagramUrl(String(resolved?.sourceUrl ?? sourceUrl.toString())).toString();
    const rangeHeader = request.headers.get("range");
    const range = rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader) ? rangeHeader : null;
    const media = await fetchInstagramMedia(selected.url, resolvedSource, range);
    if (!media) {
      return json({
        ok: false,
        error: "Instagram's media server refused this public media item from Cloudflare. Resolve the original post again and retry."
      }, 502);
    }

    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = media.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    headers.set("x-savedownloader-delivery", "cloudflare");

    const id = String(resolved?.id ?? "post").replace(/[^0-9A-Za-z_-]/g, "") || "post";
    const ext = instagramExtension(media.headers.get("content-type"), String(selected.type));
    headers.set("content-disposition", `attachment; filename="instagram-${id}-${String(itemIndex + 1).padStart(2, "0")}.${ext}"`);

    return new Response(media.body, { status: media.status, headers });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = timedOut ? "The media server took too long. Please retry using the original post link." : error instanceof Error ? error.message : "Unable to download this Instagram media.";
    return json({ ok: false, error: message }, timedOut ? 504 : 422);
  }
}

// Branch-preview integration. Kept behind a separate API path and an explicit
// operator-only test token so public users cannot spend self-hosted DTK quota.
async function authorizeDtkPreview(request: Request, env: Env): Promise<Response | null> {
  const provided = request.headers.get("x-dtk-test-token") || "";
  if (!env.DTK_TEST_TOKEN || env.DTK_TEST_TOKEN.length < 24 || provided !== env.DTK_TEST_TOKEN) {
    return json({ok: false, error: "A valid DTK preview test token is required."}, 403);
  }
  if (!env.DOUYIN_BROWSER_RATE_LIMIT) {
    return json({ok: false, error: "DTK preview rate limiter is not configured."}, 503);
  }
  try {
    const {success} = await env.DOUYIN_BROWSER_RATE_LIMIT.limit({key:"dtk-preview-public"});
    if (!success) return json({ok:false,error:"DTK preview rate limit reached. Try in a minute."},429);
  } catch {
    return json({ok:false,error:"DTK preview rate limiter unavailable."},503);
  }
  return null;
}
function dtkLocalDev(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}
function dtkFailure(error: unknown): Response {
  if (error instanceof DtkPreviewError) {
    return json({ok:false,error:error.message,reason:error.reason},error.status);
  }
  return json({ok:false,error:"DTK preview failed. Inspect the local Docker logs."},502);
}

async function handleDtkPreviewStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ok:false,error:"Method not allowed"},405);
  // Do not expose upstream hostnames, secret values or API key scope information.
  return json({
    ok:true,
    mode:"dtk-preview",
    backendConfigured:Boolean(env.DTK_API_URL && env.DTK_API_KEY && env.DTK_TEST_TOKEN),
    rateLimitConfigured:Boolean(env.DOUYIN_BROWSER_RATE_LIMIT)
  });
}

async function handleDtkPreviewResolve(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ok:false,error:"Method not allowed"},405);
  const guard = await authorizeDtkPreview(request, env);
  if (guard) return guard;
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return json({ok:false,error:"Expected application/json"},415);
  }
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return json({ok:false,error:"Invalid JSON"},400); }
  const text = typeof input?.url === "string" ? input.url.trim() : "";
  if (!text || text.length > 2048) return json({ok:false,error:"Enter a public Douyin link."},400);
  try {
    const url = new URL(extractFirstUrl(text) ?? text);
    const data = await resolveDouyinDtk(url, {
      baseUrl:env.DTK_API_URL, apiKey:env.DTK_API_KEY,
      accessClientId:env.DTK_ACCESS_CLIENT_ID,
      accessClientSecret:env.DTK_ACCESS_CLIENT_SECRET,
      localDev:dtkLocalDev(request)
    });
    return json({ok:true,data});
  } catch (error) {
    return dtkFailure(error);
  }
}

async function handleDtkPreviewDownload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ok:false,error:"Method not allowed"},405);
  const guard = await authorizeDtkPreview(request, env);
  if (guard) return guard;
  const text = new URL(request.url).searchParams.get("url")?.trim() || "";
  if (!text || text.length > 2048) return json({ok:false,error:"Enter a public Douyin link."},400);
  try {
    const url = new URL(extractFirstUrl(text) ?? text);
    const data = await resolveDouyinDtk(url, {
      baseUrl:env.DTK_API_URL, apiKey:env.DTK_API_KEY,
      accessClientId:env.DTK_ACCESS_CLIENT_ID,
      accessClientSecret:env.DTK_ACCESS_CLIENT_SECRET,
      localDev:dtkLocalDev(request)
    });
    if (!data.videoUrl) return json({ok:false,error:"No public video URL returned by DTK."},422);
    const header = request.headers.get("range");
    const range = header && /^bytes=\d*-\d*$/i.test(header) ? header : null;
    const media = await fetchDouyinMedia(data.videoUrl, range);
    if (!media) {
      return json({ok:false,error:"The media CDN refused this file from Cloudflare. DTK metadata may still be valid."},502);
    }
    const headers = new Headers();
    for (const name of ["content-type","content-length","content-range","accept-ranges","etag","last-modified"]) {
      const value = media.headers.get(name);
      if (value) headers.set(name,value);
    }
    headers.set("cache-control","private, no-store");
    headers.set("x-content-type-options","nosniff");
    headers.set("x-robots-tag","noindex, nofollow, noarchive");
    headers.set("content-disposition", 'attachment; filename="douyin-' + String(data.id).replace(/[^0-9]/g,"") + '.mp4"');
    return new Response(media.body,{status:media.status,headers});
  } catch (error) {
    return dtkFailure(error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "savedownloader",
        version: "0.5.0",
        providers: ["douyin", "tiktok", "instagram"],
        instagramDelivery: "cloudflare",
        douyinBrowserRun: { available: Boolean(env.BROWSER), fallbackEnabled: env.DOUYIN_BROWSER_FALLBACK === "1" },
        deployment: {
          id: env.CF_VERSION_METADATA?.id ?? null,
          tag: env.CF_VERSION_METADATA?.tag ?? null,
          timestamp: env.CF_VERSION_METADATA?.timestamp ?? null
        }
      });
    }
    if (url.pathname === "/api/dtk/status") return handleDtkPreviewStatus(request, env);
    if (url.pathname === "/api/dtk/resolve") return handleDtkPreviewResolve(request, env);
    if (url.pathname === "/api/dtk/download") return handleDtkPreviewDownload(request, env);
    if (url.pathname === "/api/resolve") return handleResolve(request, env);
    if (url.pathname === "/api/download/douyin") return handleDouyinDownload(request, env);
    if (url.pathname === "/api/download/instagram") return handleInstagramDownload(request);
    return json({ error: "Not found" }, 404);
  }
};

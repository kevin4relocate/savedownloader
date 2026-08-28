import { assertPublicDouyinUrl, resolveDouyin } from "./providers/douyin";
import { assertPublicTikTokUrl, isTikTokHost, resolveTikTok } from "./providers/tiktok";

type AnyRecord = Record<string, any>;
type Env = {
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

const DOUYIN_MEDIA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

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

function normalizeDouyinMediaUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !isDouyinMediaHost(url.hostname)) {
    throw new Error("Douyin returned an unsupported media host.");
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

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = normalizeDouyinMediaUrl(new URL(location, current).toString());
      continue;
    }

    if (response.status !== 200 && response.status !== 206) return null;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/json")) return null;
    return response;
  }

  return null;
}

async function handleResolve(request: Request): Promise<Response> {
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
    if (url.hostname === "douyin.com" || url.hostname.endsWith(".douyin.com") || url.hostname === "iesdouyin.com" || url.hostname.endsWith(".iesdouyin.com")) {
      return json({ ok: true, data: await resolveDouyin(assertPublicDouyinUrl(extracted)) });
    }
    if (isTikTokHost(url.hostname)) {
      return json({ ok: true, data: await resolveTikTok(assertPublicTikTokUrl(extracted)) });
    }
    return json({ ok: false, error: "This platform is not supported yet." }, 422);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve this link.";
    return json({ ok: false, error: message }, 422);
  }
}

async function handleDouyinDownload(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const requestUrl = new URL(request.url);
  const rawInput = requestUrl.searchParams.get("url")?.trim() ?? "";
  if (!rawInput || rawInput.length > 2048) return json({ ok: false, error: "Please provide a public Douyin URL." }, 400);

  try {
    const extracted = extractFirstUrl(rawInput) ?? rawInput;
    const sourceUrl = assertPublicDouyinUrl(extracted);
    const resolved = await resolveDouyin(sourceUrl) as AnyRecord;
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
    const message = error instanceof Error ? error.message : "Unable to download this Douyin video.";
    return json({ ok: false, error: message }, 422);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "savedownloader",
        version: "0.4.0",
        providers: ["douyin", "tiktok"],
        deployment: {
          id: env.CF_VERSION_METADATA?.id ?? null,
          tag: env.CF_VERSION_METADATA?.tag ?? null,
          timestamp: env.CF_VERSION_METADATA?.timestamp ?? null
        }
      });
    }
    if (url.pathname === "/api/resolve") return handleResolve(request);
    if (url.pathname === "/api/download/douyin") return handleDouyinDownload(request);
    return json({ error: "Not found" }, 404);
  }
};

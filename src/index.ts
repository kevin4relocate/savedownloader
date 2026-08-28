import { assertPublicDouyinUrl, resolveDouyin } from "./providers/douyin";
import {
  assertPublicTikTokUrl,
  isTikTokHost,
  isTikTokMediaHost,
  resolveTikTok,
  resolveTikTokVideoCandidates
} from "./providers/tiktok";

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

const TIKTOK_MEDIA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function extractFirstUrl(input: string): string | null {
  return input.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "") ?? null;
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

function safeRange(value: string | null): string | null {
  if (!value || value.length > 100) return null;
  return /^bytes=\d*-\d*$/i.test(value) ? value : null;
}

async function fetchTikTokMediaCandidate(mediaUrl: string, sourceUrl: string, range: string | null): Promise<Response | null> {
  let current = new URL(mediaUrl);

  for (let redirects = 0; redirects < 6; redirects += 1) {
    if (current.protocol !== "https:" || !isTikTokMediaHost(current.hostname)) return null;

    const headers = new Headers({
      "user-agent": TIKTOK_MEDIA_UA,
      accept: "video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
      referer: sourceUrl
    });
    if (range) headers.set("range", range);

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      const next = new URL(location, current);
      if (next.protocol === "http:") next.protocol = "https:";
      if (next.protocol !== "https:" || !isTikTokMediaHost(next.hostname)) return null;
      current = next;
      continue;
    }

    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel();
      return null;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      await response.body?.cancel();
      return null;
    }

    return response;
  }

  return null;
}

async function handleTikTokDownload(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const requestUrl = new URL(request.url);
  const rawSource = requestUrl.searchParams.get("url")?.trim() ?? "";
  if (!rawSource || rawSource.length > 2048) return json({ error: "Please provide a valid public TikTok link." }, 400);

  try {
    const source = assertPublicTikTokUrl(rawSource);
    const resolved = await resolveTikTokVideoCandidates(source);
    const range = safeRange(request.headers.get("range"));

    for (const candidate of resolved.candidates) {
      const media = await fetchTikTokMediaCandidate(candidate, resolved.sourceUrl, range);
      if (!media) continue;

      const headers = new Headers();
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
        const value = media.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set("content-disposition", `attachment; filename="tiktok-${resolved.id || "video"}.mp4"`);
      headers.set("cache-control", "private, no-store");
      headers.set("x-content-type-options", "nosniff");
      headers.set("x-robots-tag", "noindex, nofollow, noarchive");
      headers.set("referrer-policy", "no-referrer");

      return new Response(media.body, {
        status: media.status,
        headers
      });
    }

    return json({ ok: false, error: "TikTok's media server refused this public video. Please try resolving the original post again." }, 502);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to download this TikTok video.";
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
        version: "0.3.1",
        providers: ["douyin", "tiktok"],
        deployment: {
          id: env.CF_VERSION_METADATA?.id ?? null,
          tag: env.CF_VERSION_METADATA?.tag ?? null,
          timestamp: env.CF_VERSION_METADATA?.timestamp ?? null
        }
      });
    }
    if (url.pathname === "/api/resolve") return handleResolve(request);
    if (url.pathname === "/api/download/tiktok") return handleTikTokDownload(request);
    return json({ error: "Not found" }, 404);
  }
};

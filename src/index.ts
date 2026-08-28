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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "savedownloader",
        version: "0.3.0",
        providers: ["douyin", "tiktok"],
        deployment: {
          id: env.CF_VERSION_METADATA?.id ?? null,
          tag: env.CF_VERSION_METADATA?.tag ?? null,
          timestamp: env.CF_VERSION_METADATA?.timestamp ?? null
        }
      });
    }
    if (url.pathname === "/api/resolve") return handleResolve(request);
    return json({ error: "Not found" }, 404);
  }
};

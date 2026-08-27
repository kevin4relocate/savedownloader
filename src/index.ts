const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function extractFirstUrl(input: string): string | null {
  return input.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function isAllowedDouyinHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com");
}

function assertPublicDouyinUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !isAllowedDouyinHost(url.hostname)) {
    throw new Error("Please enter a public Douyin link.");
  }
  return url;
}

function extractAwemeId(value: string): string | null {
  const patterns = [
    /\/video\/(\d{8,})/,
    /\/note\/(\d{8,})/,
    /\/share\/video\/(\d{8,})/,
    /\/share\/note\/(\d{8,})/,
    /[?&](?:modal_id|aweme_id)=(\d{8,})/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function resolveAwemeId(inputUrl: URL): Promise<string> {
  const direct = extractAwemeId(inputUrl.toString());
  if (direct) return direct;

  const response = await fetch(inputUrl, {
    method: "GET",
    redirect: "follow",
    headers: { "user-agent": MOBILE_UA, accept: "text/html,application/xhtml+xml" }
  });

  const finalUrl = assertPublicDouyinUrl(response.url);
  const id = extractAwemeId(finalUrl.toString());
  if (!id) throw new Error("Could not find a Douyin post ID in this link.");
  return id;
}

type AnyRecord = Record<string, any>;

function findItem(routerData: AnyRecord): AnyRecord | null {
  const loaderData = routerData?.loaderData;
  if (!loaderData || typeof loaderData !== "object") return null;
  for (const value of Object.values(loaderData) as AnyRecord[]) {
    const item = value?.videoInfoRes?.item_list?.[0];
    if (item) return item;
  }
  return null;
}

function firstUrl(value: any): string | null {
  const list = value?.url_list;
  return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
}

async function fetchDouyinItem(awemeId: string): Promise<AnyRecord> {
  const shareUrl = `https://www.iesdouyin.com/share/video/${awemeId}/?from_ssr=1`;
  const response = await fetch(shareUrl, {
    headers: {
      "user-agent": MOBILE_UA,
      referer: "https://www.douyin.com/",
      accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });

  if (!response.ok) throw new Error(`Douyin returned HTTP ${response.status}.`);
  const html = await response.text();
  const match = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new Error("Douyin did not return public post data. Please try again later.");

  let raw = match[1].trim();
  if (raw.endsWith(";")) raw = raw.slice(0, -1).trim();
  const routerData = JSON.parse(raw);
  const item = findItem(routerData);
  if (!item) throw new Error("This public post could not be parsed.");
  return item;
}

function formatItem(item: AnyRecord, sourceUrl: string) {
  const images = Array.isArray(item?.images)
    ? item.images.map((image: AnyRecord) => firstUrl(image)).filter(Boolean)
    : [];
  const videoUrl = firstUrl(item?.video?.play_addr);
  const cover = firstUrl(item?.video?.cover) || firstUrl(item?.video?.origin_cover);

  if (!videoUrl && images.length === 0) throw new Error("No downloadable public media was found.");

  return {
    platform: "douyin",
    id: String(item?.aweme_id ?? ""),
    type: videoUrl ? "video" : "images",
    title: String(item?.desc ?? "Douyin video"),
    author: String(item?.author?.nickname ?? "Douyin creator"),
    cover,
    videoUrl,
    images,
    sourceUrl,
    notice: "Download only media you own or have permission to save."
  };
}

async function handleResolve(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return json({ error: "Expected application/json" }, 415);

  let body: AnyRecord;
  try { body = await request.json() as AnyRecord; } catch { return json({ error: "Invalid JSON body" }, 400); }
  const rawInput = typeof body?.url === "string" ? body.url.trim() : "";
  if (!rawInput || rawInput.length > 2048) return json({ error: "Please enter a valid Douyin link." }, 400);

  const extracted = extractFirstUrl(rawInput) ?? rawInput;
  try {
    const inputUrl = assertPublicDouyinUrl(extracted);
    const awemeId = await resolveAwemeId(inputUrl);
    const item = await fetchDouyinItem(awemeId);
    return json({ ok: true, data: formatItem(item, inputUrl.toString()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve this link.";
    return json({ ok: false, error: message }, 422);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true, service: "savedownloader", version: "0.1.0" });
    if (url.pathname === "/api/resolve") return handleResolve(request);
    return json({ error: "Not found" }, 404);
  }
};

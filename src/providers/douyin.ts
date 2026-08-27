const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

type AnyRecord = Record<string, any>;

export function isDouyinHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com");
}

export function assertPublicDouyinUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !isDouyinHost(url.hostname)) throw new Error("Please enter a public Douyin link.");
  return url;
}

function extractAwemeId(value: string): string | null {
  for (const pattern of [
    /\/video\/(\d{8,})/,
    /\/note\/(\d{8,})/,
    /\/share\/video\/(\d{8,})/,
    /\/share\/note\/(\d{8,})/,
    /[?&](?:modal_id|aweme_id)=(\d{8,})/
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function resolveAwemeId(inputUrl: URL): Promise<string> {
  const direct = extractAwemeId(inputUrl.toString());
  if (direct) return direct;

  const response = await fetch(inputUrl, {
    redirect: "follow",
    headers: {
      "user-agent": MOBILE_UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9"
    }
  });

  const finalUrl = assertPublicDouyinUrl(response.url);
  const id = extractAwemeId(finalUrl.toString());
  if (!id) throw new Error("Could not find a Douyin post ID in this link.");
  return id;
}

function firstUrl(value: any): string | null {
  const list = value?.url_list ?? value?.urlList;
  return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
}

function hasPublicMedia(item: AnyRecord): boolean {
  return Boolean(
    firstUrl(item?.video?.play_addr) ||
    firstUrl(item?.video?.play_addr_h264) ||
    firstUrl(item?.video?.download_addr) ||
    (Array.isArray(item?.images) && item.images.some((image: AnyRecord) => firstUrl(image)))
  );
}

function itemId(item: AnyRecord): string {
  return String(item?.aweme_id ?? item?.awemeId ?? item?.aweme_id_str ?? "");
}

function findTargetItem(data: AnyRecord, awemeId: string): AnyRecord | null {
  const known = [
    data?.loaderData?.["video_(id)/page"]?.videoInfoRes?.item_list?.[0],
    data?.loaderData?.["note_(id)/page"]?.videoInfoRes?.item_list?.[0],
    data?.loaderData?.["video_(id)/page"]?.aweme_detail,
    data?.loaderData?.["note_(id)/page"]?.aweme_detail,
    data?.videoInfoRes?.item_list?.[0],
    data?.aweme_detail,
    data?.app?.videoInfoRes?.item_list?.[0],
    data?.app?.videoDetail
  ];

  for (const candidate of known) {
    if (candidate && itemId(candidate) === awemeId && hasPublicMedia(candidate)) return candidate;
  }

  // Hydration payloads change often. Search a bounded number of public JSON nodes,
  // but only accept an object matching the exact requested post ID and containing media.
  const stack: any[] = [data];
  let visited = 0;
  const MAX_NODES = 6000;

  while (stack.length && visited < MAX_NODES) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    visited += 1;

    if (!Array.isArray(node) && itemId(node) === awemeId && hasPublicMedia(node)) return node;

    if (Array.isArray(node)) {
      for (let i = Math.min(node.length, 300) - 1; i >= 0; i -= 1) {
        const child = node[i];
        if (child && typeof child === "object") stack.push(child);
      }
    } else {
      const values = Object.values(node);
      for (let i = values.length - 1; i >= 0; i -= 1) {
        const child = values[i];
        if (child && typeof child === "object") stack.push(child);
      }
    }
  }

  return null;
}

function parseJson(raw: string, allowPercentDecode = false): AnyRecord | null {
  let text = raw.trim();
  if (text.endsWith(";")) text = text.slice(0, -1).trim();

  if (allowPercentDecode && /%[0-9A-Fa-f]{2}/.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Fall through and try the original text.
    }
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractHydrationPayloads(html: string): AnyRecord[] {
  const payloads: AnyRecord[] = [];

  const renderData = html.match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i);
  if (renderData?.[1]) {
    const parsed = parseJson(renderData[1], true);
    if (parsed) payloads.push(parsed);
  }

  for (const variable of ["_ROUTER_DATA", "_SSR_DATA", "_SSR_HYDRATED_DATA"]) {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(`window\\.${escaped}\\s*=\\s*([\\s\\S]*?)<\\/script>`, "i"));
    if (!match?.[1]) continue;
    const parsed = parseJson(match[1]);
    if (parsed) payloads.push(parsed);
  }

  return payloads;
}

function parsePublicPageItem(html: string, awemeId: string): AnyRecord | null {
  for (const payload of extractHydrationPayloads(html)) {
    const item = findTargetItem(payload, awemeId);
    if (item) return item;
  }
  return null;
}

async function fetchHtml(url: string, userAgent: string, referer = "https://www.douyin.com/"): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        referer,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9"
      },
      redirect: "follow"
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchItem(awemeId: string, inputUrl: URL): Promise<AnyRecord> {
  const candidates = [
    { url: inputUrl.toString(), userAgent: MOBILE_UA },
    { url: `https://www.douyin.com/video/${awemeId}`, userAgent: MOBILE_UA },
    { url: `https://www.iesdouyin.com/share/video/${awemeId}/?from_ssr=1`, userAgent: MOBILE_UA },
    {
      url: `https://m.ixigua.com/douyin/share/video/${awemeId}?aweme_type=107&schema_type=1&utm_source=copy&utm_campaign=client_share&utm_medium=android&app=aweme`,
      userAgent: DESKTOP_UA
    },
    { url: `https://www.iesdouyin.com/share/note/${awemeId}/?from_ssr=1`, userAgent: MOBILE_UA }
  ];

  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (tried.has(candidate.url)) continue;
    tried.add(candidate.url);

    const html = await fetchHtml(candidate.url, candidate.userAgent);
    if (!html) continue;

    const item = parsePublicPageItem(html, awemeId);
    if (item) return item;
  }

  throw new Error("This public post could not be parsed.");
}

function formatItem(item: AnyRecord, sourceUrl: string, awemeId: string) {
  const images = Array.isArray(item?.images)
    ? item.images.map((image: AnyRecord) => firstUrl(image)).filter(Boolean)
    : [];

  const videoUrl =
    firstUrl(item?.video?.play_addr) ||
    firstUrl(item?.video?.play_addr_h264) ||
    firstUrl(item?.video?.download_addr);

  const cover = firstUrl(item?.video?.cover) || firstUrl(item?.video?.origin_cover);
  if (!videoUrl && images.length === 0) throw new Error("No downloadable public media was found.");

  return {
    platform: "douyin",
    id: itemId(item) || awemeId,
    type: videoUrl ? "video" : "images",
    title: String(item?.desc ?? item?.description ?? "Douyin video"),
    author: String(item?.author?.nickname ?? item?.author?.name ?? "Douyin creator"),
    cover,
    videoUrl,
    images,
    sourceUrl,
    notice: "Download only media you own or have permission to save."
  };
}

export async function resolveDouyin(inputUrl: URL) {
  const awemeId = await resolveAwemeId(inputUrl);
  const item = await fetchItem(awemeId, inputUrl);
  return formatItem(item, inputUrl.toString(), awemeId);
}

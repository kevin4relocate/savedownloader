const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

type AnyRecord = Record<string, any>;

let cachedTtwid = "";
let ttwidExpiresAt = 0;

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
  const defaultScope = data?.__DEFAULT_SCOPE__;
  const known = [
    data?.loaderData?.["video_(id)/page"]?.videoInfoRes?.item_list?.[0],
    data?.loaderData?.["note_(id)/page"]?.videoInfoRes?.item_list?.[0],
    data?.loaderData?.["video_(id)/page"]?.aweme_detail,
    data?.loaderData?.["note_(id)/page"]?.aweme_detail,
    data?.videoInfoRes?.item_list?.[0],
    data?.aweme_detail,
    data?.app?.videoInfoRes?.item_list?.[0],
    data?.app?.videoDetail,
    data?.appContext?.appContext?.awemeDetail,
    data?.awemeDetail,
    defaultScope?.["aweme.detail"],
    defaultScope?.awemeDetail
  ];

  for (const candidate of known) {
    if (candidate && itemId(candidate) === awemeId && hasPublicMedia(candidate)) return candidate;
  }

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

  for (const id of ["RENDER_DATA", "__UNIVERSAL_DATA_FOR_REHYDRATION__"]) {
    const match = html.match(new RegExp(`<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i"));
    if (!match?.[1]) continue;
    const parsed = parseJson(match[1], id === "RENDER_DATA");
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

async function fetchPublicItemInfo(awemeId: string): Promise<AnyRecord | null> {
  try {
    const response = await fetch(`https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(awemeId)}`, {
      headers: {
        "user-agent": MOBILE_UA,
        referer: "https://www.iesdouyin.com/",
        accept: "application/json",
        "accept-language": "zh-CN,zh;q=0.9"
      },
      redirect: "follow"
    });

    if (!response.ok) return null;
    const data = await response.json() as AnyRecord;
    const item = data?.item_list?.[0];
    if (item && itemId(item) === awemeId && hasPublicMedia(item)) return item;
    return null;
  } catch {
    return null;
  }
}

async function getAnonymousTtwid(): Promise<string> {
  if (cachedTtwid && Date.now() < ttwidExpiresAt) return cachedTtwid;

  try {
    const response = await fetch("https://ttwid.bytedance.com/ttwid/union/register/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        region: "cn",
        aid: 1768,
        needFid: "0",
        service: "www.ixigua.com",
        migrate_info: { ticket: "", src: "uc" },
        cbUrlProtocol: "https",
        union: true
      })
    });

    const setCookie = response.headers.get("set-cookie") || "";
    const match = setCookie.match(/(?:^|[;,]\s*)(ttwid=[^;]+)/i) || setCookie.match(/(ttwid=[^;]+)/i);
    if (match?.[1]) {
      cachedTtwid = match[1];
      ttwidExpiresAt = Date.now() + 55 * 60 * 1000;
      return cachedTtwid;
    }
  } catch {
    // The web-detail request can still be attempted without a visitor token.
  }

  return "";
}

async function fetchPublicWebDetail(awemeId: string): Promise<AnyRecord | null> {
  try {
    const ttwid = await getAnonymousTtwid();
    const apiUrl = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
    apiUrl.searchParams.set("aweme_id", awemeId);
    apiUrl.searchParams.set("aid", "6383");
    apiUrl.searchParams.set("device_platform", "webapp");
    apiUrl.searchParams.set("channel", "channel_pc_web");
    apiUrl.searchParams.set("pc_client_type", "1");
    apiUrl.searchParams.set("version_code", "190500");
    apiUrl.searchParams.set("version_name", "19.5.0");

    const headers: Record<string, string> = {
      "user-agent": DESKTOP_UA,
      referer: "https://www.douyin.com/",
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
    };
    if (ttwid) headers.cookie = ttwid;

    const response = await fetch(apiUrl, { headers, redirect: "follow" });
    if (!response.ok) return null;

    const data = await response.json() as AnyRecord;
    const item = data?.aweme_detail;
    if (item && itemId(item) === awemeId && hasPublicMedia(item)) return item;
    return null;
  } catch {
    return null;
  }
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
  const publicApiItem = await fetchPublicItemInfo(awemeId);
  if (publicApiItem) return publicApiItem;

  const webDetailItem = await fetchPublicWebDetail(awemeId);
  if (webDetailItem) return webDetailItem;

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

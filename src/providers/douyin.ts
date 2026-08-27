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
    headers: { "user-agent": MOBILE_UA, accept: "text/html,application/xhtml+xml" }
  });

  const finalUrl = assertPublicDouyinUrl(response.url);
  const id = extractAwemeId(finalUrl.toString());
  if (!id) throw new Error("Could not find a Douyin post ID in this link.");
  return id;
}

function findItem(routerData: AnyRecord): AnyRecord | null {
  const loaderData = routerData?.loaderData;
  if (!loaderData || typeof loaderData !== "object") return null;

  const knownPages = [loaderData["video_(id)/page"], loaderData["note_(id)/page"]];
  for (const page of knownPages) {
    const item = page?.videoInfoRes?.item_list?.[0];
    if (item) return item;
  }

  for (const value of Object.values(loaderData) as AnyRecord[]) {
    const item = value?.videoInfoRes?.item_list?.[0];
    if (item) return item;
  }

  return null;
}

function parseRouterItem(html: string): AnyRecord | null {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;

  let raw = match[1].trim();
  if (raw.endsWith(";")) raw = raw.slice(0, -1).trim();

  try {
    return findItem(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, userAgent: string, referer: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        referer,
        accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchItem(awemeId: string): Promise<AnyRecord> {
  const candidates = [
    {
      url: `https://www.iesdouyin.com/share/video/${awemeId}/?from_ssr=1`,
      userAgent: MOBILE_UA,
      referer: "https://www.douyin.com/"
    },
    {
      url: `https://m.ixigua.com/douyin/share/video/${awemeId}?aweme_type=107&schema_type=1&utm_source=copy&utm_campaign=client_share&utm_medium=android&app=aweme`,
      userAgent: DESKTOP_UA,
      referer: "https://www.douyin.com/"
    },
    {
      url: `https://www.iesdouyin.com/share/note/${awemeId}/?from_ssr=1`,
      userAgent: MOBILE_UA,
      referer: "https://www.douyin.com/"
    }
  ];

  for (const candidate of candidates) {
    const html = await fetchHtml(candidate.url, candidate.userAgent, candidate.referer);
    if (!html) continue;
    const item = parseRouterItem(html);
    if (item) return item;
  }

  throw new Error("This public post could not be parsed.");
}

function firstUrl(value: any): string | null {
  const list = value?.url_list;
  return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
}

function formatItem(item: AnyRecord, sourceUrl: string) {
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

export async function resolveDouyin(inputUrl: URL) {
  const awemeId = await resolveAwemeId(inputUrl);
  const item = await fetchItem(awemeId);
  return formatItem(item, inputUrl.toString());
}

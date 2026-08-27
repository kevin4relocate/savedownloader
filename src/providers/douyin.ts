const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";

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
  for (const pattern of [/\/video\/(\d{8,})/,/\/note\/(\d{8,})/,/\/share\/video\/(\d{8,})/,/\/share\/note\/(\d{8,})/,
    /[?&](?:modal_id|aweme_id)=(\d{8,})/]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function resolveAwemeId(inputUrl: URL): Promise<string> {
  const direct = extractAwemeId(inputUrl.toString());
  if (direct) return direct;
  const response = await fetch(inputUrl, { redirect: "follow", headers: { "user-agent": MOBILE_UA, accept: "text/html,application/xhtml+xml" } });
  const finalUrl = assertPublicDouyinUrl(response.url);
  const id = extractAwemeId(finalUrl.toString());
  if (!id) throw new Error("Could not find a Douyin post ID in this link.");
  return id;
}

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

async function fetchItem(awemeId: string): Promise<AnyRecord> {
  const response = await fetch(`https://www.iesdouyin.com/share/video/${awemeId}/?from_ssr=1`, {
    headers: { "user-agent": MOBILE_UA, referer: "https://www.douyin.com/", accept: "text/html,application/xhtml+xml" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Douyin returned HTTP ${response.status}.`);
  const html = await response.text();
  const match = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new Error("Douyin did not return public post data. Please try again later.");
  let raw = match[1].trim();
  if (raw.endsWith(";")) raw = raw.slice(0, -1).trim();
  const item = findItem(JSON.parse(raw));
  if (!item) throw new Error("This public post could not be parsed.");
  return item;
}

function formatItem(item: AnyRecord, sourceUrl: string) {
  const images = Array.isArray(item?.images) ? item.images.map((image: AnyRecord) => firstUrl(image)).filter(Boolean) : [];
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

export async function resolveDouyin(inputUrl: URL) {
  const awemeId = await resolveAwemeId(inputUrl);
  const item = await fetchItem(awemeId);
  return formatItem(item, inputUrl.toString());
}

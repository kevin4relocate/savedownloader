const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

type AnyRecord = Record<string, any>;

export function isTikTokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

export function assertPublicTikTokUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !isTikTokHost(url.hostname)) {
    throw new Error("Please enter a public TikTok link.");
  }
  return url;
}

function extractItemId(value: string): string | null {
  const patterns = [
    /\/video\/(\d{8,})/i,
    /\/photo\/(\d{8,})/i,
    /[?&](?:item_id|itemId|video_id)=(\d{8,})/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function resolveCanonicalUrl(inputUrl: URL): Promise<URL> {
  let current = inputUrl;

  for (let i = 0; i < 6; i += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("TikTok returned an invalid redirect.");
      const next = new URL(location, current);
      if (next.protocol !== "https:" || !isTikTokHost(next.hostname)) {
        throw new Error("TikTok redirected to an unsupported host.");
      }
      current = next;
      continue;
    }

    return current;
  }

  throw new Error("Too many TikTok redirects.");
}

function parseJsonScript(html: string, id: string): AnyRecord | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<script[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function itemId(item: AnyRecord): string {
  return String(item?.id ?? item?.itemId ?? item?.awemeId ?? "");
}

function hasMedia(item: AnyRecord): boolean {
  const video = item?.video;
  const images = item?.imagePost?.images;
  return Boolean(
    video?.downloadAddr ||
    video?.playAddr ||
    video?.bitrateInfo?.some?.((entry: AnyRecord) => entry?.PlayAddr?.UrlList?.length) ||
    (Array.isArray(images) && images.some((image: AnyRecord) => image?.imageURL?.urlList?.length))
  );
}

function findItemInObject(root: AnyRecord, expectedId: string | null): AnyRecord | null {
  const stack: any[] = [root];
  let visited = 0;
  const MAX_NODES = 8000;

  while (stack.length && visited < MAX_NODES) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    visited += 1;

    if (!Array.isArray(node) && hasMedia(node)) {
      const id = itemId(node);
      if (!expectedId || !id || id === expectedId) return node;
    }

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

function extractItemFromHtml(html: string, expectedId: string | null): AnyRecord | null {
  const universal = parseJsonScript(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (universal) {
    const direct = universal?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    if (direct && hasMedia(direct) && (!expectedId || !itemId(direct) || itemId(direct) === expectedId)) {
      return direct;
    }
    const found = findItemInObject(universal, expectedId);
    if (found) return found;
  }

  const sigi = parseJsonScript(html, "SIGI_STATE");
  if (sigi) {
    if (expectedId && sigi?.ItemModule?.[expectedId] && hasMedia(sigi.ItemModule[expectedId])) {
      return sigi.ItemModule[expectedId];
    }
    const found = findItemInObject(sigi, expectedId);
    if (found) return found;
  }

  return null;
}

async function fetchPublicPage(url: URL): Promise<{ html: string; finalUrl: URL }> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": DESKTOP_UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.tiktok.com/"
    }
  });

  if (!response.ok) throw new Error(`TikTok returned HTTP ${response.status}.`);
  const finalUrl = assertPublicTikTokUrl(response.url);
  return { html: await response.text(), finalUrl };
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("https://")) return value;
  return null;
}

function firstUrlList(value: any): string | null {
  const list = value?.urlList ?? value?.UrlList ?? value?.url_list;
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    const url = firstString(entry);
    if (url) return url;
  }
  return null;
}

function bestVideoUrl(video: AnyRecord): string | null {
  const direct = firstString(video?.downloadAddr) || firstString(video?.playAddr);
  if (direct) return direct;

  if (Array.isArray(video?.bitrateInfo)) {
    const sorted = [...video.bitrateInfo].sort((a, b) => Number(b?.Bitrate ?? 0) - Number(a?.Bitrate ?? 0));
    for (const entry of sorted) {
      const url = firstUrlList(entry?.PlayAddr);
      if (url) return url;
    }
  }

  return null;
}

function extractImages(item: AnyRecord): string[] {
  const images = item?.imagePost?.images;
  if (!Array.isArray(images)) return [];
  const urls: string[] = [];
  for (const image of images) {
    const url = firstUrlList(image?.imageURL);
    if (url) urls.push(url);
  }
  return urls;
}

function formatItem(item: AnyRecord, sourceUrl: string, expectedId: string | null) {
  const videoUrl = bestVideoUrl(item?.video ?? {});
  const images = extractImages(item);
  if (!videoUrl && images.length === 0) throw new Error("No downloadable public TikTok media was found.");

  const cover =
    firstString(item?.video?.cover) ||
    firstString(item?.video?.originCover) ||
    firstString(item?.video?.dynamicCover) ||
    firstUrlList(item?.video?.cover) ||
    firstUrlList(item?.video?.originCover);

  return {
    platform: "tiktok",
    id: itemId(item) || expectedId || "",
    type: videoUrl ? "video" : "images",
    title: String(item?.desc ?? item?.title ?? "TikTok video"),
    author: String(item?.author?.nickname ?? item?.author?.uniqueId ?? "TikTok creator"),
    cover,
    videoUrl,
    images,
    sourceUrl,
    notice: "Download only public media you own or have permission to save."
  };
}

export async function resolveTikTok(inputUrl: URL) {
  const canonical = await resolveCanonicalUrl(inputUrl);
  const directId = extractItemId(canonical.toString());
  const { html, finalUrl } = await fetchPublicPage(canonical);
  const finalId = extractItemId(finalUrl.toString()) || directId;
  const item = extractItemFromHtml(html, finalId);
  if (!item) throw new Error("This public TikTok post could not be parsed.");
  return formatItem(item, finalUrl.toString(), finalId);
}

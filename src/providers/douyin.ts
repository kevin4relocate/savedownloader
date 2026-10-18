const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

type AnyRecord = Record<string, any>;

let cachedTtwid = "";
let ttwidExpiresAt = 0;

// Only fixed upstream labels and coarse response categories are recorded.
// No URLs, cookies, HTML bodies, or user identifiers are exposed.
export class DouyinParseError extends Error {
  constructor(message: string, public diagnostics: string[]) {
    super(message);
    this.name = "DouyinParseError";
  }
}

function diagnosticFailure(diagnostics: string[], source: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "";
  diagnostics.push(source + ":" + (name === "TimeoutError" || name === "AbortError" ? "timeout" : "network-or-response-error"));
}

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
    /[?&](?:modal_id|aweme_id|item_id)=(\d{8,})/
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function resolveAwemeId(inputUrl: URL, diagnostics: string[]): Promise<string> {
  const direct = extractAwemeId(inputUrl.toString());
  if (direct) return direct;

  const response = await fetch(inputUrl, {
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
    headers: {
      "user-agent": MOBILE_UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9"
    }
  });

  const finalUrl = assertPublicDouyinUrl(response.url);
  const id = extractAwemeId(finalUrl.toString());
  if (id) return id;

  // Only trust an ID found on a validated Douyin-hosted public page.
  if (response.ok) {
    const html = await response.text();
    const fromHtml =
      html.match(/(?:aweme_id|awemeId|item_id|modal_id)["'\s:=]+["']?(\d{8,})/)?.[1] ??
      html.match(/\/(?:video|note)\/(\d{8,})/)?.[1];
    if (fromHtml) return fromHtml;
  }
  diagnostics.push("share-link:" + (response.ok ? "no-public-post-id" : "http-" + response.status));
  throw new DouyinParseError("Could not find a Douyin post ID in this link.", diagnostics);
}

function firstUrl(value: any): string | null {
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value : null;
  const urls = value?.url_list ?? value?.urlList ?? value?.urls;
  if (Array.isArray(urls)) {
    for (const url of urls) {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
    }
  }
  return null;
}

function getVideoUrl(item: AnyRecord): string | null {
  const video = item?.video ?? item?.videoInfo;
  if (!video || typeof video !== "object") return null;

  const candidates = [
    video.play_addr, video.playAddr, video.play_addr_h264, video.playAddrH264,
    video.play_addr_lowbr, video.playAddrLowbr, video.download_addr, video.downloadAddr,
    ...(Array.isArray(video.bit_rate) ? video.bit_rate.flatMap((rate: AnyRecord) => [
      rate?.play_addr, rate?.playAddr
    ]) : [])
  ];
  for (const candidate of candidates) {
    const url = firstUrl(candidate);
    if (url) return url;
  }
  return null;
}

function hasPublicMedia(item: AnyRecord): boolean {
  return Boolean(
    getVideoUrl(item) ||
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

async function parsePublicApiResponse(
  response: Response, awemeId: string, source: string, diagnostics: string[]
): Promise<AnyRecord | null> {
  if (!response.ok) {
    diagnostics.push(source + ":http-" + response.status);
    return null;
  }
  const raw = await response.text();
  if (!raw.trim()) {
    diagnostics.push(source + ":empty-body");
    return null;
  }
  const data = parseJson(raw);
  if (!data) {
    diagnostics.push(source + ":invalid-json");
    return null;
  }
  const item = findTargetItem(data, awemeId);
  if (!item) diagnostics.push(source + ":no-matching-public-media");
  return item;
}

function extractHydrationPayloads(html: string): AnyRecord[] {
  const payloads: AnyRecord[] = [];
  // Script attributes can arrive in any order.
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let script: RegExpExecArray | null;

  while ((script = scripts.exec(html)) !== null) {
    const attrs = script[1];
    const body = script[2].trim();
    if (!body) continue;

    const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    if (["RENDER_DATA", "__UNIVERSAL_DATA_FOR_REHYDRATION__", "__NEXT_DATA__"].includes(id) ||
        type === "application/json") {
      const parsed = parseJson(body, id === "RENDER_DATA");
      if (parsed) payloads.push(parsed);
    }

    for (const variable of ["_ROUTER_DATA", "_SSR_DATA", "_SSR_HYDRATED_DATA"]) {
      const marker = new RegExp("window\\." + variable + "\\s*=\\s*", "i");
      const match = marker.exec(body);
      if (!match) continue;
      const parsed = parseJson(body.slice(match.index + match[0].length));
      if (parsed) payloads.push(parsed);
    }
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

async function fetchPublicItemInfo(awemeId: string, diagnostics: string[]): Promise<AnyRecord | null> {
  try {
    const response = await fetch(`https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(awemeId)}`, {
      signal: AbortSignal.timeout(12000),
      headers: {
        "user-agent": MOBILE_UA,
        referer: "https://www.iesdouyin.com/",
        accept: "application/json",
        "accept-language": "zh-CN,zh;q=0.9"
      },
      redirect: "follow"
    });

    return await parsePublicApiResponse(response, awemeId, "ies-iteminfo", diagnostics);
  } catch (error) {
    diagnosticFailure(diagnostics, "ies-iteminfo", error);
    return null;
  }
}

async function getAnonymousTtwid(): Promise<string> {
  if (cachedTtwid && Date.now() < ttwidExpiresAt) return cachedTtwid;

  try {
    const response = await fetch("https://ttwid.bytedance.com/ttwid/union/register/", {
      signal: AbortSignal.timeout(12000),
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

// A separate public share API is still used by some mobile pages and avoids
// relying entirely on the legacy v2 endpoint or the desktop signed API.
async function fetchPublicIesDetail(awemeId: string, diagnostics: string[]): Promise<AnyRecord | null> {
  try {
    const apiUrl = new URL("https://www.iesdouyin.com/aweme/v1/web/aweme/detail/");
    apiUrl.searchParams.set("aweme_id", awemeId);
    apiUrl.searchParams.set("aid", "1128");
    apiUrl.searchParams.set("device_platform", "android");

    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
      headers: {
        "user-agent": MOBILE_UA,
        referer: "https://www.iesdouyin.com/",
        accept: "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9"
      }
    });
    return await parsePublicApiResponse(response, awemeId, "ies-detail", diagnostics);
  } catch (error) {
    diagnosticFailure(diagnostics, "ies-detail", error);
    return null;
  }
}

async function fetchPublicWebDetail(awemeId: string, diagnostics: string[]): Promise<AnyRecord | null> {
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
    apiUrl.searchParams.set("request_source", "600");
    apiUrl.searchParams.set("origin_type", "quick_player");

    const headers: Record<string, string> = {
      "user-agent": DESKTOP_UA,
      referer: "https://www.douyin.com/",
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
    };
    if (ttwid) headers.cookie = ttwid;

    const response = await fetch(apiUrl, { headers, redirect: "follow", signal: AbortSignal.timeout(12000) });
    return await parsePublicApiResponse(response, awemeId, "desktop-detail", diagnostics);
  } catch (error) {
    diagnosticFailure(diagnostics, "desktop-detail", error);
    return null;
  }
}

async function fetchHtml(url: string, userAgent: string, diagnostics: string[], source: string, referer = "https://www.douyin.com/"): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: {
        "user-agent": userAgent,
        referer,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9"
      },
      redirect: "follow"
    });
    if (!response.ok) {
      diagnostics.push(source + ":http-" + response.status);
      return null;
    }
    const html = await response.text();
    if (!html.trim()) {
      diagnostics.push(source + ":empty-body");
      return null;
    }
    if (/__ac_nonce|__ac_signature|captcha/i.test(html)) {
      diagnostics.push(source + ":challenge-page");
      return null;
    }
    return html;
  } catch (error) {
    diagnosticFailure(diagnostics, source, error);
    return null;
  }
}

async function fetchItem(awemeId: string, inputUrl: URL, diagnostics: string[]): Promise<AnyRecord> {
  const publicApiItem = await fetchPublicItemInfo(awemeId, diagnostics);
  if (publicApiItem) return publicApiItem;

  const iesDetailItem = await fetchPublicIesDetail(awemeId, diagnostics);
  if (iesDetailItem) return iesDetailItem;

  const webDetailItem = await fetchPublicWebDetail(awemeId, diagnostics);
  if (webDetailItem) return webDetailItem;

  const candidates = [
    { source: "shared-page", url: inputUrl.toString(), userAgent: MOBILE_UA },
    { source: "desktop-page", url: `https://www.douyin.com/video/${awemeId}`, userAgent: MOBILE_UA },
    { source: "ies-share-video", url: `https://www.iesdouyin.com/share/video/${awemeId}/?from_ssr=1`, userAgent: MOBILE_UA },
    {
      source: "ixigua-share",
      url: `https://m.ixigua.com/douyin/share/video/${awemeId}?aweme_type=107&schema_type=1&utm_source=copy&utm_campaign=client_share&utm_medium=android&app=aweme`,
      userAgent: DESKTOP_UA
    },
    { source: "ies-share-note", url: `https://www.iesdouyin.com/share/note/${awemeId}/?from_ssr=1`, userAgent: MOBILE_UA }
  ];

  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (tried.has(candidate.url)) continue;
    tried.add(candidate.url);

    const html = await fetchHtml(candidate.url, candidate.userAgent, diagnostics, candidate.source);
    if (!html) continue;

    const item = parsePublicPageItem(html, awemeId);
    if (item) return item;
    diagnostics.push(candidate.source + ":no-matching-public-media");
  }

  throw new DouyinParseError("This public post could not be parsed.", diagnostics);
}

// Cloudflare Browser Run's authenticated binding uses an internal RPC;
// no Cloudflare API token or external proxy is needed.
export type DouyinBrowser = {
  quickAction(action: "content", options: {
    url: string;
    gotoOptions: { waitUntil: "networkidle2"; timeout: number };
    rejectResourceTypes: string[];
  }): Promise<Response>;
};

export type DouyinResolveOptions = {
  browser?: DouyinBrowser;
  browserOnly?: boolean;
  browserFallback?: boolean;
  browserRateLimit?: { limit(input: { key: string }): Promise<{ success: boolean }> };
};

async function fetchRenderedPublicItem(
  awemeId: string, browser: DouyinBrowser | undefined, diagnostics: string[],
  rateLimit?: DouyinResolveOptions["browserRateLimit"]
): Promise<AnyRecord | null> {
  if (!browser) {
    diagnostics.push("browser-run:not-configured");
    return null;
  }

  // A shared, edge-local limit prevents unlimited browser launches from a
  // public downloader endpoint. Cloudflare rate limits are approximate.
  if (!rateLimit) {
    diagnostics.push("browser-run:rate-limit-unavailable");
    return null;
  }
  try {
    const { success } = await rateLimit.limit({ key: "douyin-browser-global" });
    if (!success) {
      diagnostics.push("browser-run:rate-limited");
      return null;
    }
  } catch {
    diagnostics.push("browser-run:rate-limit-error");
    return null;
  }

  try {
    // Hard-code the already validated Douyin post ID into the destination.
    // Never pass user-controlled URLs to a headless browser.
    const response = await browser.quickAction("content", {
      url: "https://www.douyin.com/video/" + awemeId,
      gotoOptions: { waitUntil: "networkidle2", timeout: 15000 },
      rejectResourceTypes: ["image", "font", "media"]
    });

    if (!response.ok) {
      diagnostics.push("browser-run:http-" + response.status);
      return null;
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" ||
        (data as AnyRecord).success !== true ||
        typeof (data as AnyRecord).result !== "string") {
      diagnostics.push("browser-run:invalid-response");
      return null;
    }
    const html = (data as AnyRecord).result as string;
    if (!html.trim()) {
      diagnostics.push("browser-run:empty-body");
      return null;
    }
    if (html.length > 2_000_000) {
      diagnostics.push("browser-run:oversized-page");
      return null;
    }
    if (/__ac_nonce|__ac_signature|captcha|verify.*human/i.test(html)) {
      diagnostics.push("browser-run:challenge-page");
      return null;
    }
    const item = parsePublicPageItem(html, awemeId);
    if (!item) diagnostics.push("browser-run:no-matching-public-media");
    return item;
  } catch (error) {
    diagnosticFailure(diagnostics, "browser-run", error);
    return null;
  }
}

function formatItem(item: AnyRecord, sourceUrl: string, awemeId: string) {
  const images = Array.isArray(item?.images)
    ? item.images.map((image: AnyRecord) => firstUrl(image)).filter(Boolean)
    : [];

  const videoUrl = getVideoUrl(item);

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

export async function resolveDouyin(inputUrl: URL, options: DouyinResolveOptions = {}) {
  const diagnostics: string[] = [];
  const awemeId = await resolveAwemeId(inputUrl, diagnostics);

  // Browser-only mode is reserved for an authenticated canary test. It avoids
  // spending time on already known-blocked anonymous APIs.
  if (options.browserOnly) {
    const rendered = await fetchRenderedPublicItem(awemeId, options.browser, diagnostics, options.browserRateLimit);
    if (rendered) return formatItem(rendered, inputUrl.toString(), awemeId);
    throw new DouyinParseError("The public Douyin post could not be read by Browser Run.", diagnostics);
  }

  try {
    const item = await fetchItem(awemeId, inputUrl, diagnostics);
    return formatItem(item, inputUrl.toString(), awemeId);
  } catch (error) {
    if (!(error instanceof DouyinParseError) || !options.browserFallback) throw error;
    const rendered = await fetchRenderedPublicItem(awemeId, options.browser, diagnostics, options.browserRateLimit);
    if (rendered) return formatItem(rendered, inputUrl.toString(), awemeId);
    throw new DouyinParseError("This public post could not be parsed.", diagnostics);
  }
}

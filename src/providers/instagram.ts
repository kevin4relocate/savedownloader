const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const CRAWLER_UA = "Googlebot/2.1 (+http://www.google.com/bot.html)";

type AnyRecord = Record<string, any>;
export type InstagramMediaItem = { type: "image" | "video"; url: string; previewUrl?: string | null };

const MEDIA_ROOTS = ["cdninstagram.com", "fbcdn.net"];

export function isInstagramHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "instagram.com" || host.endsWith(".instagram.com");
}

function hostMatches(hostname: string, root: string): boolean {
  const host = hostname.toLowerCase();
  return host === root || host.endsWith(`.${root}`);
}

function isInstagramMediaHost(hostname: string): boolean {
  return MEDIA_ROOTS.some((root) => hostMatches(hostname, root));
}

export function assertPublicInstagramUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !isInstagramHost(url.hostname)) {
    throw new Error("Please enter a public Instagram post or Reel link.");
  }
  if (!/^\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,30}\/?/i.test(url.pathname)) {
    throw new Error("Use a public Instagram post or Reel URL. Stories, profiles, and login-only pages are not supported.");
  }
  return url;
}

function shortcodeFromUrl(url: URL): string | null {
  return url.pathname.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,30})/i)?.[1] ?? null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function normalizeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(decodeHtml(value));
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:" || !isInstagramMediaHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function largestImage(node: AnyRecord): string | null {
  const resources = Array.isArray(node?.display_resources) ? node.display_resources : [];
  const resource = [...resources].sort((a, b) => Number(b?.config_width ?? b?.width ?? 0) - Number(a?.config_width ?? a?.width ?? 0))[0];
  const fromResource = normalizeMediaUrl(resource?.src ?? resource?.url);
  if (fromResource) return fromResource;

  const candidates = Array.isArray(node?.image_versions2?.candidates) ? node.image_versions2.candidates : [];
  const candidate = [...candidates].sort((a, b) => Number(b?.width ?? 0) - Number(a?.width ?? 0))[0];
  return normalizeMediaUrl(candidate?.url)
    || normalizeMediaUrl(node?.display_url)
    || normalizeMediaUrl(node?.display_uri)
    || normalizeMediaUrl(node?.image_url);
}

function bestVideo(node: AnyRecord): string | null {
  const direct = normalizeMediaUrl(node?.video_url);
  if (direct) return direct;
  const versions = Array.isArray(node?.video_versions) ? node.video_versions : [];
  const version = [...versions].sort((a, b) => Number(b?.width ?? 0) * Number(b?.height ?? 0) - Number(a?.width ?? 0) * Number(a?.height ?? 0))[0];
  return normalizeMediaUrl(version?.url);
}

function nodeShortcode(node: AnyRecord): string {
  return String(node?.shortcode ?? node?.code ?? node?.media?.code ?? "");
}

function unwrapMediaNode(value: AnyRecord | null | undefined): AnyRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidates = [
    value?.if_not_gated_logged_out,
    value?.media,
    value?.xig_polaris_media,
    value
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && nodeHasMedia(candidate)) return candidate;
  }
  return null;
}

function nodeHasMedia(node: AnyRecord): boolean {
  return Boolean(
    bestVideo(node) ||
    largestImage(node) ||
    Array.isArray(node?.carousel_media) ||
    Array.isArray(node?.edge_sidecar_to_children?.edges)
  );
}

function findPostNode(root: AnyRecord, expectedCode: string | null): AnyRecord | null {
  const preferred = [
    root?.xig_polaris_media,
    root?.xdt_shortcode_media,
    root?.shortcode_media,
    root?.data?.xig_polaris_media,
    root?.data?.xdt_shortcode_media,
    root?.data?.shortcode_media,
    root?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0],
    root?.gql_data?.shortcode_media,
    root?.gql_data?.xdt_shortcode_media
  ].filter(Boolean);
  for (const value of preferred) {
    const node = unwrapMediaNode(value as AnyRecord);
    if (node && (!expectedCode || !nodeShortcode(node) || nodeShortcode(node) === expectedCode)) return node;
  }

  const stack: any[] = [root];
  let visited = 0;
  let fallback: AnyRecord | null = null;
  while (stack.length && visited < 16000) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    visited += 1;

    if (!Array.isArray(value)) {
      const node = unwrapMediaNode(value);
      if (node) {
        const code = nodeShortcode(node);
        if (expectedCode && code === expectedCode) return node;
        if (!fallback && (!expectedCode || !code)) fallback = node;
      }
    }

    const values = Array.isArray(value) ? value.slice(0, 400) : Object.values(value);
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const child = values[i];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return fallback;
}

function extractBalancedJson(html: string, start: number): string | null {
  if (start < 0 || html[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

function extractNamedObject(html: string, key: string): AnyRecord | null {
  const markers = [`"${key}":`, `\\"${key}\\":`];
  for (const marker of markers) {
    let offset = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const index = html.indexOf(marker, offset);
      if (index < 0) break;
      const start = html.indexOf("{", index + marker.length);
      if (start < 0) break;
      const raw = extractBalancedJson(html, start);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") return parsed as AnyRecord;
        } catch {}
      }
      offset = index + marker.length;
    }
  }
  return null;
}

function parseJsonPayloads(html: string): AnyRecord[] {
  const payloads: AnyRecord[] = [];
  const scripts = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  let scriptCount = 0;
  for (const match of scripts) {
    if (scriptCount >= 160) break;
    scriptCount += 1;
    const text = match[1]?.trim();
    if (!text || text.length > 4_000_000) continue;
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") payloads.push(parsed as AnyRecord);
      } catch {}
    }
  }

  const shared = html.match(/window\._sharedData\s*=\s*({[\s\S]*?})\s*;<\/script>/i);
  if (shared?.[1]) {
    try { payloads.push(JSON.parse(shared[1])); } catch {}
  }

  const additional = html.matchAll(/__additionalDataLoaded\([^,]+,\s*({[\s\S]*?})\s*\);/gi);
  for (const match of additional) {
    try { payloads.push(JSON.parse(match[1])); } catch {}
  }

  for (const key of ["xig_polaris_media", "gql_data"]) {
    const named = extractNamedObject(html, key);
    if (named) payloads.push({ [key]: named });
  }
  return payloads;
}

function mediaFromNode(node: AnyRecord): InstagramMediaItem[] {
  const children = Array.isArray(node?.carousel_media)
    ? node.carousel_media
    : Array.isArray(node?.edge_sidecar_to_children?.edges)
      ? node.edge_sidecar_to_children.edges.map((edge: AnyRecord) => edge?.node).filter(Boolean)
      : [];

  const source = children.length ? children : [node];
  const media: InstagramMediaItem[] = [];
  for (const child of source.slice(0, 50)) {
    const previewUrl = largestImage(child);
    const video = bestVideo(child);
    if (video) {
      media.push({ type: "video", url: video, previewUrl });
      continue;
    }
    if (previewUrl) media.push({ type: "image", url: previewUrl, previewUrl });
  }
  return media;
}

function dedupeMedia(media: InstagramMediaItem[]): InstagramMediaItem[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function fetchHtml(value: string, userAgent: string): Promise<{ html: string; responseUrl: URL } | null> {
  const response = await fetch(value, {
    redirect: "follow",
    headers: {
      "user-agent": userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9"
    }
  });
  if (!response.ok) return null;
  const responseUrl = new URL(response.url);
  if (responseUrl.protocol !== "https:" || !isInstagramHost(responseUrl.hostname)) return null;
  if (responseUrl.pathname.startsWith("/accounts/login")) return null;
  return { html: await response.text(), responseUrl };
}

async function fetchPublicPage(input: URL): Promise<{ html: string; finalUrl: URL }> {
  let current = input;
  for (let i = 0; i < 6; i += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.instagram.com/"
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Instagram returned an invalid redirect.");
      const next = new URL(location, current);
      if (next.protocol !== "https:" || !isInstagramHost(next.hostname)) throw new Error("Instagram redirected to an unsupported host.");
      if (next.pathname.startsWith("/accounts/login")) throw new Error("Instagram requires login for this post.");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`Instagram returned HTTP ${response.status}.`);
    return { html: await response.text(), finalUrl: assertPublicInstagramUrl(current.toString()) };
  }
  throw new Error("Too many Instagram redirects.");
}

function resolveNodeFromHtml(html: string, code: string | null): AnyRecord | null {
  for (const payload of parseJsonPayloads(html)) {
    const found = findPostNode(payload, code);
    if (found) return found;
  }
  return null;
}

function mediaFromOg(html: string): InstagramMediaItem[] {
  const video = normalizeMediaUrl(metaContent(html, "og:video:secure_url")) || normalizeMediaUrl(metaContent(html, "og:video"));
  const image = normalizeMediaUrl(metaContent(html, "og:image"));
  if (video) return [{ type: "video", url: video, previewUrl: image }];
  if (image) return [{ type: "image", url: image, previewUrl: image }];
  return [];
}

export async function resolveInstagram(inputUrl: URL) {
  const { html: desktopHtml, finalUrl } = await fetchPublicPage(inputUrl);
  const code = shortcodeFromUrl(finalUrl) || shortcodeFromUrl(inputUrl);
  if (!code) throw new Error("Instagram shortcode could not be read from this public URL.");

  const crawlerUrl = `https://www.instagram.com/p/${code}/`;
  const embedUrl = `https://www.instagram.com/p/${code}/embed/captioned/`;
  const [crawlerPage, embedPage] = await Promise.all([
    fetchHtml(crawlerUrl, CRAWLER_UA).catch(() => null),
    fetchHtml(embedUrl, DESKTOP_UA).catch(() => null)
  ]);

  let media: InstagramMediaItem[] = [];
  let postNode: AnyRecord | null = null;
  let sourceHtml = desktopHtml;
  let resolver = "desktop";

  const candidates: Array<{ html: string; name: string }> = [];
  if (crawlerPage?.html) candidates.push({ html: crawlerPage.html, name: "crawler" });
  candidates.push({ html: desktopHtml, name: "desktop" });
  if (embedPage?.html) candidates.push({ html: embedPage.html, name: "embed" });

  for (const candidate of candidates) {
    const found = resolveNodeFromHtml(candidate.html, code);
    if (!found) continue;
    const items = mediaFromNode(found);
    if (!items.length) continue;
    postNode = found;
    media = items;
    sourceHtml = candidate.html;
    resolver = candidate.name;
    break;
  }

  if (!media.length) {
    for (const candidate of candidates) {
      const items = mediaFromOg(candidate.html);
      if (!items.length) continue;
      media = items;
      sourceHtml = candidate.html;
      resolver = `${candidate.name}-og`;
      break;
    }
  }

  media = dedupeMedia(media);
  if (!media.length) {
    throw new Error("Instagram did not expose downloadable media for this public post through its public page or embed view.");
  }

  const description = metaContent(sourceHtml, "og:description")
    || metaContent(desktopHtml, "og:description")
    || metaContent(sourceHtml, "description")
    || "Instagram post";
  const author = String(postNode?.owner?.username ?? postNode?.user?.username ?? postNode?.username ?? "Instagram creator");
  const cover = media.find((item) => item.previewUrl)?.previewUrl
    || media.find((item) => item.type === "image")?.url
    || normalizeMediaUrl(metaContent(sourceHtml, "og:image"))
    || normalizeMediaUrl(metaContent(desktopHtml, "og:image"));
  const imageCount = media.filter((item) => item.type === "image").length;
  const videoCount = media.filter((item) => item.type === "video").length;

  return {
    platform: "instagram",
    id: code,
    type: media.length > 1 ? "carousel" : media[0].type,
    title: description.slice(0, 500),
    author,
    cover,
    media,
    mediaCount: media.length,
    imageCount,
    videoCount,
    resolver,
    sourceUrl: finalUrl.toString(),
    notice: "Download only public media you own or have permission to save."
  };
}

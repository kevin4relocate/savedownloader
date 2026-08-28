const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

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
  return normalizeMediaUrl(candidate?.url) || normalizeMediaUrl(node?.display_url) || normalizeMediaUrl(node?.image_url);
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
    root?.xdt_shortcode_media,
    root?.shortcode_media,
    root?.data?.xdt_shortcode_media,
    root?.data?.shortcode_media,
    root?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0]
  ].filter(Boolean);
  for (const node of preferred) {
    if (nodeHasMedia(node) && (!expectedCode || !nodeShortcode(node) || nodeShortcode(node) === expectedCode)) return node;
  }

  const stack: any[] = [root];
  let visited = 0;
  let fallback: AnyRecord | null = null;
  while (stack.length && visited < 12000) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    visited += 1;
    if (!Array.isArray(node) && nodeHasMedia(node)) {
      const code = nodeShortcode(node);
      if (expectedCode && code === expectedCode) return node;
      if (!fallback && !expectedCode) fallback = node;
    }
    const values = Array.isArray(node) ? node.slice(0, 300) : Object.values(node);
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const child = values[i];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return fallback;
}

function parseJsonPayloads(html: string): AnyRecord[] {
  const payloads: AnyRecord[] = [];
  const scripts = html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === "object") payloads.push(parsed);
    } catch {}
  }

  const shared = html.match(/window\._sharedData\s*=\s*({[\s\S]*?})\s*;<\/script>/i);
  if (shared?.[1]) {
    try { payloads.push(JSON.parse(shared[1])); } catch {}
  }

  const additional = html.matchAll(/__additionalDataLoaded\([^,]+,\s*({[\s\S]*?})\s*\);/gi);
  for (const match of additional) {
    try { payloads.push(JSON.parse(match[1])); } catch {}
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
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`Instagram returned HTTP ${response.status}.`);
    return { html: await response.text(), finalUrl: assertPublicInstagramUrl(current.toString()) };
  }
  throw new Error("Too many Instagram redirects.");
}

export async function resolveInstagram(inputUrl: URL) {
  const { html, finalUrl } = await fetchPublicPage(inputUrl);
  const code = shortcodeFromUrl(finalUrl) || shortcodeFromUrl(inputUrl);

  let media: InstagramMediaItem[] = [];
  let postNode: AnyRecord | null = null;
  for (const payload of parseJsonPayloads(html)) {
    const found = findPostNode(payload, code);
    if (!found) continue;
    const items = mediaFromNode(found);
    if (items.length) {
      postNode = found;
      media = items;
      break;
    }
  }

  if (!media.length) {
    const video = normalizeMediaUrl(metaContent(html, "og:video:secure_url")) || normalizeMediaUrl(metaContent(html, "og:video"));
    const image = normalizeMediaUrl(metaContent(html, "og:image"));
    if (video) media.push({ type: "video", url: video, previewUrl: image });
    else if (image) media.push({ type: "image", url: image, previewUrl: image });
  }

  media = dedupeMedia(media);
  if (!media.length) {
    throw new Error("Instagram did not expose downloadable media for this public post to logged-out visitors.");
  }

  const description = metaContent(html, "og:description") || metaContent(html, "description") || "Instagram post";
  const author = String(postNode?.owner?.username ?? postNode?.user?.username ?? postNode?.username ?? "Instagram creator");
  const cover = media.find((item) => item.previewUrl)?.previewUrl || media.find((item) => item.type === "image")?.url || normalizeMediaUrl(metaContent(html, "og:image"));
  const imageCount = media.filter((item) => item.type === "image").length;
  const videoCount = media.filter((item) => item.type === "video").length;

  return {
    platform: "instagram",
    id: code || "post",
    type: media.length > 1 ? "carousel" : media[0].type,
    title: description.slice(0, 500),
    author,
    cover,
    media,
    mediaCount: media.length,
    imageCount,
    videoCount,
    sourceUrl: finalUrl.toString(),
    notice: "Download only public media you own or have permission to save."
  };
}

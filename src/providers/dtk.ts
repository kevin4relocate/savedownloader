// Optional, test-token-gated adapter for self-hosted Evil0ctal DTK v5.
// No third-party demo instance, account credentials, or upstream request bodies
// are exposed to the browser. This is a preview integration, not a public API.
type RecordValue = Record<string, any>;
export type DtkPreviewConfig = {
  baseUrl?: string;
  apiKey?: string;
  accessClientId?: string;
  accessClientSecret?: string;
  localDev?: boolean;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export class DtkPreviewError extends Error {
  constructor(message: string, public status = 502, public reason = "upstream-error") {
    super(message);
    this.name = "DtkPreviewError";
  }
}

const MEDIA_HOSTS = [
  "douyinvod.com", "idouyinvod.com", "douyincdn.com", "zjcdn.com",
  "bytecdn.cn", "bytecdn.com", "bytetos.com", "ixigua.com",
  "ixiguavideo.com", "pstatp.com", "snssdk.com", "toutiao.com"
];
function allowedMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !MEDIA_HOSTS.some(root => host === root || host.endsWith("." + root))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function validateDtkBaseUrl(value: string | undefined, localDev = false): string {
  if (!value) throw new DtkPreviewError("DTK preview is not configured.", 503, "not-configured");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new DtkPreviewError("DTK endpoint configuration is invalid.", 503, "bad-config"); }
  const isLocal = url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "8000";
  if (!(url.protocol === "https:" || (localDev && isLocal)) ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || (!isLocal && url.port)) {
    throw new DtkPreviewError("DTK endpoint must be an HTTPS origin (localhost allowed in local development).", 503, "bad-config");
  }
  if (!isLocal) {
    const host = url.hostname.toLowerCase();
    // Refuse a private IP/hostname when someone accidentally publishes the
    // preview against a remote deployment with a sensitive internal URL.
    if (host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
        host.startsWith("[") || host === "::1") {
      throw new DtkPreviewError("DTK requires a public HTTPS hostname.", 503, "bad-config");
    }
  }
  return url.origin;
}

function validatedDouyinUrl(input: URL): URL {
  const host = input.hostname.toLowerCase();
  if (input.protocol !== "https:" || input.username || input.password || input.port ||
      !["douyin.com", "iesdouyin.com"].some(root => host === root || host.endsWith("." + root))) {
    throw new DtkPreviewError("Please provide a public Douyin URL.", 400, "invalid-input");
  }
  return input;
}

function normalizeContent(value: unknown, original: URL): RecordValue {
  if (!value || typeof value !== "object") {
    throw new DtkPreviewError("DTK returned no public media information.", 422, "empty-result");
  }
  const content = value as RecordValue;
  const expected = /\/(?:video|note)\/(\d{8,})|[?&](?:modal_id|aweme_id)=(\d{8,})/.exec(original.toString());
  const id = String(content.content_id ?? "");
  if (content.platform !== "douyin" || !/^\d{8,}$/.test(id) ||
      (expected && id !== (expected[1] || expected[2]))) {
    throw new DtkPreviewError("DTK returned an unrelated or invalid public post.", 422, "mismatched-post");
  }
  if (content.is_private === true || content.is_deleted === true) {
    throw new DtkPreviewError("Private or deleted Douyin posts are not supported.", 422, "not-public");
  }
  const kind = content.kind;
  if (kind !== "video" && kind !== "image_album") {
    throw new DtkPreviewError("This Douyin post does not contain supported public media.", 422, "unsupported-media");
  }
  const media = content.media ?? {};
  const primary = media.video?.url;
  const streams = Array.isArray(media.streams) ? media.streams : [];
  const videoUrl = kind === "video" ?
    allowedMediaUrl(primary) || streams.map((entry: RecordValue) => allowedMediaUrl(entry?.url)).find(Boolean) || null
    : null;
  const images = kind === "image_album" && Array.isArray(media.images) ?
    media.images.map((image: RecordValue) => allowedMediaUrl(image?.url)).filter(Boolean).slice(0, 40) : [];
  if (!videoUrl && images.length === 0) {
    throw new DtkPreviewError("DTK found the post but returned no supported public media URL.", 422, "no-media-url");
  }
  const covers = Array.isArray(media.covers) ? media.covers : [];
  return {
    platform: "douyin",
    provider: "dtk",
    id,
    type: videoUrl ? "video" : "images",
    title: String(content.title || content.description || "Douyin media").slice(0, 350),
    author: String(content.author?.nickname || "Douyin creator").slice(0, 150),
    cover: covers.map((image: RecordValue) => allowedMediaUrl(image?.url)).find(Boolean) || null,
    videoUrl,
    images,
    sourceUrl: original.toString(),
    notice: "Download only public media you own or have permission to save."
  };
}

function interpretUpstream(status: number, envelope: RecordValue | null): DtkPreviewError {
  const code = String(envelope?.error?.code ?? "").replace(/[^A-Z0-9_]/g, "").slice(0, 80);
  if (status === 401 || status === 403 || code === "UNAUTHENTICATED" || code === "FORBIDDEN_SCOPE") {
    return new DtkPreviewError("DTK API key is invalid or lacks douyin:read permission.", 502, "auth");
  }
  if (status === 429 || code === "RATE_LIMITED") {
    return new DtkPreviewError("DTK is rate-limiting requests. Try later.", 429, "rate-limited");
  }
  if (code === "IDENTITY_POOL_EXHAUSTED") {
    return new DtkPreviewError("DTK has no healthy Douyin identity. Check its Identities page.", 503, "no-identity");
  }
  if (status === 503) {
    return new DtkPreviewError("DTK is temporarily unavailable. Check the Docker stack.", 503, "unavailable");
  }
  return new DtkPreviewError(
    code ? "DTK rejected the post (" + code + ")." : "DTK could not parse this public post.",
    status >= 500 ? 502 : 422, "upstream-error"
  );
}

export async function resolveDouyinDtk(originalUrl: URL, options: DtkPreviewConfig): Promise<RecordValue> {
  validatedDouyinUrl(originalUrl);
  const origin = validateDtkBaseUrl(options.baseUrl, options.localDev);
  if (!options.apiKey || options.apiKey.length < 12) {
    throw new DtkPreviewError("DTK API key is missing. Create a key scoped douyin:read.", 503, "not-configured");
  }
  const requestFetch = options.fetcher || fetch;
  const pause = options.sleep || ((ms: number) => new Promise<void>(done => setTimeout(done, ms)));
  const clientId = options.accessClientId?.trim() || "";
  const clientSecret = options.accessClientSecret?.trim() || "";
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new DtkPreviewError("DTK Cloudflare Access credentials are incomplete.", 503, "bad-config");
  }
  const headers: Record<string, string> = {
    "x-api-key": options.apiKey,
    "content-type": "application/json",
    "accept": "application/json"
  };
  if (clientId && clientSecret) {
    headers["CF-Access-Client-Id"] = clientId;
    headers["CF-Access-Client-Secret"] = clientSecret;
  }

  async function readJson(url: string, init: RequestInit): Promise<{status: number; body: RecordValue | null}> {
    let response: Response;
    try {
      response = await requestFetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(32000) });
    } catch (error) {
      const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
      throw new DtkPreviewError(timeout ? "DTK did not respond in time." : "Unable to connect to DTK API.", 502, timeout ? "timeout" : "network-error");
    }
    let raw: string;
    try { raw = await response.text(); }
    catch { throw new DtkPreviewError("DTK returned an unreadable response.", 502, "bad-response"); }
    if (raw.length > 900_000) throw new DtkPreviewError("DTK returned an oversized response.", 502, "oversized-response");
    let body: RecordValue | null = null;
    try { const parsed: unknown = JSON.parse(raw); body = parsed && typeof parsed === "object" ? parsed as RecordValue : null; }
    catch { /* avoid returning raw HTML */ }
    if (!body) throw new DtkPreviewError("DTK returned a non-JSON response.", 502, "bad-response");
    return {status: response.status, body};
  }

  let result = await readJson(origin + "/api/v1/parse?wait=25", {
    method: "POST", headers,
    body: JSON.stringify({url: originalUrl.toString(), include_raw: false})
  });
  if (!result.body?.success || result.status >= 400) {
    throw interpretUpstream(result.status, result.body);
  }

  if (result.status === 202) {
    const id = result.body.data?.task_id;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(id)) {
      throw new DtkPreviewError("DTK returned an invalid asynchronous task identifier.", 502, "bad-task");
    }
    let finished = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await pause(1000);
      result = await readJson(origin + "/api/v1/tasks/" + id, {method: "GET", headers});
      if (!result.body?.success || result.status >= 400) throw interpretUpstream(result.status, result.body);
      const task = result.body.data;
      if (task?.state === "failed" || task?.state === "cancelled") {
        throw interpretUpstream(422, {error: task.error});
      }
      if (task?.state === "done") {
        result = {status: 200, body: {success: true, data: task.data}};
        finished = true;
        break;
      }
    }
    if (!finished) throw new DtkPreviewError("DTK is still processing this link; retry in a few seconds.", 504, "task-pending");
  }
  return normalizeContent(result.body?.data, originalUrl);
}

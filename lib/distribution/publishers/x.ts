import { createHmac, randomBytes } from "node:crypto";
import { capabilityOf } from "../../capabilities";
import { PlatformPublishError, type PlatformPublisher, type RemoteStatus } from "../publish";
import { assetOf, downloadOwnMedia, jpegCopy, sleep as defaultSleep, type MediaDeps } from "./media";

// X (Twitter) API v2 with OAuth 1.0a user context, per X's public documentation. NOT live-verified.
// Steps: media upload (images: one request; video: initialize → append chunks → finalize → status) → POST /2/tweets.

type Env = Record<string, string | undefined>;
export type XDeps = MediaDeps & { env?: Env; sleep?: (ms: number) => Promise<void>; nonce?: () => string; timestamp?: () => number };
const API = "https://api.x.com/2";
const CHUNK = 4 * 1024 * 1024;

// RFC 3986 percent-encoding as required by OAuth 1.0a.
export const rfc3986 = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

// OAuth 1.0a HMAC-SHA1 header. Only query parameters (and form-urlencoded bodies) are signed; JSON and multipart bodies are not.
export function oauth1Header(method: string, url: string, keys: { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string },
  extra: Record<string, string> = {}, nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000)) {
  const parsed = new URL(url);
  const oauth: Record<string, string> = { oauth_consumer_key: keys.consumerKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(timestamp), oauth_token: keys.token, oauth_version: "1.0" };
  const params: [string, string][] = [...parsed.searchParams.entries(), ...Object.entries(extra), ...Object.entries(oauth)];
  const normalized = params.map(([key, value]) => [rfc3986(key), rfc3986(value)]).sort((a, b) => a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1).map(([key, value]) => `${key}=${value}`).join("&");
  const base = [method.toUpperCase(), rfc3986(`${parsed.origin}${parsed.pathname}`), rfc3986(normalized)].join("&");
  const signature = createHmac("sha1", `${rfc3986(keys.consumerSecret)}&${rfc3986(keys.tokenSecret)}`).update(base).digest("base64");
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([key, value]) => `${rfc3986(key)}="${rfc3986(value)}"`).join(", ")}`;
}

export function xPublisher(deps: XDeps = {}): PlatformPublisher {
  const env = () => deps.env ?? process.env;
  const request = () => deps.request ?? fetch;
  const wait = deps.sleep ?? defaultSleep;
  const keys = () => {
    const e = env();
    if (!e.X_API_KEY || !e.X_API_SECRET || !e.X_ACCESS_TOKEN || !e.X_ACCESS_TOKEN_SECRET) throw new PlatformPublishError(true, "X-Zugang fehlt");
    return { consumerKey: e.X_API_KEY, consumerSecret: e.X_API_SECRET, token: e.X_ACCESS_TOKEN, tokenSecret: e.X_ACCESS_TOKEN_SECRET };
  };
  async function send(method: string, url: string, body: BodyInit | null, contentType: string | null, beforePublish: boolean) {
    const headers: Record<string, string> = { Authorization: oauth1Header(method, url, keys(), {}, deps.nonce?.(), deps.timestamp?.()) };
    if (contentType) headers["Content-Type"] = contentType;
    let response: Response;
    try { response = await request()(url, { method, headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60_000) }); }
    catch { throw new PlatformPublishError(beforePublish, `${new URL(url).pathname}: Netzwerk/Timeout`); }
    const data = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; errors?: unknown; title?: string };
    if (!response.ok) {
      const label = response.status === 401 || response.status === 403 ? "Zugang abgelehnt oder fehlende Schreibrechte" : response.status === 429 ? "Rate Limit" : `HTTP ${response.status}`;
      throw new PlatformPublishError(beforePublish || (response.status >= 400 && response.status < 500), `${new URL(url).pathname}: ${label}`, response.status);
    }
    return data.data ?? {};
  }
  async function uploadImage(bytes: Buffer, mediaType: string) {
    const form = new FormData();
    form.set("media", new Blob([new Uint8Array(bytes)], { type: mediaType }));
    form.set("media_category", "tweet_image");
    const data = await send("POST", `${API}/media/upload`, form, null, true);
    if (typeof data.id !== "string") throw new PlatformPublishError(true, "media id fehlt");
    return data.id;
  }
  async function uploadVideo(bytes: Buffer) {
    const init = await send("POST", `${API}/media/upload/initialize`, JSON.stringify({ media_type: "video/mp4", total_bytes: bytes.length, media_category: "tweet_video" }), "application/json", true);
    const id = typeof init.id === "string" ? init.id : null;
    if (!id) throw new PlatformPublishError(true, "media id fehlt");
    for (let index = 0, offset = 0; offset < bytes.length; index++, offset += CHUNK) {
      const form = new FormData();
      form.set("media", new Blob([new Uint8Array(bytes.subarray(offset, offset + CHUNK))], { type: "application/octet-stream" }));
      form.set("segment_index", String(index));
      await send("POST", `${API}/media/upload/${id}/append`, form, null, true);
    }
    let processing = (await send("POST", `${API}/media/upload/${id}/finalize`, null, null, true)).processing_info as { state?: string; check_after_secs?: number } | undefined;
    for (let attempt = 0; processing && processing.state !== "succeeded" && attempt < 20; attempt++) {
      if (processing.state === "failed") throw new PlatformPublishError(true, "Video-Verarbeitung bei X fehlgeschlagen");
      await wait(Math.min(10, processing.check_after_secs ?? 2) * 1000);
      processing = (await send("GET", `${API}/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`, null, null, true)).processing_info as typeof processing;
    }
    if (processing && processing.state !== "succeeded") throw new PlatformPublishError(true, "Video-Verarbeitung bei X nicht abgeschlossen");
    return id;
  }
  return {
    platform: "x",
    configured: () => { const capability = capabilityOf("x", env()); return { ok: !capability.missing.length, missing: capability.missing }; },
    supports: variant => ["text", "text_with_images", "video"].includes(variant.mediaFormat),
    async publish(variant, master, context) {
      // 1. Upload media (nothing visible yet).
      const mediaIds: string[] = [];
      if (variant.mediaFormat === "video") {
        mediaIds.push(await uploadVideo(await downloadOwnMedia(assetOf(master, variant.assetRefs[0])?.url, "video", deps)));
      } else if (variant.mediaFormat === "text_with_images") {
        for (const role of variant.assetRefs.slice(0, 4)) {
          const url = await jpegCopy(master, role, deps);
          mediaIds.push(await uploadImage(await downloadOwnMedia(url, "image", deps), "image/jpeg"));
        }
      }
      for (const id of mediaIds) await context.onRemoteId(`media:${id}`);
      // 2. Publish exactly once.
      const posted = await send("POST", `${API}/tweets`, JSON.stringify({ text: variant.text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }), "application/json", false);
      const id = typeof posted.id === "string" && /^\d+$/.test(posted.id) ? posted.id : null;
      if (!id) throw new PlatformPublishError(false, "Post-ID fehlt");
      return { state: "published", externalId: id, url: `https://x.com/i/web/status/${id}` };
    },
    async status(remoteId): Promise<RemoteStatus> {
      // Only a tweet id can be looked up; uploaded media alone means the post call never confirmed.
      if (!/^\d+$/.test(remoteId)) return { state: "processing", detail: "Post nicht bestätigt; auf X prüfen" };
      await send("GET", `${API}/tweets/${remoteId}`, null, null, true);
      return { state: "published", externalId: remoteId, url: `https://x.com/i/web/status/${remoteId}` };
    },
  };
}

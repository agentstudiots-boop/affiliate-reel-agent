import { capabilityOf } from "../../capabilities";
import { PlatformPublishError, type PlatformPublisher, type RemoteStatus } from "../publish";
import { assetOf, jpegCopy, ownBlobUrl, type MediaDeps } from "./media";

// TikTok Content Posting API (Direct Post), per TikTok's public documentation. NOT live-verified.
// Steps: access token (configured or refreshed) → creator info (privacy options, username) → init post with
// PULL_FROM_URL (video or photo slideshow) → status fetch until PUBLISH_COMPLETE.
// Requirements outside this code: approved app with video.publish scope, verified URL prefix for the Blob domain;
// unaudited apps may only post with SELF_ONLY visibility (default here).

const API = "https://open.tiktokapis.com/v2";
type Env = Record<string, string | undefined>;
export type TikTokDeps = MediaDeps & { env?: Env };

type TikTokBody = { data?: Record<string, unknown>; error?: { code?: string; message?: string } };

async function call(request: typeof fetch, path: string, token: string, body: unknown, beforePublish: boolean): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await request(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch { throw new PlatformPublishError(beforePublish, `${path}: Netzwerk/Timeout`); }
  let parsed: TikTokBody;
  try { parsed = await response.json() as TikTokBody; } catch { throw new PlatformPublishError(beforePublish || (response.status >= 400 && response.status < 500), `${path}: ungültige Antwort`, response.status); }
  const code = parsed.error?.code ?? "ok";
  if (!response.ok || code !== "ok") {
    // Only fixed labels: TikTok error codes, never tokens or messages that might echo input.
    const definite = beforePublish || (response.status >= 400 && response.status < 500);
    const label = response.status === 401 || /access_token|scope/.test(code) ? "Zugang abgelehnt" : response.status === 429 || /rate_limit|spam/.test(code) ? "Rate Limit" : code.replace(/[^a-z_]/g, "").slice(0, 60);
    throw new PlatformPublishError(definite, `${path}: ${label}`, response.status);
  }
  return parsed.data ?? {};
}

export async function tiktokAccessToken(env: Env, request: typeof fetch): Promise<string> {
  if (env.TIKTOK_ACCESS_TOKEN?.trim()) return env.TIKTOK_ACCESS_TOKEN.trim();
  if (!env.TIKTOK_REFRESH_TOKEN || !env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) throw new PlatformPublishError(true, "TikTok-Zugang fehlt");
  let response: Response;
  try {
    response = await request(`${API}/oauth/token/`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", cache: "no-store",
      body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: env.TIKTOK_REFRESH_TOKEN }) });
  } catch { throw new PlatformPublishError(true, "TikTok-Token: Netzwerk/Timeout"); }
  const body = await response.json().catch(() => ({})) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new PlatformPublishError(true, "TikTok-Token konnte nicht erneuert werden", response.status);
  return body.access_token;
}

export function tiktokPublisher(deps: TikTokDeps = {}): PlatformPublisher {
  const env = () => deps.env ?? process.env;
  const request = () => deps.request ?? fetch;
  let username: string | null = null;
  return {
    platform: "tiktok",
    configured: () => { const capability = capabilityOf("tiktok", env()); return { ok: !capability.missing.length, missing: capability.missing }; },
    supports: variant => ["video", "photo_slideshow"].includes(variant.mediaFormat) && variant.assetRefs.length > 0,
    async publish(variant, master, context) {
      const token = await tiktokAccessToken(env(), request());
      // 1. Creator info: allowed privacy levels and username (needed for the post URL).
      const creator = await call(request(), "/post/publish/creator_info/query/", token, {}, true);
      username = typeof creator.creator_username === "string" ? creator.creator_username : null;
      const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options.map(String) : [];
      const wanted = env().TIKTOK_PRIVACY_LEVEL?.trim() || "SELF_ONLY";
      if (!options.includes(wanted)) throw new PlatformPublishError(true, `Sichtbarkeit ${wanted} für dieses Konto nicht erlaubt`);
      const commercial = !!master.affiliate_data;
      const postInfo = { title: variant.text.slice(0, 2200), privacy_level: wanted, disable_comment: false, brand_content_toggle: commercial, brand_organic_toggle: false };
      // 2. Upload preparation: media URLs must be our own Blob URLs (verified URL prefix at TikTok).
      let body: Record<string, unknown>, path: string;
      if (variant.mediaFormat === "video") {
        const video = assetOf(master, variant.assetRefs[0]);
        if (!ownBlobUrl(video?.url)) throw new PlatformPublishError(true, "Video fehlt im Blob-Store");
        path = "/post/publish/video/init/";
        body = { post_info: { ...postInfo, disable_duet: false, disable_stitch: false }, source_info: { source: "PULL_FROM_URL", video_url: video!.url } };
      } else {
        const photos: string[] = [];
        for (const role of variant.assetRefs.slice(0, 35)) photos.push(await jpegCopy(master, role, deps));
        path = "/post/publish/content/init/";
        body = { post_info: { ...postInfo, description: variant.text.slice(0, 4000) }, source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: photos },
          post_mode: "DIRECT_POST", media_type: "PHOTO" };
      }
      // 3. Publish (init = direct post). TikTok processes asynchronously; the publish_id is the remote id.
      const init = await call(request(), path, token, body, false);
      const publishId = typeof init.publish_id === "string" ? init.publish_id : null;
      if (!publishId) throw new PlatformPublishError(false, "publish_id fehlt");
      await context.onRemoteId(publishId);
      return { state: "processing", externalId: publishId, url: null };
    },
    async status(publishId): Promise<RemoteStatus> {
      const token = await tiktokAccessToken(env(), request());
      const data = await call(request(), "/post/publish/status/fetch/", token, { publish_id: publishId }, true);
      const status = String(data.status ?? "");
      if (status === "FAILED") return { state: "failed", detail: String(data.fail_reason ?? "failed").replace(/[^a-z_]/gi, "").slice(0, 60) };
      if (status !== "PUBLISH_COMPLETE") return { state: "processing" };
      const ids = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id.map(String) : [];
      // A link only when TikTok returned the public post id and the username is known; otherwise no link.
      return { state: "published", externalId: ids[0] ?? publishId, url: ids[0] && username ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(ids[0])}` : null };
    },
  };
}

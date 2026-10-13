import { capabilityOf, livePublishCapability } from "../../capabilities";
import { assertEffectAllowed } from "../../security/runtime-guard";
import { PlatformPublishError, type PlatformPublisher } from "../publish";
import { assetOf, downloadOwnMedia, ownBlobUrl, sleep, type MediaDeps } from "./media";

// API v5. Only registered at the multi-channel router; no orchestrator/provider shortcut.
// OAuth token rotation needs durable secret storage supplied by the operator. Never write credentials to job data.
const API = "https://api.pinterest.com/v5";
type Env = Record<string, string | undefined>;
export type PinterestTokens = { accessToken: string; expiresAt: number; refreshToken?: string };
export type PinterestTokenStore = {
  // Must serialize renewal across workers and atomically persist returned tokens in encrypted secret storage.
  withLock(work: (current: PinterestTokens) => Promise<PinterestTokens>): Promise<PinterestTokens>;
};
export type PinterestDeps = MediaDeps & { env?: Env; tokens?: PinterestTokenStore; sleep?: typeof sleep; pollAttempts?: number };

export async function refreshPinterestToken(env: Env, token: PinterestTokens, request: typeof fetch): Promise<PinterestTokens> {
  assertEffectAllowed("publish", env);
  if (!env.PINTEREST_CLIENT_ID || !env.PINTEREST_CLIENT_SECRET || !token.refreshToken) throw new PlatformPublishError(true, "Pinterest OAuth-Refresh nicht konfiguriert");
  let response: Response;
  try {
    response = await request(`${API}/oauth/token`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Basic ${Buffer.from(`${env.PINTEREST_CLIENT_ID}:${env.PINTEREST_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }) });
  } catch { throw new PlatformPublishError(true, "Pinterest Token-Erneuerung nicht bestätigt"); }
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in! <= 0) throw new PlatformPublishError(true, "Pinterest Token-Erneuerung abgelehnt", response.status);
  return { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in! * 1000, refreshToken: body.refresh_token || token.refreshToken };
}

export function pinterestPublisher(deps: PinterestDeps = {}): PlatformPublisher {
  const env = () => deps.env ?? process.env;
  const request = deps.request ?? fetch;
  async function token() {
    if (deps.tokens) {
      const saved = await deps.tokens.withLock(async current => current.expiresAt > Date.now() + 60_000 ? current : refreshPinterestToken(env(), current, request));
      return saved.accessToken;
    }
    const expiry = Date.parse(env().PINTEREST_ACCESS_TOKEN_EXPIRES_AT ?? "");
    if (!env().PINTEREST_ACCESS_TOKEN || !Number.isFinite(expiry) || expiry <= Date.now() + 60_000)
      throw new PlatformPublishError(true, "Pinterest Access-Token fehlt/abgelaufen; OAuth erneuern und sicher speichern");
    return env().PINTEREST_ACCESS_TOKEN!;
  }
  async function api(path: string, access: string, body?: unknown, publishes = false) {
    let response: Response;
    try {
      response = await request(`${API}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new PlatformPublishError(!publishes, publishes ? "Pinterest Veröffentlichung unklar – nicht erneut senden" : "Pinterest nicht erreichbar"); }
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new PlatformPublishError(!publishes || (response.status >= 400 && response.status < 500 && response.status !== 408), `Pinterest HTTP ${response.status}`, response.status);
    return data;
  }
  return {
    platform: "pinterest",
    configured: () => { const c = capabilityOf("pinterest", env()); return { ok: !c.missing.length, missing: c.missing }; },
    supports: variant => ["image", "video"].includes(variant.mediaFormat) && variant.assetRefs.length === 1,
    async publish(variant, master, context) {
      assertEffectAllowed("publish", env());
      if (!livePublishCapability("pinterest", env(), master.source_ref ? "product_pipeline" : "topic_pipeline").ok)
        throw new PlatformPublishError(true, "Pinterest nicht freigeschaltet");
      const board = env().PINTEREST_BOARD_ID ?? "";
      if (!/^\d+$/.test(board)) throw new PlatformPublishError(true, "Pinterest Board-ID ungültig");
      const asset = assetOf(master, variant.assetRefs[0]);
      const url = ownBlobUrl(asset?.url);
      if (!url || !["image", "video"].includes(variant.mediaFormat)) throw new PlatformPublishError(true, "Pinterest Medium fehlt/ungültig");
      const access = await token();
      let source: Record<string, unknown>;
      if (variant.mediaFormat === "image") {
        source = { source_type: "image_url", url: url.href };
      } else {
        // Cover must be part of the approved master content, not a new paid generation or an unapproved env URL.
        const cover = master.assets.find(item => item.kind === "image" && ownBlobUrl(item.url));
        if (!cover) throw new PlatformPublishError(true, "Pinterest Video benötigt ein freigegebenes Titelbild im Master-Content");
        const bytes = await downloadOwnMedia(url.href, "video", deps);
        const registered = await api("/media", access, { media_type: "video" });
        const mediaId = String(registered.media_id ?? "");
        let uploadUrl: URL;
        try { uploadUrl = new URL(String(registered.upload_url)); } catch { throw new PlatformPublishError(true, "Pinterest Upload-URL ungültig"); }
        // Pinterest's documented pre-signed AWS upload target. Never forward the OAuth token there.
        if (!/^\d+$/.test(mediaId) || uploadUrl.protocol !== "https:" || uploadUrl.username || uploadUrl.password ||
          !/^pinterest-media-upload\.s3(?:-accelerate|[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(uploadUrl.hostname))
          throw new PlatformPublishError(true, "Pinterest Upload-Ziel ungültig");
        await context.onRemoteId(`media:${mediaId}`);
        const form = new FormData();
        if (!registered.upload_parameters || typeof registered.upload_parameters !== "object") throw new PlatformPublishError(true, "Pinterest Upload-Parameter fehlen");
        for (const [key, value] of Object.entries(registered.upload_parameters)) {
          if (typeof value !== "string") throw new PlatformPublishError(true, "Pinterest Upload-Parameter ungültig");
          form.append(key, value);
        }
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), "video.mp4");
        let uploaded: Response;
        try { uploaded = await request(uploadUrl.href, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(60_000) }); }
        catch { throw new PlatformPublishError(true, "Pinterest Medienupload nicht bestätigt; noch kein Pin erstellt"); }
        if (!uploaded.ok) throw new PlatformPublishError(true, "Pinterest Medienupload abgelehnt", uploaded.status);
        let ready = false;
        for (let attempt = 0; attempt < Math.max(1, Math.min(12, deps.pollAttempts ?? 6)); attempt++) {
          const media = await api(`/media/${mediaId}`, access);
          if (media.status === "succeeded") { ready = true; break; }
          if (media.status === "failed") throw new PlatformPublishError(true, "Pinterest Videoverarbeitung fehlgeschlagen");
          await (deps.sleep ?? sleep)(2000);
        }
        if (!ready) throw new PlatformPublishError(true, "Pinterest Video noch nicht bereit; kein Pin erstellt");
        source = { source_type: "video_id", media_id: mediaId, cover_image_url: cover.url };
      }
      await context.beforePublish(); // approval may have changed during the video upload
      const pin = await api("/pins", access, { board_id: board, title: (variant.title ?? master.hook).slice(0, 100),
        description: variant.text.slice(0, 500), ...(variant.links[0] ? { link: variant.links[0] } : {}), media_source: source }, true);
      const id = String(pin.id ?? "");
      if (!/^\d+$/.test(id)) throw new PlatformPublishError(false, "Pinterest Pin-ID fehlt – Ergebnis unklar");
      await context.onRemoteId(id);
      return { state: "published", externalId: id, url: `https://www.pinterest.com/pin/${id}/` };
    },
    async status(id) {
      if (!/^\d+$/.test(id)) return { state: "unknown", detail: "Nur Medienupload bekannt; kein Pin nachgewiesen" };
      const pin = await api(`/pins/${id}`, await token());
      return String(pin.id) === id ? { state: "published", externalId: id, url: `https://www.pinterest.com/pin/${id}/` } : { state: "unknown" };
    },
  };
}

import { capabilityOf } from "../../capabilities";
import { PlatformPublishError, type PlatformPublisher, type RemoteStatus } from "../publish";
import { assetOf, downloadOwnMedia, type MediaDeps } from "./media";

// YouTube Shorts via YouTube Data API v3, per Google's public documentation. NOT live-verified.
// Steps: OAuth refresh → resumable upload session (metadata) → upload bytes (= publish) → status (processing).
// A vertical video ≤ 60 s is shown as a Short; "#Shorts" in the title helps classification.

type Env = Record<string, string | undefined>;
export type YouTubeDeps = MediaDeps & { env?: Env };

export async function youtubeAccessToken(env: Env, request: typeof fetch): Promise<string> {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.YOUTUBE_REFRESH_TOKEN) throw new PlatformPublishError(true, "YouTube-Zugang fehlt");
  let response: Response;
  try {
    response = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", cache: "no-store",
      body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, refresh_token: env.YOUTUBE_REFRESH_TOKEN, grant_type: "refresh_token" }) });
  } catch { throw new PlatformPublishError(true, "YouTube-Token: Netzwerk/Timeout"); }
  const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) throw new PlatformPublishError(true, body.error === "invalid_grant" ? "YouTube-Refresh-Token ungültig oder widerrufen" : "YouTube-Token nicht erhalten", response.status);
  return body.access_token;
}

export function youtubePublisher(deps: YouTubeDeps = {}): PlatformPublisher {
  const env = () => deps.env ?? process.env;
  const request = () => deps.request ?? fetch;
  return {
    platform: "youtube",
    configured: () => { const capability = capabilityOf("youtube", env()); return { ok: !capability.missing.length, missing: capability.missing }; },
    supports: variant => variant.mediaFormat === "short" && variant.assetRefs.length === 1,
    async publish(variant, master, context) {
      const token = await youtubeAccessToken(env(), request());
      const video = assetOf(master, variant.assetRefs[0]);
      const bytes = await downloadOwnMedia(video?.url, "video", deps);
      const title = `${(variant.title ?? master.hook).slice(0, 90)} #Shorts`.slice(0, 100);
      const metadata = { snippet: { title, description: variant.text.slice(0, 5000), categoryId: env().YOUTUBE_CATEGORY_ID || "26", tags: variant.hashtags.map(tag => tag.replace(/^#/, "")).slice(0, 10) },
        status: { privacyStatus: ["public", "unlisted", "private"].includes(env().YOUTUBE_PRIVACY_STATUS ?? "") ? env().YOUTUBE_PRIVACY_STATUS : "private", selfDeclaredMadeForKids: false,
          containsSyntheticMedia: master.disclosures.some(item => /KI/.test(item)) } };
      // 1. Upload session (nothing created yet → definite on failure).
      let session: Response;
      try {
        session = await request()("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", redirect: "error", cache: "no-store",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(bytes.length) },
          body: JSON.stringify(metadata) });
      } catch { throw new PlatformPublishError(true, "Upload-Sitzung: Netzwerk/Timeout"); }
      const location = session.headers.get("location");
      if (!session.ok || !location?.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
        throw new PlatformPublishError(true, session.status === 403 ? "Upload-Sitzung abgelehnt (Kontingent oder Berechtigung)" : `Upload-Sitzung fehlgeschlagen (HTTP ${session.status})`, session.status);
      }
      await context.onRemoteId(`session:${new URL(location).searchParams.get("upload_id") ?? "unknown"}`);
      // 2. Upload bytes = publish. A lost answer may still have created the video → unknown, never re-uploaded automatically.
      let uploaded: Response;
      try { uploaded = await request()(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" }, body: new Uint8Array(bytes), redirect: "error", cache: "no-store" }); }
      catch { throw new PlatformPublishError(false, "Upload: Ergebnis unklar"); }
      const body = await uploaded.json().catch(() => ({})) as { id?: string };
      if (!uploaded.ok || !body.id || !/^[A-Za-z0-9_-]{6,20}$/.test(body.id)) throw new PlatformPublishError(uploaded.status >= 400 && uploaded.status < 500, `Upload fehlgeschlagen (HTTP ${uploaded.status})`, uploaded.status);
      await context.onRemoteId(body.id);
      return { state: "processing", externalId: body.id, url: `https://www.youtube.com/shorts/${body.id}` };
    },
    async status(videoId): Promise<RemoteStatus> {
      if (videoId.startsWith("session:")) return { state: "processing", detail: "Upload-Ergebnis unklar; im YouTube Studio prüfen" };
      const token = await youtubeAccessToken(env(), request());
      const response = await request()(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { items?: { status?: { uploadStatus?: string; failureReason?: string; rejectionReason?: string } }[] };
      const item = body.items?.[0];
      if (!response.ok || !item) return { state: "processing" };
      const status = item.status?.uploadStatus;
      if (status === "failed" || status === "rejected" || status === "deleted") return { state: "failed", detail: String(item.status?.failureReason ?? item.status?.rejectionReason ?? status) };
      if (status === "processed") return { state: "published", externalId: videoId, url: `https://www.youtube.com/shorts/${videoId}` };
      return { state: "processing" };
    },
  };
}

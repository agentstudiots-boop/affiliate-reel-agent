import { cachedMetaConnection, metaConfig, pagePublishingToken } from "./connection";
import { validReelVideoUrl } from "./instagram-reel";

export class InstagramPublishFailure extends Error {
  constructor(public phase: "connection" | "container" | "status" | "publish" | "permalink", public detail: string,
    public httpStatus = 0, public code = 0, public subcode = 0) { super("Instagram Graph API did not confirm the requested operation"); }
}

async function graph(path: string, token: string, version: string, transport: typeof fetch, phase: InstagramPublishFailure["phase"], form?: URLSearchParams) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  if (!form) url.searchParams.set("fields", phase === "status" ? "status_code" : "id,permalink");
  let response: Response;
  try { response = await transport(url, {
    method: form ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    ...(form ? { body: form } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
  }); } catch { throw new InstagramPublishFailure(phase,"network_or_timeout"); }
  let body: { id?: string; status_code?: string; permalink?: string; error?: { code?: number; error_subcode?: number } };
  try { body = await response.json() as typeof body; }
  catch { throw new InstagramPublishFailure(phase,"invalid_response",response.status); }
  if (!response.ok || body.error) throw new InstagramPublishFailure(phase,"graph_error",response.status,body.error?.code,body.error?.error_subcode);
  return body;
}

export async function instagramGraph(transport: typeof fetch = fetch) {
  const report = await cachedMetaConnection();
  const config = metaConfig();
  if (report.status !== "connected" || !report.publishingReadCheck || !report.resolved?.instagramId || !report.resolved.pageId) {
    throw new InstagramPublishFailure("connection",report.status);
  }
  const token = await pagePublishingToken(report.resolved.pageId,config,transport);
  if (token.status !== "ready") throw new InstagramPublishFailure("connection",`page_token_${token.status}`,token.httpStatus,token.code,token.subcode);
  const instagramId = report.resolved.instagramId;
  const version = config.version || "v25.0";
  return {
    async create(videoUrl: string, caption: string) {
      if (!validReelVideoUrl(videoUrl) || !caption.startsWith("Werbung |") || caption.length > 2200) {
        throw new InstagramPublishFailure("container","invalid_media_or_caption");
      }
      const result = await graph(`${instagramId}/media`,token.token,version,transport,"container",
        new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "false" }));
      if (!/^\d+$/.test(result.id || "")) throw new InstagramPublishFailure("container","missing_container_id");
      return result.id!;
    },
    async status(containerId: string) {
      if (!/^\d+$/.test(containerId)) throw new InstagramPublishFailure("status","invalid_container_id");
      const result = await graph(containerId,token.token,version,transport,"status");
      return result.status_code === "FINISHED" ? "FINISHED" as const : result.status_code === "ERROR" || result.status_code === "EXPIRED"
        ? "ERROR" as const : "PROCESSING" as const;
    },
    async publish(containerId: string) {
      if (!/^\d+$/.test(containerId)) throw new InstagramPublishFailure("publish","invalid_container_id");
      const result = await graph(`${instagramId}/media_publish`,token.token,version,transport,"publish",new URLSearchParams({creation_id:containerId}));
      if (!/^\d+$/.test(result.id || "")) throw new InstagramPublishFailure("publish","missing_media_id");
      return result.id!;
    },
    async permalink(mediaId: string) {
      if (!/^\d+$/.test(mediaId)) throw new InstagramPublishFailure("permalink","invalid_media_id");
      const result = await graph(mediaId,token.token,version,transport,"permalink");
      if (result.id !== mediaId || !result.permalink?.startsWith("https://www.instagram.com/")) throw new InstagramPublishFailure("permalink","invalid_permalink");
      return result.permalink;
    },
  };
}

import { cachedMetaConnection, metaConfig, pagePublishingToken } from "./connection";
import { validReelVideoUrl } from "./instagram-reel";

// No documented arbitrary external CTA in this Facebook Login organic Reels flow.
// Product tagging requires separate eligible catalog IDs/permissions, not an Amazon URL.
export const ORGANIC_REEL_CAPABILITIES = Object.freeze({ externalShoppingButton: false });
export function organicReelPayload(videoUrl: string, caption: string, shoppingUrl?: string) {
  if (shoppingUrl) throw new InstagramPublishFailure("container", "external_shopping_cta_unsupported");
  return new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "false" });
}

export function validInstagramImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search
      && url.hostname.endsWith(".public.blob.vercel-storage.com")
      && /^\/generated\/instagram\/[0-9a-f-]{36}\/[a-f0-9]{64}\.jpg$/.test(url.pathname);
  } catch { return false; }
}

// Topic pipeline media (lib/distribution): JPEG images and MP4 videos stored under generated/topics/ in the Blob store.
export function validTopicMediaUrl(value: string, kind: "image" | "video") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && url.hostname.endsWith(".public.blob.vercel-storage.com")
      && (kind === "image" ? /^\/generated\/topics\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.jpg$/ : /^\/generated\/topics\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp4$/).test(url.pathname);
  } catch { return false; }
}

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
      if (!(validReelVideoUrl(videoUrl, "FACELESS_STORYBOARD") || validReelVideoUrl(videoUrl, "RUNWAY_SINGLE_CLIP"))
        || !caption.startsWith("Werbung |") || caption.length > 2200) {
        throw new InstagramPublishFailure("container","invalid_media_or_caption");
      }
      const result = await graph(`${instagramId}/media`,token.token,version,transport,"container",
        organicReelPayload(videoUrl, caption));
      if (!/^\d+$/.test(result.id || "")) throw new InstagramPublishFailure("container","missing_container_id");
      return result.id!;
    },
    // Feed image: Instagram accepts JPEG only. The caller converts the approved PNG.
    async createImage(imageUrl: string, caption: string) {
      if (!validInstagramImageUrl(imageUrl) || !caption.trim() || caption.length > 2200) {
        throw new InstagramPublishFailure("container","invalid_media_or_caption");
      }
      const result = await graph(`${instagramId}/media`,token.token,version,transport,"container",
        new URLSearchParams({ image_url: imageUrl, caption }));
      if (!/^\d+$/.test(result.id || "")) throw new InstagramPublishFailure("container","missing_container_id");
      return result.id!;
    },
    // Topic pipeline (additive): image (optionally as carousel item), carousel parent, reel. Same token, same graph helper.
    async createTopicImage(imageUrl: string, caption: string, carouselItem = false) {
      if (!validTopicMediaUrl(imageUrl, "image") || (!carouselItem && (!caption.trim() || caption.length > 2200))) throw new InstagramPublishFailure("container","invalid_media_or_caption");
      const form = carouselItem ? new URLSearchParams({ image_url: imageUrl, is_carousel_item: "true" }) : new URLSearchParams({ image_url: imageUrl, caption });
      const result = await graph(`${instagramId}/media`,token.token,version,transport,"container",form);
      if (!/^\d+$/.test(result.id || "")) throw new InstagramPublishFailure("container","missing_container_id");
      return result.id!;
    },
    async createTopicCarousel(childIds: string[], caption: string) {
      if (childIds.length < 2 || childIds.length > 10 || !childIds.every(id => /^\d+$/.test(id)) || !caption.trim() || caption.length > 2200) throw new InstagramPublishFailure("container","invalid_carousel");
      const result = await graph(`${instagramId}/media`,token.token,version,transport,"container",new URLSearchParams({ media_type: "CAROUSEL", children: childIds.join(","), caption }));
      if (!/^\d+$/.test(result.id || "")) throw new InstagramPublishFailure("container","missing_container_id");
      return result.id!;
    },
    async createTopicReel(videoUrl: string, caption: string) {
      if (!validTopicMediaUrl(videoUrl, "video") || !caption.trim() || caption.length > 2200) throw new InstagramPublishFailure("container","invalid_media_or_caption");
      const result = await graph(`${instagramId}/media`,token.token,version,transport,"container",new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" }));
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

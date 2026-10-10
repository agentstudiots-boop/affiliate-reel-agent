import { assertEffectAllowed } from "../security/runtime-guard";
import { cachedMetaConnection, metaConfig, pagePublishingToken } from "./connection";
import { FacebookPublishFailure } from "./publisher";

// Additional Facebook Page operations for the topic pipeline (text post, multi-photo album, video), next to the
// existing publishFacebookPhoto. Same connection check, same page token derivation, same failure type.
// Every write is one POST; nothing here retries. Callers decide (via the publish gate) whether a write may happen.

type GraphResult = { id?: string; post_id?: string; error?: { code?: number; error_subcode?: number } };

export async function facebookPageGraph(transport: typeof fetch = fetch) {
  const report = await cachedMetaConnection();
  const config = metaConfig();
  if (report.status !== "connected" || !report.resolved?.pageId || !config.token) throw new FacebookPublishFailure("connection", report.status);
  const pageId = report.resolved.pageId;
  const pageToken = await pagePublishingToken(pageId, config, transport);
  if (pageToken.status !== "ready") throw new FacebookPublishFailure("connection", `page_token_${pageToken.status}`, pageToken.httpStatus, pageToken.code, pageToken.subcode);
  const version = config.version || "v25.0";
  const post = async (path: string, form: URLSearchParams): Promise<GraphResult> => {
    assertEffectAllowed("publish");
    let response: Response;
    try {
      response = await transport(`https://graph.facebook.com/${version}/${path}`, { method: "POST", body: form, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${pageToken.token}`, "Content-Type": "application/x-www-form-urlencoded" } });
    } catch { throw new FacebookPublishFailure("request", "network_or_timeout"); }
    let data: GraphResult;
    try { data = await response.json() as GraphResult; } catch { throw new FacebookPublishFailure("response", "invalid_json", response.status); }
    if (!response.ok || data.error) throw new FacebookPublishFailure("response", "graph_error", response.status, data.error?.code, data.error?.error_subcode);
    return data;
  };
  const postUrl = (id: string) => `https://www.facebook.com/${encodeURIComponent(id)}`;
  return {
    pageId,
    async textPost(message: string, link?: string | null) {
      const data = await post(`${pageId}/feed`, new URLSearchParams({ message, ...(link ? { link } : {}) }));
      if (!/^\d+_\d+$/.test(data.id || "")) throw new FacebookPublishFailure("response", "missing_post_id", 200);
      return { id: data.id!, permalink: postUrl(data.id!) };
    },
    // Album: photos are uploaded unpublished first (definite, nothing visible), then one feed post attaches them.
    async uploadUnpublishedPhoto(url: string) {
      const data = await post(`${pageId}/photos`, new URLSearchParams({ url, published: "false" }));
      if (!/^\d+$/.test(data.id || "")) throw new FacebookPublishFailure("response", "missing_photo_id", 200);
      return data.id!;
    },
    async albumPost(message: string, photoIds: string[]) {
      if (photoIds.length < 2 || !photoIds.every(id => /^\d+$/.test(id))) throw new FacebookPublishFailure("image", "invalid_album");
      const form = new URLSearchParams({ message });
      photoIds.forEach((id, index) => form.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id })));
      const data = await post(`${pageId}/feed`, form);
      if (!/^\d+_\d+$/.test(data.id || "")) throw new FacebookPublishFailure("response", "missing_post_id", 200);
      return { id: data.id!, permalink: postUrl(data.id!) };
    },
    async videoPost(fileUrl: string, description: string) {
      const data = await post(`${pageId}/videos`, new URLSearchParams({ file_url: fileUrl, description }));
      if (!/^\d+$/.test(data.id || "")) throw new FacebookPublishFailure("response", "missing_video_id", 200);
      return { id: data.id!, permalink: `https://www.facebook.com/${encodeURIComponent(pageId)}/videos/${encodeURIComponent(data.id!)}` };
    },
  };
}

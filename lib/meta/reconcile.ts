import { cachedMetaConnection, metaConfig } from "./connection";

export type PhotoReconciliation =
  | { status: "found"; permalink: string }
  | { status: "not_found" | "incomplete" | "unavailable"; reason: string; httpStatus?: number; code?: number; subcode?: number };

type Photo = { id?: string; name?: string; created_time?: string; permalink_url?: string };
type PhotoResponse = { data?: Photo[]; paging?: { next?: string }; error?: { code?: number; error_subcode?: number } };

function normalize(value: string) { return value.replace(/\s+/g, " ").trim(); }

// Read only. An empty result never authorizes another publication attempt.
export async function reconcileFacebookPhoto(caption: string, attemptedAt: string, transport: typeof fetch = fetch): Promise<PhotoReconciliation> {
  const report = await cachedMetaConnection();
  const config = metaConfig();
  if (report.status !== "connected" || !report.resolved?.pageId || !config.token) {
    return { status: "unavailable", reason: `meta_connection_${report.status}` };
  }
  const attempted = Date.parse(attemptedAt);
  if (!Number.isFinite(attempted)) return { status: "unavailable", reason: "invalid_attempt_time" };
  const url = new URL(`https://graph.facebook.com/${config.version}/${report.resolved.pageId}/photos`);
  url.searchParams.set("fields", "id,name,created_time,permalink_url");
  url.searchParams.set("since", String(Math.floor((attempted - 300_000) / 1000)));
  url.searchParams.set("until", String(Math.floor((attempted + 1_200_000) / 1000)));
  url.searchParams.set("limit", "100");
  let response: Response;
  try {
    response = await transport(url, { method: "GET", headers: { Authorization: `Bearer ${config.token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
  } catch {
    return { status: "unavailable", reason: "network_or_timeout" };
  }
  let body: PhotoResponse;
  try { body = await response.json() as PhotoResponse; }
  catch { return { status: "unavailable", reason: "invalid_response", httpStatus: response.status }; }
  if (!response.ok || body.error) return { status: "unavailable", reason: "graph_error", httpStatus: response.status, code: body.error?.code, subcode: body.error?.error_subcode };
  if (!Array.isArray(body.data)) return { status: "unavailable", reason: "invalid_response", httpStatus: response.status };
  const match = body.data.find(photo => photo.name && normalize(photo.name) === normalize(caption)
    && photo.created_time && Math.abs(Date.parse(photo.created_time) - attempted) <= 1_200_000);
  if (match?.id && /^\d+$/.test(match.id)) {
    const permalink = match.permalink_url && /^https:\/\/(www\.)?facebook\.com\//.test(match.permalink_url)
      ? match.permalink_url : `https://www.facebook.com/photo.php?fbid=${match.id}`;
    return { status: "found", permalink };
  }
  if (body.paging?.next) return { status: "incomplete", reason: "additional_pages" };
  return { status: "not_found", reason: "no_matching_photo_in_time_window" };
}

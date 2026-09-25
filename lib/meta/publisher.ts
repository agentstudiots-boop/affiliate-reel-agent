import { cachedMetaConnection, metaConfig } from "./connection";

export class FacebookPublishFailure extends Error {
  constructor(public phase: "image" | "connection" | "request" | "response", public detail: string,
    public httpStatus = 0, public code = 0, public subcode = 0) {
    super("Facebook publication did not return a confirmed result");
  }
}

export async function publishFacebookPhoto(imageUrl: string, message: string, transport: typeof fetch = fetch) {
  let image: URL;
  try { image = new URL(imageUrl); }
  catch { throw new FacebookPublishFailure("image", "invalid_url"); }
  if (image.protocol !== "https:" || image.username || image.password || !image.hostname.endsWith("public.blob.vercel-storage.com")) {
    throw new FacebookPublishFailure("image", "untrusted_url");
  }
  const report = await cachedMetaConnection();
  const config = metaConfig();
  if (report.status !== "connected" || !report.resolved?.pageId || !config.token) throw new FacebookPublishFailure("connection", report.status);
  const form = new URLSearchParams({url:imageUrl,message,published:"true"});
  let response: Response;
  try {
    response = await transport(`https://graph.facebook.com/${config.version}/${report.resolved.pageId}/photos`,{
      method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/x-www-form-urlencoded"},
      body:form,signal:AbortSignal.timeout(15000),cache:"no-store",redirect:"error",
    });
  } catch { throw new FacebookPublishFailure("request", "network_or_timeout"); }
  let data: {id?:string;post_id?:string;error?:{code?:number;error_subcode?:number}};
  try { data = await response.json() as typeof data; }
  catch { throw new FacebookPublishFailure("response", "invalid_json", response.status); }
  if (!response.ok || data.error) throw new FacebookPublishFailure("response", "graph_error", response.status, data.error?.code, data.error?.error_subcode);
  if (!/^\d+$/.test(data.id || "")) throw new FacebookPublishFailure("response", "missing_photo_id", response.status);
  return {id:data.post_id || data.id!,permalink:data.post_id
    ? `https://www.facebook.com/${encodeURIComponent(data.post_id)}`
    : `https://www.facebook.com/photo.php?fbid=${encodeURIComponent(data.id!)}`};
}

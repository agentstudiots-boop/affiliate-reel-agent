import { cachedMetaConnection, metaConfig } from "./connection";

export async function publishFacebookPhoto(imageUrl: string, message: string, transport: typeof fetch = fetch) {
  const image = new URL(imageUrl);
  if (image.protocol !== "https:" || image.username || image.password || !image.hostname.endsWith("public.blob.vercel-storage.com")) {
    throw new Error("Öffentliches, kontrolliertes Bild fehlt.");
  }
  const report = await cachedMetaConnection();
  const config = metaConfig();
  if (report.status !== "connected" || !report.resolved?.pageId || !config.token) throw new Error("Meta-Verbindung nicht vollständig bestätigt.");
  const form = new URLSearchParams({url:imageUrl,message,published:"true"});
  const response = await transport(`https://graph.facebook.com/${config.version}/${report.resolved.pageId}/photos`,{
    method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/x-www-form-urlencoded"},
    body:form,signal:AbortSignal.timeout(15000),cache:"no-store",redirect:"error",
  });
  const data = await response.json() as {id?:string;post_id?:string;error?:{code?:number}};
  if (!response.ok || data.error || !/^\d+$/.test(data.id || "")) throw new Error("Meta-Veröffentlichung fehlgeschlagen oder Ergebnis unklar.");
  return {id:data.post_id || data.id!,permalink:data.post_id
    ? `https://www.facebook.com/${encodeURIComponent(data.post_id)}`
    : `https://www.facebook.com/photo.php?fbid=${encodeURIComponent(data.id!)}`};
}

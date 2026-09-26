import { cachedMetaConnection, metaConfig, pagePublishingToken, publicMetaReport } from "@/lib/meta/connection";
export const runtime="nodejs";
export const maxDuration=120;
export const dynamic="force-dynamic";
// Public coarse health check, cached server-side; no assets/IDs/tokens returned.
export async function GET(){
  const checked=await cachedMetaConnection();
  const report=publicMetaReport(checked);
  const pageToken=checked.status==="connected"&&checked.resolved?.pageId
    ? await pagePublishingToken(checked.resolved.pageId,metaConfig()) : {status:"unavailable" as const,source:"derived" as const};
  const pagePublishing={status:pageToken.status,source:pageToken.source,...(pageToken.status==="ready"?{}:{httpStatus:pageToken.httpStatus,code:pageToken.code,subcode:pageToken.subcode})};
  console.info(JSON.stringify({event:"meta_connection_check",status:report.status,connectionOk:report.connectionOk,pagePublishing:pagePublishing.status,publishingEnabled:false}));
  return Response.json({...report,pagePublishing},{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}

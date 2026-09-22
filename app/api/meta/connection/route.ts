import { cachedMetaConnection, publicMetaReport } from "@/lib/meta/connection";
export const runtime="nodejs";
export const maxDuration=120;
export const dynamic="force-dynamic";
// Public coarse health check, cached server-side; no assets/IDs/tokens returned.
export async function GET(){
  const report=publicMetaReport(await cachedMetaConnection());
  console.info(JSON.stringify({event:"meta_connection_check",status:report.status,connectionOk:report.connectionOk,publishingEnabled:false}));
  return Response.json(report,{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}

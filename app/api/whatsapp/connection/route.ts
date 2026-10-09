import {authorized,unauthorizedResponse} from "@/lib/memory/auth";
import {checkWhatsAppConnection} from "@/lib/whatsapp/connection";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;

export async function GET(request: Request){
  if(!authorized(request))return unauthorizedResponse();
  const report=await checkWhatsAppConnection();
  console.info(JSON.stringify({event:"whatsapp_connection_check",status:report.status,connectionOk:report.connectionOk,code:report.code,subcode:report.subcode}));
  return Response.json(report,{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}

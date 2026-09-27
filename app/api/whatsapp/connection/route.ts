import {checkWhatsAppConnection} from "@/lib/whatsapp/connection";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;

export async function GET(){
  const report=await checkWhatsAppConnection();
  console.info(JSON.stringify({event:"whatsapp_connection_check",status:report.status,connectionOk:report.connectionOk,code:report.code,subcode:report.subcode}));
  return Response.json(report,{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}

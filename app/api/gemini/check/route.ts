import { cachedGeminiProbe,diagnosticAuthorized } from "@/lib/diagnostics/gemini";
export const runtime="nodejs";
export const maxDuration=30;
export function GET(){return Response.json({keyConfigured:!!process.env.GOOGLE_GENERATIVE_AI_API_KEY,protectedProbeConfigured:!!(process.env.DIAGNOSTICS_SECRET||process.env.CONTENT_STUDIO_PASSWORD),quotaTested:false},{headers:{"Cache-Control":"no-store"}});}
export async function POST(request:Request){
  if(!diagnosticAuthorized(request))return Response.json({error:"Geschützter Diagnosetest benötigt DIAGNOSTICS_SECRET oder CONTENT_STUDIO_PASSWORD. Kein Gemini-Aufruf ausgeführt."},{status:401});
  const report=await cachedGeminiProbe();
  console.info(JSON.stringify({event:"gemini_connection_check",status:report.status}));
  return Response.json(report,{headers:{"Cache-Control":"no-store"}});
}

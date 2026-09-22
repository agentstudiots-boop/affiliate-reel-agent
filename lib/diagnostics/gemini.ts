import { timingSafeEqual } from "node:crypto";
export function diagnosticAuthorized(request:Request){
  const key=process.env.DIAGNOSTICS_SECRET || process.env.CONTENT_STUDIO_PASSWORD;
  if(!key)return false;
  const expected=Buffer.from(key),actual=Buffer.from(request.headers.get("x-diagnostics-secret")||"");
  return expected.length===actual.length && timingSafeEqual(expected,actual);
}
export type GeminiReport={status:"available"|"key_missing"|"quota_exhausted"|"credits_exhausted"|"access_denied"|"configuration_error"|"unavailable";message:string;checkedAt:string};
export async function probeGemini(config:{key?:string;model?:string},transport:typeof fetch=fetch):Promise<GeminiReport>{
  const checkedAt=new Date().toISOString();const done=(status:GeminiReport["status"],message:string)=>({status,message,checkedAt});
  if(!config.key)return done("key_missing","GOOGLE_GENERATIVE_AI_API_KEY fehlt serverseitig.");
  const model=config.model||"gemini-2.5-flash";
  if(!/^[a-zA-Z0-9.-]+$/.test(model))return done("configuration_error","Ungültiger Modellname.");
  try{
    const response=await transport(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":config.key},signal:AbortSignal.timeout(15000),redirect:"error",
      body:JSON.stringify({contents:[{parts:[{text:"Reply OK."}]}],generationConfig:{maxOutputTokens:2,thinkingConfig:{thinkingBudget:0},temperature:0}}),
    });
    if(response.ok)return done("available","Ein einzelner minimaler Gemini-Generierungsaufruf war erfolgreich.");
    const body=await response.json().catch(()=>({}));const internalMessage=String(body.error?.message||"");
    if(/prepay|credit|billing|payment/i.test(internalMessage))return done("credits_exhausted","Gemini meldet ein Guthaben- oder Abrechnungsproblem. Kein erneuter Versuch.");
    if(response.status===429 || body.error?.status==="RESOURCE_EXHAUSTED")return done("quota_exhausted","Gemini-Quota erschöpft. Kein erneuter Versuch.");
    if([401,403].includes(response.status))return done("access_denied","Gemini verweigert den Schlüssel- oder Projektzugriff.");
    if([400,404].includes(response.status))return done("configuration_error","Gemini-Modell oder Request-Konfiguration nicht verfügbar.");
    return done("unavailable","Gemini meldet einen Dienstfehler. Kein erneuter Versuch.");
  }catch{return done("unavailable","Gemini konnte wegen Timeout oder Netzwerkfehler nicht geprüft werden. Kein erneuter Versuch.");}
}
let cached:{until:number;result:GeminiReport}|undefined;let pending:Promise<GeminiReport>|undefined;
export async function cachedGeminiProbe(){
  if(cached && cached.until>Date.now())return cached.result;
  if(pending)return pending;
  pending=probeGemini({key:process.env.GOOGLE_GENERATIVE_AI_API_KEY,model:process.env.GEMINI_DIAGNOSTICS_MODEL}).then(result=>{cached={until:Date.now()+900000,result};return result;}).finally(()=>{pending=undefined;});
  return pending;
}

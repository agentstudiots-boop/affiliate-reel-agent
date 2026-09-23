import { z } from "zod";

const BASE_URL = "https://faceless.so/api/v1";
const errorTypes = z.enum(["invalid_input","unauthorized","forbidden_scope","not_found","conflict","insufficient_credits","usage_limit_reached","rate_limited","internal_error"]);
const errorEnvelope = z.object({ success:z.literal(false), error:z.object({ type:errorTypes, message:z.string() }) });
const successEnvelope = <T extends z.ZodTypeAny>(data:T) => z.object({ success:z.literal(true), data });
const modelSchema = z.object({ value:z.enum(["storyboard","motion_lite","motion_pro"]), name:z.string(), credits:z.number().int().nonnegative() });
const voiceSchema = z.object({ id:z.string().min(1), name:z.string().min(1), labels:z.record(z.string(),z.string()).optional(), isRecommended:z.boolean().optional(), targetLanguages:z.array(z.string()).optional() }).passthrough();

export class FacelessApiError extends Error {
  constructor(public type: z.infer<typeof errorTypes>, public status: number, public retryAfterSeconds?: number) {
    super(`Faceless-Anfrage fehlgeschlagen: ${type}`);
  }
}

function apiKey() {
  const value=process.env.FACELESS_API_KEY?.trim();
  if(!value) throw new Error("FACELESS_API_KEY fehlt in Vercel.");
  return value;
}

async function pause(ms:number){await new Promise(resolve=>setTimeout(resolve,ms));}

async function request<T>(path:string, schema:z.ZodType<T>, init:RequestInit={}, retries=0):Promise<T>{
  const idempotent=init.method === undefined || init.method === "GET" || !!new Headers(init.headers).get("Idempotency-Key");
  for(let attempt=0;;attempt++){
    let response:Response;
    try{
      response=await fetch(`${BASE_URL}${path}`,{...init,headers:{Authorization:`Bearer ${apiKey()}`,Accept:"application/json",...init.headers},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20_000)});
    }catch{
      if(idempotent && attempt<retries){await pause(250*(2**attempt));continue;}
      throw new FacelessApiError("internal_error",503);
    }
    let json:unknown;
    try{json=await response.json();}catch{json={success:false,error:{type:"internal_error",message:"invalid response"}};}
    if(response.ok){return successEnvelope(schema).parse(json).data;}
    const parsed=errorEnvelope.safeParse(json);
    const type=parsed.success?parsed.data.error.type:"internal_error";
    const retryAfter=Number(response.headers.get("retry-after") || "0") || undefined;
    if(idempotent && attempt<retries && (response.status===429 || response.status>=500)){
      await pause(Math.min((retryAfter || 1)*1000,3000));continue;
    }
    throw new FacelessApiError(type,response.status,retryAfter);
  }
}

export class FacelessService {
  async connection(){return request("/me",z.object({team:z.object({name:z.string(),credits:z.number().nonnegative()}),plan:z.string().nullable().optional(),auth:z.object({scopes:z.array(z.string())})}).passthrough(),{},1);}
  async credits(){return request("/credits",z.object({balance:z.number().nonnegative(),history:z.array(z.object({credits:z.number(),type:z.string(),description:z.string(),createdAt:z.string()})).default([])}),{},1);}
  async models(){const data=await request("/options?kind=models",z.object({kind:z.literal("models"),items:z.array(modelSchema)}),{},1);return data.items;}
  async voices(){return request("/voices",z.array(voiceSchema),{},1);}
  async createVideo(input:{script:string;voiceId:string;model:"storyboard"|"motion_lite"|"motion_pro";name?:string;style?:string;language?:string;idempotencyKey:string}){
    return request("/videos",z.object({id:z.string(),name:z.string().optional(),model:z.string(),status:z.string(),creditsUsed:z.number().int().nonnegative(),statusUrl:z.string().optional()}),{
      method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":input.idempotencyKey},
      body:JSON.stringify({script:input.script,voiceId:input.voiceId,model:input.model,...(input.name?{name:input.name}:{}),...(input.style?{style:input.style}:{}),...(input.language?{language:input.language}:{})})
    },1);
  }
  async videoStatus(id:string){return request(`/videos/${encodeURIComponent(id)}/status`,z.object({id:z.string(),status:z.enum(["pending","processing","completed","failed"]),percentCompleted:z.number().optional(),readyForEditing:z.boolean().optional(),errorMessages:z.array(z.string()).default([]),renderedVideoUrl:z.string().url().nullable().optional()}),{},2);}
  async render(id:string,idempotencyKey:string){return request(`/videos/${encodeURIComponent(id)}/render`,z.object({renderId:z.string(),statusUrl:z.string().optional()}),{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey},body:JSON.stringify({codec:"h264"})},1);}
  async renderStatus(id:string){return request(`/renders/${encodeURIComponent(id)}`,z.object({renderId:z.string(),status:z.enum(["in-progress","done","error"]),overallProgress:z.number().optional(),url:z.string().url().optional()}),{},2);}
}

export function chooseGermanVoice(voices:Awaited<ReturnType<FacelessService["voices"]>>){
  const selected=voices.find(v=>v.isRecommended && (v.targetLanguages?.some(l=>/^de/i.test(l)) || /^de|german/i.test(v.labels?.language || ""))) ||
    voices.find(v=>v.targetLanguages?.some(l=>/^de/i.test(l)) || /^de|german/i.test(v.labels?.language || ""));
  if(!selected) throw new Error("Faceless liefert keine deutsche Stimme. Bitte voiceId ausdrücklich auswählen.");
  return selected.id;
}

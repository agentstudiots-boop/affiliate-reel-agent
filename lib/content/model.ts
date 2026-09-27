import { z } from "zod";
import type { Generator } from "./agent";
import { editorialPolicy } from "./agent";
import { predictionText } from "../whatsapp/instruction";

const MODEL = "openai/gpt-4.1";
export const EDITORIAL_MODEL_ERROR = "Der KI-Entwurf konnte nicht sicher geprüft werden. Keine automatische Freigabe oder Veröffentlichung.";
export const EDITORIAL_RATE_LIMIT_ERROR = "Replicate hat die redaktionelle Anfrage wegen eines Zugriffslimits abgelehnt. Keine automatische Freigabe oder Veröffentlichung.";

async function waitForLimit(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Modellanfrage unterbrochen.");
  await new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(new Error("Modellanfrage unterbrochen.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

function throttleDelay(response: Response, detail: string) {
  const header = response.headers.get("retry-after");
  const seconds = header && /^\d{1,3}$/.test(header) ? Number(header)
    : Number(detail.match(/(?:resets? in ~?|available in\s+)(\d{1,3})\s*(?:seconds?|s\b)/i)?.[1] || 30);
  return Math.min(60_000, Math.max(2_000, (Number.isFinite(seconds) ? seconds : 30) * 1000 + 1000));
}

function failureCategory(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "invalid_json_or_schema";
  if (error instanceof Error && /^Modellantwort HTTP \d{3}$/.test(error.message)) return `http_${error.message.slice(-3)}`;
  if (error instanceof Error && /timeout|aborted|unterbrochen/i.test(error.name + " " + error.message)) return "timeout_or_abort";
  if (error instanceof Error && /Modellantwort fehlt|Modellstatus|Ungültige Modellantwort/.test(error.message)) return "invalid_provider_result";
  return "transport_or_provider_error";
}

// Only an explicit 429 rejection can be retried. An accepted or ambiguous POST
// is never repeated; GETs only observe the same prediction.
export function createGenerator(options: { mode: "reference" | "ai"; signal?: AbortSignal; request?: typeof fetch;
  wait?: typeof waitForLimit; minIntervalMs?: number }): Generator {
  let nextPredictionAt = 0;
  return async (agent, instruction, input, schema, reference) => {
    options.signal?.throwIfAborted();
    if (options.mode === "reference") return schema.parse(reference());
    const token=process.env.REPLICATE_API_TOKEN?.trim();
    if(!token)throw new Error("Der KI-Modus braucht einen konfigurierten Replicate-Zugang.");
    const prompt=JSON.stringify({agent,input});
    if(prompt.length>30000)throw new Error("Redaktioneller Kontext ist für eine sichere Modellanfrage zu groß.");
    const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(115000)]):AbortSignal.timeout(115000);
    const request=options.request||fetch;
    const wait=options.wait||waitForLimit;
    const headers={Authorization:`Bearer ${token}`};
    try {
      const scheduled = nextPredictionAt - Date.now();
      if(scheduled>0) await wait(scheduled,signal);
      const sendPrediction=()=>request(`https://api.replicate.com/v1/models/${MODEL}/predictions`,{
        method:"POST",headers:{...headers,"Content-Type":"application/json",Prefer:"wait=20","Cancel-After":"60s"},redirect:"error",signal,
        body:JSON.stringify({input:{temperature:0.2,max_completion_tokens:3500,
          system_prompt:`${editorialPolicy}\n\nAuftrag für ${agent}: ${instruction}\nAntworte nur mit einem vollständigen JSON-Objekt gemäß Schema (kein Markdown, keine Zusätze): ${JSON.stringify(z.toJSONSchema(schema))}`,
          prompt}}),
      });
      nextPredictionAt=Date.now()+(options.minIntervalMs??11_000);
      let response=await sendPrediction();
      if(response.status===429){
        const detail=await response.text();
        const delay=Math.max(throttleDelay(response,detail),nextPredictionAt-Date.now());
        console.info(JSON.stringify({event:"editorial_model_throttled",agent,waitSeconds:Math.ceil(delay/1000)}));
        await wait(delay,signal);
        nextPredictionAt=Date.now()+(options.minIntervalMs??11_000);
        response=await sendPrediction();
      }
      if(!response.ok)throw new Error(`Modellantwort HTTP ${response.status}`);
      let prediction=await response.json();
      const id=prediction?.id;
      if(typeof id!=="string"||!/^[a-z0-9]{12,64}$/.test(id))throw new Error("Ungültige Modellantwort.");
      for(let attempt=0;["starting","processing"].includes(prediction.status)&&attempt<14;attempt++){
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>{signal.removeEventListener("abort",aborted);resolve();},1500);
          const aborted=()=>{clearTimeout(timer);reject(new Error("Modellanfrage unterbrochen."));};
          signal.addEventListener("abort",aborted,{once:true});
          if(signal.aborted)aborted();
        });
        const poll=await request(`https://api.replicate.com/v1/predictions/${id}`,{headers,redirect:"error",signal});
        if(!poll.ok)throw new Error("Modellstatus unklar.");
        prediction=await poll.json();
        if(prediction?.id!==id)throw new Error("Modellstatus widersprüchlich.");
      }
      const output=predictionText(prediction?.output);
      if(prediction.status!=="succeeded"||!output||output.length>28000)throw new Error("Modellantwort fehlt oder ist unklar.");
      return schema.parse(JSON.parse(output));
    }catch(error){
      if(options.signal?.aborted)throw error;
      console.warn(JSON.stringify({event:"editorial_model_failed",agent,model:MODEL,reason:failureCategory(error)}));
      throw new Error(failureCategory(error)==="http_429"?EDITORIAL_RATE_LIMIT_ERROR:EDITORIAL_MODEL_ERROR);
    }
  };
}

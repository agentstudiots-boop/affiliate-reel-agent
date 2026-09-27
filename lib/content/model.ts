import { z } from "zod";
import type { Generator } from "./agent";
import { editorialPolicy } from "./agent";
import { predictionText } from "../whatsapp/instruction";

const MODEL = "openai/gpt-4.1";

// A single paid prediction per agent invocation. GET polling never retries a POST.
export function createGenerator(options: { mode: "reference" | "ai"; signal?: AbortSignal; request?: typeof fetch }): Generator {
  return async (agent, instruction, input, schema, reference) => {
    options.signal?.throwIfAborted();
    if (options.mode === "reference") return schema.parse(reference());
    const token=process.env.REPLICATE_API_TOKEN?.trim();
    if(!token)throw new Error("Der KI-Modus braucht einen konfigurierten Replicate-Zugang.");
    const prompt=JSON.stringify({agent,input});
    if(prompt.length>30000)throw new Error("Redaktioneller Kontext ist für eine sichere Modellanfrage zu groß.");
    const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(50000)]):AbortSignal.timeout(50000);
    const request=options.request||fetch;
    const headers={Authorization:`Bearer ${token}`};
    try {
      const response=await request(`https://api.replicate.com/v1/models/${MODEL}/predictions`,{
        method:"POST",headers:{...headers,"Content-Type":"application/json",Prefer:"wait=20","Cancel-After":"60s"},redirect:"error",signal,
        body:JSON.stringify({input:{temperature:0.2,max_completion_tokens:3500,
          system_prompt:`${editorialPolicy}\n\nAuftrag für ${agent}: ${instruction}\nAntworte nur mit einem vollständigen JSON-Objekt gemäß Schema (kein Markdown, keine Zusätze): ${JSON.stringify(z.toJSONSchema(schema))}`,
          prompt}}),
      });
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
      console.warn(JSON.stringify({event:"editorial_model_failed",agent,model:MODEL,reason:error instanceof z.ZodError?"schema":"provider_or_response"}));
      throw new Error("Der KI-Entwurf konnte nicht sicher geprüft werden. Keine automatische Freigabe oder Veröffentlichung.");
    }
  };
}

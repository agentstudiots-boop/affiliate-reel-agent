import {createHash} from "node:crypto";
import type {ContentJob} from "./schema";

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}

export function visualFingerprint(job:ContentJob) {
  const c=job.content;
  return createHash("sha256").update(JSON.stringify(canonical({product:job.opportunity.product,useCase:job.opportunity.useCase,
    visual:c?.format==="image"?{layout:c.layout,concept:c.visualConcept,slides:c.slides.map(s=>({visual:s.visual,prompt:s.prompt,alt:s.alt}))}:null}))).digest("hex");
}

export function visualContextError(job:ContentJob, scene?:string):string|null {
  if(job.content?.format!=="image")return "visual_context_mismatch";
  const text=scene ?? [job.opportunity.useCase,job.content.useCase,job.content.visualConcept?.mainIdea,
    job.content.visualConcept?.everydaySituation,...job.content.slides.flatMap(s=>[s.visual,s.prompt,s.alt])].join(" ");
  const name=job.opportunity.product.name.toLocaleLowerCase("de-DE");
  if (/kürbis.*schnitz|schnitz.*kürbis|pumpkin.*carv/.test(name)) {
    if (!/kürbis|kürbisse|pumpkin/i.test(text) || /pasta|pfanne|nudel|spaghetti|steak|sous.vide/i.test(text)) return "visual_context_mismatch";
  } else if (/kuscheldecke|wohndecke|fleecedecke/.test(name)) {
    if (!/decke|sofa|couch|bett|blanket/i.test(text) || /pasta|pfanne|schnitzwerkzeug|steak/i.test(text)) return "visual_context_mismatch";
  } else {
    const words=name.match(/[\p{L}]{5,}/gu)||[];
    if (!words.some(word=>text.toLocaleLowerCase("de-DE").includes(word)))return "visual_context_mismatch";
  }
  return null;
}

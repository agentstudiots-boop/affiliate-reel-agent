import {contentSchema,type ContentJob} from "./schema";
import type {Instruction} from "../whatsapp/instruction";
import {requireJobProduct} from "./product-contract";
import {visualContextError} from "./visual-context";

// Pure revision: no providers, publications, URLs or mutable product identity.
export function reviseStructured(job:ContentJob, instruction:Instruction):ContentJob {
  requireJobProduct(job);
  if(!["approved","awaiting_approval"].includes(job.status) || job.content?.format!=="image" || job.revisions>=2)throw Error("revision_not_available");
  if(!["revise_image","revise_text","revise_both"].includes(instruction.intent)||!instruction.keep_product||!instruction.keep_content_id||instruction.publish_requested)throw Error("instruction_not_safe");
  const next=structuredClone(job),content=next.content!;
  if(content.format!=="image")throw Error("image_plan_required");
  if(instruction.intent!=="revise_text"){
    const scene=instruction.image_instruction?.trim();
    if(!scene||!instruction.product_context_matches||visualContextError(job,scene))throw Error("visual_context_mismatch");
    // Replace all visual fields, not just the caption or the first slide. No old job context leaks.
    next.opportunity.useCase=scene;
    const selected=next.ideas?.find(i=>i.id===next.decision?.ideaId);
    if(selected){selected.useCase=scene;selected.situation=scene;selected.story=scene;}
    content.layout="single";
    content.visualConcept={...content.visualConcept!,kind:"application",mainIdea:scene,everydaySituation:scene,
      productRelation:`Anwendung von ${job.opportunity.product.name}, ASIN ${job.opportunity.product.asin}.`};
    content.useCase=scene;
    content.slides=[{headline:content.hook,copy:"Anwendung und Herstellerhinweise vor dem Kauf prüfen.",
      visual:scene,prompt:`Originelles redaktionelles Lifestyle-Foto im Hochformat 4:5: ${scene}. Keine Logos oder erfundenen Modellmerkmale.`,alt:scene}];
  }
  for(const operation of instruction.text_operations){
    if(operation==="shorten_hook")content.hook=content.hook.split(/[.!?]/)[0].split(/\s+/).slice(0,8).join(" ")+"?";
    if(operation==="shorten_caption"){
      content.caption=content.caption.split(/(?<=[.!?])\s+/).slice(0,2).join(" ")+" Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.";
    }
    if(operation==="naturalize"){
      const pumpkin=/kürbis.*schnitz|schnitz.*kürbis/i.test(job.opportunity.product.name);
      content.caption=`Werbung | ${pumpkin?"Welche Kürbislaterne soll dieses Jahr vor deiner Tür stehen? Erst das Motiv planen, dann das passende Schnitzwerkzeug auswählen.":`Passt ${job.opportunity.product.name} zu deinem Alltag? Schau dir die vorgesehene Anwendung und die Herstellerhinweise an.`} Details stehen auf der verlinkten Produktseite. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`;
    }
  }
  if(JSON.stringify(content)===JSON.stringify(job.content))throw Error("revision_unchanged");
  next.content=contentSchema.parse(content);next.status="awaiting_approval";next.revisions++;next.updatedAt=new Date().toISOString();
  next.review=undefined;delete next.error;requireJobProduct(next);
  if(visualContextError(next))throw Error("visual_context_mismatch");
  return next;
}

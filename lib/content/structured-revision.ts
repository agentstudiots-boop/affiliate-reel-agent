import {contentSchema,type ContentJob} from "./schema";
import type {Instruction} from "../whatsapp/instruction";
import {requireJobProduct} from "./product-contract";
import {visualContextError} from "./visual-context";
import {isPumpkinCarvingProduct} from "./category";
import {isBathtubMat} from "./bathtub-mat";
import {imageSpecFor,mentions,withChange} from "./image-quality/spec";

// How an operator's image wish relates to the existing briefing:
// - "modify": atmosphere, light, size, position or removing an object → the existing scene and main subject stay,
// - "replace": a completely different picture → new scene, but the main subject of the briefing stays,
// - "new_scene": a concrete new scene description → it replaces the scene; the main subject is added if missing.
// Every variant produces a new generation (no image editing is available; nothing pretends to edit the old image).
export function imageChangeKind(wish:string):"modify"|"replace"|"new_scene"{
  if(/komplett anderes|ganz anderes|völlig anderes|neues motiv|anderes motiv|passt nicht zum produkt|ganz neu/i.test(wish))return "replace";
  if(wish.split(/\s+/).length<=14&&/gemütlich|heller|dunkler|wärmer|kälter|freundlich|stimmung|atmosphär|licht|farb|größer|kleiner|vordergrund|hintergrund|näher|zentral|mittig|schärfer|natürlicher|realistischer|entfern|\bohne\b|\bkein|\bweg\b|\braus\b/i.test(wish))return "modify";
  return "new_scene";
}

// Pure revision: no providers, publications, URLs or mutable product identity.
export function reviseStructured(job:ContentJob, instruction:Instruction):ContentJob {
  requireJobProduct(job);
  if(!["approved","awaiting_approval"].includes(job.status) || job.content?.format!=="image")throw Error("revision_not_available");
  if(!["revise_image","revise_text","revise_both"].includes(instruction.intent)||!instruction.keep_product||!instruction.keep_content_id||instruction.publish_requested)throw Error("instruction_not_safe");
  const next=structuredClone(job),content=next.content!;
  if(content.format!=="image")throw Error("image_plan_required");
  let modified=false;
  if(instruction.intent!=="revise_text"){
    const wish=instruction.image_instruction?.trim();
    if(!wish||!instruction.product_context_matches)throw Error("visual_context_mismatch");
    // The structured briefing survives every revision: same main subject, the wish is recorded, removals become exclusions.
    const spec=imageSpecFor(job);
    const kind=imageChangeKind(wish);
    content.imageSpec=withChange(spec,wish);
    if(kind==="modify"&&!visualContextError(job)){
      const slide=content.slides[0];
      content.slides=[{...slide,prompt:`${slide.prompt} Änderungswunsch (Hauptmotiv „${spec.primary_object}“ bleibt): ${wish}`.slice(0,2400)}];
      content.layout="single";
      modified=true;
    }
  }
  if(instruction.intent!=="revise_text"&&!modified){
    const wish=instruction.image_instruction!.trim();
    const spec=content.imageSpec!;
    const scene=imageChangeKind(wish)==="new_scene"&&mentions(wish,spec.primary_object_terms)?wish:`${spec.primary_object} als Hauptmotiv im Vordergrund; ${wish}`;
    if(visualContextError(job,scene))throw Error("visual_context_mismatch");
    // The new scene is also the briefing's setting; the old scene must not leak into the prompt.
    content.imageSpec={...spec,setting:/draußen im Garten/.test(spec.setting)?spec.setting:scene.slice(0,200)};
    // Replace all visual fields, not just the caption or the first slide. No old job context leaks.
    next.opportunity.useCase=scene;
    const selected=next.ideas?.find(i=>i.id===next.decision?.ideaId);
    if(selected){selected.useCase=scene;selected.situation=scene;selected.story=scene;}
    content.layout="single";
    content.visualConcept={...content.visualConcept!,kind:"application",mainIdea:scene,everydaySituation:scene,
      productRelation:`Anwendung von ${job.opportunity.product.name}, ASIN ${job.opportunity.product.asin}.`};
    content.useCase=scene;
    if(isBathtubMat(job.opportunity.product.name))content.productIntegration="Die Badewannenmatte wird innerhalb der Badewanne gezeigt; Eignung und Herstellerhinweise bleiben zu prüfen.";
    content.slides=[{headline:content.hook,copy:"Anwendung und Herstellerhinweise vor dem Kauf prüfen.",
      visual:scene,prompt:`Originelles redaktionelles Lifestyle-Foto im Hochformat 4:5: ${scene}. Keine Logos oder erfundenen Modellmerkmale.`,alt:scene}];
  }
  for(const operation of instruction.text_operations){
    if(operation==="shorten_hook")content.hook=content.hook.split(/[.!?]/)[0].split(/\s+/).slice(0,8).join(" ")+"?";
    if(operation==="shorten_caption"){
      content.caption=content.caption.split(/(?<=[.!?])\s+/).slice(0,2).join(" ")+" Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.";
    }
    if(operation==="naturalize"){
      const pumpkin=isPumpkinCarvingProduct(job.opportunity.product.name);
      content.hook=instruction.proposed_hook?.trim() || (pumpkin
        ? "Welche Kürbislaterne soll dieses Jahr vor deiner Tür leuchten?"
        : `Passt ${job.opportunity.product.name} zu deinem Alltag?`);
      content.caption=instruction.proposed_caption?.trim() || `Werbung | ${content.hook} ${pumpkin
        ? "Erst ein Gesicht aufzeichnen, dann den Kürbis aushöhlen und Augen und Mund ausschneiden. Das Schneiden übernimmt eine erwachsene Person. Prüfe Lieferumfang und Hinweise zur Handhabung auf der Produktseite."
        : "Schau dir die vorgesehene Anwendung und die Herstellerhinweise an. Details stehen auf der verlinkten Produktseite."} Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`;
      if(instruction.intent!=="revise_text") {
        content.title=content.hook;
        if(content.slides[0])content.slides[0].headline=content.hook;
      }
    }
  }
  if(JSON.stringify(content)===JSON.stringify(job.content))throw Error("revision_unchanged");
  next.content=contentSchema.parse(content);next.status="awaiting_approval";next.revisions++;next.updatedAt=new Date().toISOString();
  next.review=undefined;delete next.error;requireJobProduct(next);
  if(visualContextError(next))throw Error("visual_context_mismatch");
  return next;
}

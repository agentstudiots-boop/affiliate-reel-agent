import { head, put } from "@vercel/blob";
import { getRunwayClient, RUNWAY_DURATION_SECONDS, RUNWAY_ESTIMATED_CREDITS, RUNWAY_MODEL, RUNWAY_RATIO } from "../runway";
import { buildVideoPrompt } from "../video-prompt";
import { FacelessApiError, FacelessService } from "../renderers/faceless";
import { facelessModel } from "../renderers/selection";
import { productionRepository } from "./repository";
import { operatorNumber, sendWhatsAppText, senderHash } from "../whatsapp/client";

async function archiveVideo(id:string,url:string){
  const pathname=`reels/${id}.mp4`;
  try{return {blob:await head(pathname),pathname};}catch{/* not archived */}
  const source=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(60_000)});
  if(!source.ok||!source.body)throw new Error("Provider-Video konnte nicht in den bestehenden Blob Store übernommen werden.");
  const blob=await put(pathname,source.body,{access:"public",addRandomSuffix:false,allowOverwrite:false,contentType:"video/mp4"});
  return {blob,pathname};
}

async function notifyCompleted(id:string){
  const recipient=operatorNumber();const approval=await productionRepository().ensureContentApproval(id,recipient?senderHash(recipient):"");
  const content=(approval?.content || {}) as Record<string,unknown>;
  if(recipient)await sendWhatsAppText(recipient,`CONTENT – FREIGABE VOR VERÖFFENTLICHUNG\n\nProdukt:\n${String(content.product || "Unbekannt")}\n\nRenderer:\n${String(content.renderer || "Unbekannt")}\n\nTatsächliche Produktionskosten:\n${content.actualCostCents==null?`${String(content.actualCredits ?? "unbekannte")} Provider-Credits; Eurobetrag nicht automatisch verfügbar`:`${(Number(content.actualCostCents)/100).toFixed(2).replace(".",",")} €`}\n\nVorschau:\n${String(content.videoUrl || "Nicht verfügbar")}\n\nCaption:\n${String(content.caption || "Nicht vorhanden")}\n\nCTA:\n${String(content.cta || "Nicht vorhanden")}\n\nAffiliate-Hinweis:\n${String(content.disclosure || "Vor Veröffentlichung ergänzen")}\n\nBitte antworte in normalem Deutsch, z. B. „Freigeben“, „Caption kürzer“ oder „Nicht veröffentlichen“.`);
}

export async function startApprovedProduction(id:string){
  const repo=productionRepository();const row=await repo.claimStart(id);if(!row)return repo.get(id);
  try{
    if(row.provider==="faceless"){
      if(!row.voice_id)throw new Error("Keine Faceless-Stimme gespeichert.");
      const result=await new FacelessService().createVideo({script:row.script,voiceId:row.voice_id,model:facelessModel(row.renderer_mode as never),idempotencyKey:row.idempotency_key,name:`Affiliate Reel ${row.id}`});
      await repo.update(row.id,{status:"submitted",external_job_id:result.id,actual_credits:result.creditsUsed,error_code:null,error_message:null});
    }else{
      const task=await getRunwayClient().textToVideo.create({model:RUNWAY_MODEL,promptText:buildVideoPrompt("Affiliate-Produkt",row.script.slice(0,850)),ratio:RUNWAY_RATIO,duration:RUNWAY_DURATION_SECONDS});
      await repo.update(row.id,{status:"submitted",external_job_id:task.id,actual_credits:task.estimatedCost.credits,error_code:null,error_message:null});
    }
  }catch(error){
    const knownNoCharge=error instanceof FacelessApiError && [400,401,402,403,404,409].includes(error.status);
    await repo.update(row.id,{status:knownNoCharge?"failed":"start_unknown",error_code:error instanceof FacelessApiError?error.type:"START_UNCONFIRMED",error_message:knownNoCharge?"Provider hat den Start abgelehnt.":"Startantwort unklar; kein neuer Auftrag ohne sicheren Abgleich."});
  }
  return repo.get(id);
}

export async function pollProduction(id:string){
  const repo=productionRepository();const row=await repo.get(id);if(!row)throw new Error("Produktionsanfrage nicht gefunden.");
  if(["completed","failed","rejected","start_unknown","awaiting_cost_approval","approved"].includes(row.status))return row;
  if(!row.external_job_id)return row;
  if(row.provider==="faceless"){
    const client=new FacelessService();
    if(!row.external_render_id){
      const status=await client.videoStatus(row.external_job_id);
      if(status.status==="failed"){await repo.update(id,{status:"failed",error_code:"FACELESS_GENERATION_FAILED",error_message:status.errorMessages.join(" ").slice(0,1000)});return repo.get(id);}
      if(status.status!=="completed"){await repo.update(id,{status:"generating"});return repo.get(id);}
      const render=await client.render(row.external_job_id,`${row.idempotency_key}-render`);
      await repo.update(id,{status:"rendering",external_render_id:render.renderId});return repo.get(id);
    }
    const render=await client.renderStatus(row.external_render_id);
    if(render.status==="error"){await repo.update(id,{status:"failed",error_code:"FACELESS_RENDER_FAILED",error_message:"Faceless MP4-Rendering fehlgeschlagen."});return repo.get(id);}
    if(render.status!=="done"||!render.url)return row;
    await repo.update(id,{status:"transferring",provider_asset_url:render.url});
    const stored=await archiveVideo(id,render.url);
    await repo.update(id,{status:"completed",blob_url:stored.blob.url,blob_path:stored.pathname,completed_at:new Date().toISOString()});
    await notifyCompleted(id);
    return repo.get(id);
  }
  const task=await getRunwayClient().tasks.retrieve(row.external_job_id);
  if(task.status==="FAILED"||task.status==="CANCELLED"){await repo.update(id,{status:"failed",error_code:`RUNWAY_${task.status}`,error_message:"Runway konnte den Clip nicht erzeugen; kein automatischer Neuversuch."});return repo.get(id);}
  if(task.status!=="SUCCEEDED"){await repo.update(id,{status:"generating"});return repo.get(id);}
  const stored=await archiveVideo(id,task.output[0]);
  await repo.update(id,{status:"completed",provider_asset_url:task.output[0],blob_url:stored.blob.url,blob_path:stored.pathname,actual_credits:task.cost.credits,completed_at:new Date().toISOString()});
  await notifyCompleted(id);
  return repo.get(id);
}

export async function completeProduction(id:string,maxWaitMs=240_000){const deadline=Date.now()+maxWaitMs;while(Date.now()<deadline){try{const row=await pollProduction(id);if(!row||["completed","failed","rejected","start_unknown"].includes(row.status))return row;}catch{/* transient read/provider failure: bounded retry below */}await new Promise(resolve=>setTimeout(resolve,10_000));}return productionRepository().get(id);}

export { RUNWAY_ESTIMATED_CREDITS };

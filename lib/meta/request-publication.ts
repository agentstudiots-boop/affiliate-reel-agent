import {getDatabase} from "../memory/db";
import {parseJob} from "../content/history";
import {getOriginalVisualProvider,imageProviderStatus,type OriginalVisualProvider} from "../content/image-provider";
import {produceCheckedVisual,resumeUnclearVisual,stopNoticeText,uncheckedVisual,type VisualOutcome,type VisualProductionDeps} from "../content/image-quality/production";
import {facebookPagePublicationError} from "./publication-eligibility";
import {publicationRepository,PublicationConflictError} from "./publication-gate";
import {sendWhatsAppText,whatsappApprovalReady,WhatsAppRejectedError} from "../whatsapp/client";

// A stopped image job whose operator notice was already delivered: callers must not send a second message.
export class ImageQualityStop extends PublicationConflictError {
  readonly notified = true;
}
export const alreadyNotified = (error: unknown) => error instanceof ImageQualityStop;

// mode: "new" (default) claims the image of the current version; the other modes continue a stopped image job after the
// operator's explicit reply to its notice: "continue" (one more granted attempt), "resume" (look up an unclear provider
// job, no new generation), "send_unchecked" (uncertain check, the operator reviews the image himself).
export type VisualRequestMode = "new" | "continue" | "resume" | "send_unchecked";
export type RequestDeps = { provider?: OriginalVisualProvider | null; gate?: VisualProductionDeps["gate"]; sleep?: VisualProductionDeps["sleep"]; send?: typeof sendWhatsAppText };

export async function requestFacebookApproval(jobId:string, mode:VisualRequestMode="new", deps:RequestDeps={}){
  if(!whatsappApprovalReady())throw new PublicationConflictError("WhatsApp-Freigabe ist noch nicht vollständig konfiguriert.");
  const db=getDatabase();
  const send=deps.send??sendWhatsAppText;
  const stored=await db.query("SELECT snapshot FROM content_jobs WHERE id=$1",[jobId]);
  if(!stored.rows[0])throw new PublicationConflictError("Content-Job fehlt.");
  const job=parseJob(stored.rows[0].snapshot);
  const eligibilityError=facebookPagePublicationError(job);
  if(eligibilityError)throw new PublicationConflictError(eligibilityError);
  if(job.content?.format!=="image")throw new PublicationConflictError("Ein eigenständiger Bildentwurf ist für das Original-Visual erforderlich.");

  const provider=deps.provider===undefined?getOriginalVisualProvider():deps.provider;
  if(!provider){
    throw new PublicationConflictError(`Kein veröffentlichungsfähiges Original-Visual verfügbar. ${imageProviderStatus().reason} Es wurde keine Publication Request angelegt und keine WhatsApp-Veröffentlichungsfreigabe versendet.`);
  }

  const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
  const repo=publicationRepository();
  const model=imageProviderStatus().model;
  let publication;
  let outcome:VisualOutcome|{status:"pending"|"none"}|null=null;
  if(mode==="new"){
    const claim=await repo.claimVisual(jobId,model,provider.name);
    publication=claim.existing;
    if(!publication)outcome=await produce(()=>produceCheckedVisual(claim.job,repo.contentHashOf(claim.job),{db,provider,model,gate:deps.gate,sleep:deps.sleep}),repo,jobId);
  } else {
    const {job:current,contentHash}=await repo.continueVisual(jobId);
    const production={db,provider,model,gate:deps.gate,sleep:deps.sleep};
    outcome=await produce(()=>mode==="resume"?resumeUnclearVisual(current,contentHash,production)
      :mode==="send_unchecked"?uncheckedVisual(current,contentHash,production):produceCheckedVisual(current,contentHash,production),repo,jobId);
  }
  if(outcome?.status==="pending")throw new PublicationConflictError("Der Bildauftrag läuft beim Provider noch. Frag später erneut mit „Bildstatus prüfen“; es wurde kein neues Bild bestellt.");
  if(outcome?.status==="none")throw new PublicationConflictError("Für diese Fassung gibt es keinen unklaren Bildauftrag.");
  if(outcome?.status==="stopped"){
    console.warn(JSON.stringify({event:"image_job_stopped",jobId,reason:outcome.reason,attempt:outcome.attemptNo,used:outcome.used,allowed:outcome.allowed}));
    const text=stopNoticeText(job.opportunity.product.name,outcome);
    let messageId:string|null=null;
    try { messageId=await send(text); } catch { console.error(JSON.stringify({event:"image_stop_notice_unsent",jobId})); }
    if(messageId){
      await db.query("INSERT INTO image_quality_notices(message_id,job_id,reason,attempt_no) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[messageId,jobId,outcome.reason,outcome.attemptNo]);
      throw new ImageQualityStop(text);
    }
    throw new PublicationConflictError(text);
  }
  const quality=outcome?.status==="passed"?outcome:null;
  if(quality)publication=await repo.prepareWithVisual(jobId,approver,quality.asset);
  if(!publication)throw new PublicationConflictError("Verifiziertes Originalbild fehlt.");
  if(publication.status!=="pending"||publication.whatsappMessageId)return {publication};
  const recent=await db.query("SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1",[approver]);
  if(!recent.rows.length)return {publication,whatsapp:"approved_template_required" as const};
  await repo.claimWhatsAppSend(publication.id);
  // The automatic check never replaces this approval; it only states what was (not) checked.
  const check=!quality?"":quality.manualOverride?"\nBildprüfung: NICHT automatisch bestätigt (auf deinen Wunsch gesendet). Prüfe Motiv und Produkt im Bild selbst genau.\n"
    :quality.checked?`\nAutomatische Bildprüfung: bestanden (Hauptmotiv, Ausschlüsse, Produktart, Bildfehler). Sie ersetzt deine Prüfung nicht.${quality.quality?.identity==="not_verifiable"?"\nProduktidentität: nicht automatisch prüfbar – das KI-Bild zeigt die Produktart, nicht das Originalprodukt.":""}\n`
    :"\nAutomatische Bildprüfung ist nicht aktiv. Prüfe Motiv und Produkt im Bild selbst genau.\n";
  try {
    const messageId=await send(`Veröffentlichungsfreigabe für Facebook und Instagram (gemeinsam)
Produkt/Beitrag: ${publication.caption.slice(0,125)}
Bild: ${publication.imageUrl}
${check}
Beitrag:
${publication.caption.slice(0,1850)}

Der Beitrag geht als Bildpost auf Facebook und Instagram; auf Instagram ist der Link im Text nicht klickbar. Keine Story. Antworte auf DIESE Nachricht mit „Freigeben“ für genau einen Post oder „Ablehnen“. Änderungen bitte als Text. Ein bloßes „ja“ reicht nicht.`);
    publication=await repo.bindMessage(publication.id,messageId);
    return {publication,approvalSent:true};
  } catch (error) {
    if (error instanceof WhatsAppRejectedError) {
      await repo.releaseRejectedWhatsAppSend(publication.id);
      console.info(JSON.stringify({event:"whatsapp_publication_rejected",publicationId:publication.id,code:error.code,subcode:error.subcode,httpStatus:error.httpStatus,providerMessage:error.providerMessage}));
      throw new PublicationConflictError("Meta hat die WhatsApp eindeutig abgelehnt. Token/Berechtigung prüfen; danach kann derselbe Entwurf sicher erneut angefragt werden.");
    }
    throw error;
  }
}

// A definite provider refusal (nothing created or charged) releases the claim, as before; anything else stays claimed.
async function produce<T>(run:()=>Promise<T>,repo:ReturnType<typeof publicationRepository>,jobId:string):Promise<T>{
  try { return await run(); }
  catch(error){
    if(error instanceof PublicationConflictError)throw error;
    const definite=typeof error==="object"&&error!==null&&"definite" in error&&error.definite===true;
    console.error(JSON.stringify({event:"original_visual_failed",jobId,definite,category:typeof error==="object"&&error!==null&&"category" in error?String(error.category):"unknown"}));
    if(definite){
      await repo.releaseVisualAttempt(jobId);
      throw new PublicationConflictError(`${error instanceof Error?error.message:"Bildanfrage abgelehnt."} Antworte mit „Weiter“, sobald das behoben ist; dann starte ich die Bildgenerierung erneut.`);
    }
    throw new PublicationConflictError(error instanceof Error?error.message:"Bildversuch fehlgeschlagen oder Ergebnis unklar. Kein automatischer zweiter Versuch.");
  }
}

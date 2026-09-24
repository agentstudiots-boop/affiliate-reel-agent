import {getDatabase} from "../memory/db";
import {parseJob} from "../content/history";
import {getOriginalVisualProvider,imageProviderStatus} from "../content/image-provider";
import {facebookPagePublicationError} from "./publication-eligibility";
import {publicationRepository,PublicationConflictError} from "./publication-gate";
import {sendWhatsAppText,whatsappApprovalReady,WhatsAppRejectedError} from "../whatsapp/client";

export async function requestFacebookApproval(jobId:string){
  if(!whatsappApprovalReady())throw new PublicationConflictError("WhatsApp-Freigabe ist noch nicht vollständig konfiguriert.");
  const stored=await getDatabase().query("SELECT snapshot FROM content_jobs WHERE id=$1",[jobId]);
  if(!stored.rows[0])throw new PublicationConflictError("Content-Job fehlt.");
  const job=parseJob(stored.rows[0].snapshot);
  const eligibilityError=facebookPagePublicationError(job);
  if(eligibilityError)throw new PublicationConflictError(eligibilityError);
  if(job.content?.format!=="image")throw new PublicationConflictError("Ein eigenständiger Bildentwurf ist für das Original-Visual erforderlich.");

  const provider=getOriginalVisualProvider();
  if(!provider){
    throw new PublicationConflictError(`Kein veröffentlichungsfähiges Original-Visual verfügbar. ${imageProviderStatus().reason} Es wurde keine Publication Request angelegt und keine WhatsApp-Veröffentlichungsfreigabe versendet.`);
  }

  const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
  const repo=publicationRepository();
  const claim=await repo.claimVisual(jobId,imageProviderStatus().model);
  let publication=claim.existing;
  if(!publication){
    const asset=await provider.render(claim.job);
    publication=await repo.prepareWithVisual(jobId,approver,asset);
  }
  if(publication.status!=="pending"||publication.whatsappMessageId)return {publication};
  const recent=await getDatabase().query("SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1",[approver]);
  if(!recent.rows.length)return {publication,whatsapp:"approved_template_required" as const};
  await repo.claimWhatsAppSend(publication.id);
  try {
    const messageId=await sendWhatsAppText(`Veröffentlichungsfreigabe für Facebook
Produkt/Beitrag: ${publication.caption.slice(0,125)}
Bild: ${publication.imageUrl}

Beitrag:
${publication.caption.slice(0,1850)}

Antworte auf DIESE Nachricht mit „Freigeben“ für genau einen Post oder „Ablehnen“. Änderungen bitte als Text. Ein bloßes „ja“ reicht nicht.`);
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

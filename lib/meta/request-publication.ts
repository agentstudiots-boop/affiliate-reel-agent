import {getDatabase} from "../memory/db";
import {createSocialCard} from "./card";
import {publicationRepository,PublicationConflictError} from "./publication-gate";
import {sendWhatsAppText,whatsappApprovalReady} from "../whatsapp/client";

export async function requestFacebookApproval(jobId:string){
  if(!whatsappApprovalReady())throw new PublicationConflictError("WhatsApp-Freigabe ist noch nicht vollständig konfiguriert.");
  const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
  const repo=publicationRepository();
  let publication=await repo.prepare(jobId,approver);
  if(publication.status==="preparing"){
    await repo.claimImage(publication.id);
    const image=await createSocialCard(jobId);
    publication=await repo.bindImage(publication.id,image);
  }
  if(publication.status!=="pending"||publication.whatsappMessageId)return {publication};
  const recent=await getDatabase().query("SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1",[approver]);
  if(!recent.rows.length)return {publication,whatsapp:"approved_template_required" as const};
  await repo.claimWhatsAppSend(publication.id);
  const messageId=await sendWhatsAppText(`Veröffentlichungsfreigabe für Facebook\nProdukt/Beitrag: ${publication.caption.slice(0,125)}\nBild: ${publication.imageUrl}\n\nBeitrag:\n${publication.caption.slice(0,1850)}\n\nAntworte auf DIESE Nachricht mit „Freigeben“ für genau einen Post oder „Ablehnen“. Änderungen bitte als Text. Ein bloßes „ja“ reicht nicht.`);
  publication=await repo.bindMessage(publication.id,messageId);
  return {publication,approvalSent:true};
}

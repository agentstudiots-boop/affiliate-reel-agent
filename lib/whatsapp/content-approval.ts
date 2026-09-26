import { createHash } from "node:crypto";
import { getDatabase, type Sql } from "../memory/db";
import { parseJob } from "../content/history";
import { requireJobProduct } from "../content/product-contract";
import { reviseApprovedVideo, reviseApprovedStaticContent, reviseOperatorInstruction, inspectContent } from "../content/orchestrator";
import { interpretInstruction, validateInstruction } from "./instruction";
import { classifyWhatsAppReply } from "./intent";
import { sendWhatsAppText, WhatsAppRejectedError } from "./client";
import type { ContentJob } from "../content/schema";

export function contentFingerprint(job: ContentJob) {
  return createHash("sha256").update(JSON.stringify({product:job.opportunity.product,content:job.content,marketing:job.marketing})).digest("hex");
}

export function contentApprovalMessage(job: ContentJob) {
  if (!job.content) throw Error("Content-Entwurf fehlt.");
  const content=job.content;
  const detail=content.format==="video"
    ? `Drehbuch (${content.durationSeconds} Sekunden):\n${content.scenes.map((scene,index)=>`${index+1}. ${scene.durationSeconds}s: Bild: ${scene.visual}; Ton: ${scene.audio}; Einblendung: ${scene.overlay}`).join("\n")}`
    : content.format==="image"
      ? `Bildbriefing:\n${content.slides.map((slide,index)=>`${index+1}. ${slide.visual}; Prompt: ${slide.prompt}; Text: ${slide.copy}`).join("\n")}`
      : `Beitrag:\n${content.body}`;
  const next=content.format==="video"
    ? "Erst danach kann eine separate WhatsApp-Kostenfreigabe für den ausgewählten Videoproduzenten folgen. Die Veröffentlichung benötigt später eine weitere Freigabe."
    : content.format==="image"
      ? "Erst danach kann die Bildproduktion gesondert im Content Studio angefordert werden. Die Veröffentlichung benötigt später eine weitere WhatsApp-Freigabe."
      : "Die spätere Veröffentlichung benötigt eine eigene WhatsApp-Freigabe.";
  const message=`Inhaltsfreigabe · ${content.format} · ${job.opportunity.targetPlatform}\nProdukt: ${job.opportunity.product.name}\nASIN: ${job.opportunity.product.asin}\nTitel: ${content.title}\n${detail}\n${content.format==="text"?"":`Begleittext: ${content.caption}\n`}CTA: ${content.cta}\n${content.disclosure}\n\nAntworte auf DIESE Nachricht mit „Freigabe“, um genau diese Fassung zu genehmigen. Du kannst beliebig oft Änderungen als Text anfordern; jede neue Fassung kommt erneut zur Inhaltsfreigabe. „Ablehnen“ stoppt den Auftrag. ${next}`;
  if (message.length>3900) throw Error("Der vollständige Entwurf ist für eine WhatsApp-Nachricht zu lang. Im Content Studio kürzen, bevor eine Freigabe angefragt wird.");
  return message;
}

export async function requestContentApproval(jobId:string) {
  const db=getDatabase();
  const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
  if (!approver) throw Error("WhatsApp-Freigabe nicht eingerichtet.");
  const row=await db.query("SELECT snapshot FROM content_jobs WHERE id=$1",[jobId]);
  if (!row.rows[0]) throw Error("Auftrag nicht gefunden.");
  const job=parseJob(row.rows[0].snapshot);
  requireJobProduct(job);
  if (job.status!=="awaiting_approval") throw Error("Nur ein fertiger Entwurf darf zur Freigabe gesendet werden.");
  const window=await db.query("SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1",[approver]);
  if(!window.rows.length)throw Error("WhatsApp-Servicefenster geschlossen. Bitte zunächst eine Nachricht an die verknüpfte Nummer senden und dann erneut anfragen.");
  const message=contentApprovalMessage(job);
  const hash=contentFingerprint(job);
  const claim=await db.transaction(async sql=>{
    const locked=await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE",[jobId]);
    const latest=parseJob(locked.rows[0].snapshot);
    if(latest.status!=="awaiting_approval"||contentFingerprint(latest)!==hash) throw Error("Entwurf inzwischen verändert; neu laden.");
    const pending=await sql.query("SELECT id FROM content_approval_requests WHERE job_id=$1 AND status='pending' FOR UPDATE",[jobId]);
    if(pending.rows.length) throw Error("Eine Inhaltsfreigabe ist bereits offen.");
    const id=crypto.randomUUID();
    await sql.query("INSERT INTO content_approval_requests(id,job_id,content_hash,status,approver_wa_id,whatsapp_send_attempted_at) VALUES($1,$2,$3,'pending',$4,now())",[id,jobId,hash,approver]);
    return id;
  });
  // The send is claimed durably before the network call; an uncertain send is never repeated.
  let messageId:string;
  try { messageId=await sendWhatsAppText(message); }
  catch(error) {
    if(error instanceof WhatsAppRejectedError) await db.query("UPDATE content_approval_requests SET status='rejected',feedback='provider_rejected',decided_at=now() WHERE id=$1 AND whatsapp_message_id IS NULL",[claim]);
    throw error;
  }
  await db.query("UPDATE content_approval_requests SET whatsapp_message_id=$2 WHERE id=$1 AND status='pending' AND whatsapp_message_id IS NULL",[claim,messageId]);
  return {id:claim,messageId};
}

type Incoming={id:string;from:string;body:string;replyToMessageId:string|null;payload:unknown};
export async function handleContentApproval(input:Incoming) {
  const db=getDatabase();
  const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
  if(!approver||input.from.replace(/\D/g,"")!==approver)return false;
  let match=input.replyToMessageId
    ? await db.query("SELECT * FROM content_approval_requests WHERE whatsapp_message_id=$1 AND status IN ('pending','changes_requested') AND approver_wa_id=$2",[input.replyToMessageId,approver])
    : await db.query("SELECT * FROM content_approval_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL AND approver_wa_id=$1 ORDER BY created_at DESC LIMIT 2",[approver]);
  // A clarification reply may quote our explanatory message rather than the
  // original approval. Resume only when exactly one unresolved content change
  // exists and no other approval can plausibly own the incoming message.
  if(!match.rows.length){
    if(/^(entwurf|wochenbilanz)[.!?]*$/i.test(input.body.trim()))return false;
    const quoted=input.replyToMessageId
      ? await db.query("SELECT 1 FROM approval_requests WHERE whatsapp_message_id=$1 UNION ALL SELECT 1 FROM publication_requests WHERE whatsapp_message_id=$1 UNION ALL SELECT 1 FROM daily_drafts WHERE whatsapp_message_id=$1 LIMIT 1",[input.replyToMessageId])
      : {rows:[]};
    if(!quoted.rows.length){
      const other=await db.query("SELECT 1 FROM content_approval_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL UNION ALL SELECT 1 FROM approval_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL UNION ALL SELECT 1 FROM publication_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL UNION ALL SELECT 1 FROM daily_drafts WHERE status='awaiting_approval' AND whatsapp_message_id IS NOT NULL LIMIT 1");
      if(!other.rows.length){
        match=await db.query("SELECT * FROM content_approval_requests WHERE status='changes_requested' AND whatsapp_message_id IS NOT NULL AND approver_wa_id=$1 ORDER BY created_at DESC LIMIT 2",[approver]);
      }
    }
  }
  if(match.rows.length!==1) return false;
  if(!input.replyToMessageId){
    const other=await db.query("SELECT 1 FROM approval_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL UNION ALL SELECT 1 FROM publication_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL UNION ALL SELECT 1 FROM daily_drafts WHERE status='awaiting_approval' AND whatsapp_message_id IS NOT NULL LIMIT 1");
    if(other.rows.length)return false;
  }
  const request=match.rows[0];
  const decision=classifyWhatsAppReply(input.body);
  if(request.status==='changes_requested') {
    const latest=await db.query("SELECT 1 FROM content_approval_requests WHERE job_id=$1 AND status='pending' LIMIT 1",[request.job_id]);
    const stored=await db.query("SELECT snapshot FROM content_jobs WHERE id=$1",[request.job_id]);
    if(latest.rows.length || !stored.rows[0] || contentFingerprint(parseJob(stored.rows[0].snapshot))!==request.content_hash) {
      const once=await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",[input.id,input.from,input.replyToMessageId,input.body,JSON.stringify(input.payload)]);
      if(once.rows.length)await sendWhatsAppText("Diese Inhaltsfreigabe ist überholt. Bitte antworte auf die neueste Freigabenachricht. Es wurde nichts produziert oder veröffentlicht.");
      return true;
    }
  }
  if(request.status==='changes_requested' && decision.intent!=='changes_requested') {
    const once=await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",[input.id,input.from,input.replyToMessageId,input.body,JSON.stringify(input.payload)]);
    if(once.rows.length)await sendWhatsAppText("Diese alte Inhaltsfreigabe ist nach deinem Änderungswunsch gesperrt. Bitte antworte mit einem konkreten Änderungswunsch oder auf die neue Freigabenachricht. Keine Produktion gestartet.");
    return true;
  }
  if(decision.intent==="changes_requested") {
    const claimed=await db.transaction(async sql=>{
      const inserted=await sql.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload,intent) VALUES($1,$2,$3,$4,$5,'changes_requested') ON CONFLICT DO NOTHING RETURNING message_id",[input.id,input.from,input.replyToMessageId,input.body,JSON.stringify(input.payload)]);
      if(!inserted.rows.length)return false;
      const held=await sql.query("UPDATE content_approval_requests SET status='changes_requested',feedback=$2,decided_at=now() WHERE id=$1 AND status IN ('pending','changes_requested') RETURNING id",[request.id,input.body]);
      if(!held.rows.length)throw Error("Alte Inhaltsfreigabe bereits entschieden.");
      return true;
    });
    if(!claimed)return true;
    const stored=await db.query("SELECT snapshot FROM content_jobs WHERE id=$1",[request.job_id]);
    if(!stored.rows[0])throw Error("Entwurf fehlt.");
    const original=parseJob(stored.rows[0].snapshot);
    if(original.status!=="awaiting_approval"||contentFingerprint(original)!==request.content_hash)throw Error("Inhaltsfreigabe überholt.");
    // The orchestrator dispatches to the specialist; the producer is still locked.
    const working={...original,status:"approved" as const};
    let revised:ContentJob;
    try {
      if(working.content?.format==="video") revised=await reviseApprovedVideo(working,input.body);
      else {
        try { revised=await reviseApprovedStaticContent(working,input.body); }
        catch(error) {
          if(working.content?.format!=="image")throw error;
          const instruction=validateInstruction(await interpretInstruction(input.body,working),input.body);
          revised=reviseOperatorInstruction(working,instruction);
          const review=inspectContent(revised.content!,revised.decision!);
          if(!review.passed)throw Error(`Redaktionelle Prüfung: ${review.issues.join(" ")}`);
          revised.review=review;
          revised.events.push({sequence:revised.events.length+1,at:revised.updatedAt,agent:"orchestrator",kind:"decision",message:`WhatsApp-Wunsch strukturiert ins Bildbriefing übernommen: ${input.body.slice(0,500)}`});
          revised.events.push({sequence:revised.events.length+1,at:revised.updatedAt,agent:"orchestrator",kind:"response",message:"Validiertes Bildbriefing zur erneuten Inhaltsfreigabe vorgelegt.",data:revised.content});
        }
      }
    } catch(error) {
      await sendWhatsAppText(`Änderungswunsch für ${original.opportunity.product.name} verstanden, aber noch nicht übernommen: ${error instanceof Error?error.message:"Überarbeitung fehlgeschlagen."} Bitte antworte mit deiner Präzisierung; der Auftrag bleibt gesperrt. Keine Produktion gestartet.`);
      return true;
    }
    const applied=await db.transaction(async sql=>{
      const pending=await sql.query("SELECT * FROM content_approval_requests WHERE id=$1 AND status='changes_requested' FOR UPDATE",[request.id]);
      const current=await sql.query("SELECT snapshot,event_sequence FROM content_jobs WHERE id=$1 FOR UPDATE",[request.job_id]);
      if(!pending.rows.length||!current.rows.length||contentFingerprint(parseJob(current.rows[0].snapshot))!==request.content_hash)throw Error("Entwurf inzwischen verändert.");
      await sql.query("UPDATE content_jobs SET status='awaiting_approval',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",[original.id,JSON.stringify(revised),revised.events.length,revised.updatedAt]);
      for(const event of revised.events.filter(event=>event.sequence>Number(current.rows[0].event_sequence)))await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[original.id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
      return true;
    });
    if(applied) {
      try { await requestContentApproval(original.id); }
      catch(error) { await sendWhatsAppText(`Der überarbeitete Entwurf ist gespeichert. Die erneute WhatsApp-Inhaltsfreigabe konnte nicht zugestellt werden: ${error instanceof Error?error.message:"Versand unklar."} Bitte im Content Studio prüfen. Keine Medienproduktion.`); }
    }
    return true;
  }
  const applied=await db.transaction(async sql=>{
    const dedup=await sql.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",[input.id,input.from,input.replyToMessageId,input.body,JSON.stringify(input.payload)]);
    if(!dedup.rows.length)return false;
    const pending=await sql.query("SELECT * FROM content_approval_requests WHERE id=$1 AND status='pending' FOR UPDATE",[request.id]);
    const stored=await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE",[request.job_id]);
    if(!pending.rows.length||!stored.rows.length)throw Error("Freigabe nicht mehr offen.");
    const job=parseJob(stored.rows[0].snapshot);
    if(job.status!=="awaiting_approval"||contentFingerprint(job)!==request.content_hash)throw Error("Entwurf inzwischen verändert.");
    if(decision.intent==="approve")requireJobProduct(job);
    await sql.query("UPDATE content_approval_requests SET status=$2,feedback=$3,decided_at=now() WHERE id=$1",[request.id,decision.intent==="approve"?"approved":"rejected",decision.feedback]);
    if(decision.intent==="approve"){
      job.status="approved";job.updatedAt=new Date().toISOString();
      const event={sequence:job.events.length+1,at:job.updatedAt,agent:"orchestrator" as const,kind:"decision" as const,message:"Vollständiger Inhalt via WhatsApp genehmigt; Medienproduktion benötigt eigene Freigabe."};
      job.events.push(event);
      await sql.query("UPDATE content_jobs SET status='approved',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",[job.id,JSON.stringify(job),event.sequence,job.updatedAt]);
      await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[job.id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
    }
    await sql.query("UPDATE whatsapp_events SET intent=$2 WHERE message_id=$1",[input.id,decision.intent]);
    return true;
  });
  if(applied) await sendWhatsAppText(decision.intent==="approve"?"Inhalt freigegeben. Der Produzent wartet auf die gesonderte Produktionsfreigabe im Content Studio. Noch nichts produziert oder veröffentlicht.":"Entwurf abgelehnt. Es wurde nichts produziert oder veröffentlicht.");
  return true;
}

// Resume a safely recorded WhatsApp correction if the optional language provider
// failed after the original approval was locked. No producer can start here.
export async function resumeFailedVideoCorrection(jobId:string) {
  const db=getDatabase();
  const rows=await db.query("SELECT id,job_id,content_hash,feedback FROM content_approval_requests WHERE job_id=$1 AND status='changes_requested' AND whatsapp_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",[jobId]);
  if(!rows.rows[0])throw Error("Kein gespeicherter WhatsApp-Änderungswunsch für diesen Auftrag.");
  const request=rows.rows[0];
  const feedback=String(request.feedback || "");
  const stored=await db.query("SELECT snapshot FROM content_jobs WHERE id=$1",[jobId]);
  if(!stored.rows[0])throw Error("Content-Auftrag fehlt.");
  const original=parseJob(stored.rows[0].snapshot);
  if(original.status!=="awaiting_approval"||original.content?.format!=="video"||contentFingerprint(original)!==request.content_hash)throw Error("WhatsApp-Änderungswunsch ist nicht mehr aktuell.");
  const revised=await reviseApprovedVideo({...original,status:"approved"},feedback);
  await db.transaction(async sql=>{
    const pending=await sql.query("SELECT id,feedback FROM content_approval_requests WHERE id=$1 AND status='changes_requested' FOR UPDATE",[request.id]);
    const current=await sql.query("SELECT snapshot,event_sequence FROM content_jobs WHERE id=$1 FOR UPDATE",[jobId]);
    if(!pending.rows[0]||!current.rows[0]||pending.rows[0].feedback!==feedback||contentFingerprint(parseJob(current.rows[0].snapshot))!==request.content_hash)throw Error("Entwurf oder Änderungswunsch inzwischen verändert.");
    await sql.query("UPDATE content_jobs SET status='awaiting_approval',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",[jobId,JSON.stringify(revised),revised.events.length,revised.updatedAt]);
    for(const event of revised.events.filter(e=>e.sequence>Number(current.rows[0].event_sequence)))await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[jobId,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
  });
  try {await requestContentApproval(jobId);return {job:revised,approvalSent:true};}
  catch(error){return {job:revised,approvalSent:false,reason:error instanceof Error?error.message:"Versand unklar."};}
}

// An authenticated operator can replace an unapproved caption. The old
// WhatsApp approval is revoked in the same transaction as the content change.
export async function revisePendingVideoCaption(jobId:string) {
  const db=getDatabase();
  const feedback="Der Begleittext der Videobeschreibung ist unpassend formuliert; schreibe ihn wie eine natürliche Person.";
  const row=await db.query("SELECT snapshot FROM content_jobs WHERE id=$1",[jobId]);
  if(!row.rows[0])throw Error("Content-Auftrag fehlt.");
  const original=parseJob(row.rows[0].snapshot);
  if(original.status!=="awaiting_approval"||original.content?.format!=="video")throw Error("Es gibt keinen offenen Videoentwurf.");
  const hash=contentFingerprint(original);
  const revised=await reviseApprovedVideo({...original,status:"approved"},feedback);
  await db.transaction(async sql=>{
    const current=await sql.query("SELECT snapshot,event_sequence FROM content_jobs WHERE id=$1 FOR UPDATE",[jobId]);
    if(!current.rows[0])throw Error("Content-Auftrag fehlt.");
    const latest=parseJob(current.rows[0].snapshot);
    if(latest.status!=="awaiting_approval"||contentFingerprint(latest)!==hash)throw Error("Entwurf inzwischen verändert.");
    const pending=await sql.query("SELECT id FROM content_approval_requests WHERE job_id=$1 AND status='pending' AND content_hash=$2 AND whatsapp_message_id IS NOT NULL FOR UPDATE",[jobId,hash]);
    if(pending.rows.length!==1)throw Error("Keine eindeutig zuordenbare offene WhatsApp-Inhaltsfreigabe.");
    await sql.query("UPDATE content_approval_requests SET status='rejected',feedback=$2,decided_at=now() WHERE id=$1",[pending.rows[0].id,"Durch neue Begleittextfassung ersetzt; alte Freigabe ungültig."]);
    await sql.query("UPDATE content_jobs SET status='awaiting_approval',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",[jobId,JSON.stringify(revised),revised.events.length,revised.updatedAt]);
    for(const event of revised.events.filter(e=>e.sequence>Number(current.rows[0].event_sequence)))await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[jobId,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
  });
  try {await requestContentApproval(jobId);return {job:revised,approvalSent:true};}
  catch(error){return {job:revised,approvalSent:false,reason:error instanceof Error?error.message:"Versand unklar."};}
}

export async function hasContentApproval(job:ContentJob, sql:Sql=getDatabase()) {
  const record=await sql.query("SELECT 1 FROM content_approval_requests WHERE job_id=$1 AND status='approved' AND content_hash=$2 AND whatsapp_message_id IS NOT NULL LIMIT 1",[job.id,contentFingerprint(job)]);
  if(record.rows.length)return true;
  const daily=await sql.query("SELECT 1 FROM daily_drafts WHERE job_id=$1 AND status='content_approved' AND whatsapp_message_id IS NOT NULL LIMIT 1",[job.id]);
  return !!daily.rows.length;
}

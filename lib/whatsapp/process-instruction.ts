import {createHash} from "node:crypto";
import {getDatabase,type Database} from "../memory/db";
import {parseJob} from "../content/history";
import {reviseOperatorInstruction,inspectContent} from "../content/orchestrator";
import {visualFingerprint} from "../content/visual-context";
import {interpretInstruction,validateInstruction,clarification,InstructionParserError,type Instruction} from "./instruction";
import {resolveInstructionTarget} from "./instruction-target";
import {loadLanguageExamples} from "./language-memory";
import {classifyWhatsAppReply} from "./intent";
import {sendWhatsAppText} from "./client";

export type OperatorMessage={id:string;from:string;body:string;replyToMessageId:string|null;payload:unknown};
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clarifyText="Meinst du ein neues Bild für das bestehende Produkt, nur eine Textänderung oder ein anderes Produkt? Bitte antworte direkt auf die betreffende Freigabenachricht. Es wurde nichts produziert oder veröffentlicht.";

type Dependencies={database?:Database;interpret?:typeof interpretInstruction;send?:typeof sendWhatsAppText;sendApproval:(jobId:string)=>Promise<boolean>};
export async function processOperatorInstruction(input:OperatorMessage,
  {database,interpret=interpretInstruction,send=sendWhatsAppText,sendApproval}:Dependencies):Promise<boolean>{
  const trusted=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
  if(!trusted || input.from.replace(/\D/g,"")!==trusted)return true;
  const literal=classifyWhatsAppReply(input.body);
  if(literal.intent!=="changes_requested" || /^(entwurf|wochenbilanz)[.!?]*$/i.test(input.body.trim()))return false;
  const db=database ?? getDatabase();
  const claim=await db.transaction(async sql=>{
    const added=await sql.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",[input.id,input.from,input.replyToMessageId,input.body,JSON.stringify(input.payload)]);
    if(!added.rows.length)return null;
    const targets=await sql.query(`SELECT j.id,j.snapshot,p.id AS publication_id FROM content_jobs j
      LEFT JOIN LATERAL (SELECT * FROM publication_requests WHERE job_id=j.id ORDER BY created_at DESC,revision DESC LIMIT 1) p ON true
      LEFT JOIN daily_drafts d ON d.job_id=j.id
      WHERE j.status IN ('approved','awaiting_approval')
      AND ((p.platform='facebook' AND p.status IN ('pending','changes_requested') AND p.whatsapp_message_id IS NOT NULL AND p.approver_wa_id=$2)
        OR (d.status IN ('awaiting_approval','changes_requested') AND d.whatsapp_message_id IS NOT NULL))
      AND ($1::text IS NULL OR p.whatsapp_message_id=$1 OR d.whatsapp_message_id=$1 OR EXISTS (SELECT 1 FROM whatsapp_instructions i JOIN whatsapp_events e ON e.message_id=i.message_id
        WHERE (i.job_id=j.id OR i.interpretation->'routing'->'candidate_job_ids' ? j.id::text) AND e.wa_id=$2 AND i.interpretation->>'notice_message_id'=$1 AND i.created_at>now()-interval '30 minutes'))
      ORDER BY j.updated_at DESC LIMIT 10 FOR UPDATE OF j`,[input.replyToMessageId,trusted]);
    const competing=input.replyToMessageId?{rows:[]}:await sql.query(`SELECT 1 FROM approval_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL AND approver_wa_id=$1
      UNION ALL SELECT 1 FROM publication_requests WHERE platform<>'facebook' AND status='pending' AND whatsapp_message_id IS NOT NULL AND approver_wa_id=$1 LIMIT 1`,[trusted]);
    const history=input.replyToMessageId?{rows:[]}:await sql.query(`SELECT e.body,COALESCE(i.job_id,p.job_id,d.job_id,a.job_id) AS job_id FROM whatsapp_events e
      LEFT JOIN whatsapp_instructions i ON i.message_id=e.message_id
      LEFT JOIN publication_requests p ON p.whatsapp_message_id=e.reply_to_message_id
      LEFT JOIN daily_drafts d ON d.whatsapp_message_id=e.reply_to_message_id
      LEFT JOIN approval_requests a ON a.whatsapp_message_id=e.reply_to_message_id WHERE e.wa_id=$1 AND e.message_id<>$2
      AND e.received_at>now()-interval '30 minutes' ORDER BY e.received_at DESC LIMIT 12`,[input.from,input.id]);
    const targetId=input.replyToMessageId&&targets.rows.length===1?String(targets.rows[0].id):resolveInstructionTarget(input.body,
      targets.rows.map(row=>({id:String(row.id),job:parseJob(row.snapshot)})),history.rows as {body:string;job_id?:unknown}[],!!competing.rows.length);
    const row=targets.rows.length<10?targets.rows.find(row=>row.id===targetId)||null:null;
    // An interrupted parse is never retried for the same inbound ID. A new
    // operator message can resolve the job after the bounded inference expires.
    if(row)await sql.query("UPDATE whatsapp_instructions SET status='clarify',error_code='instruction_interrupted',updated_at=now() WHERE job_id=$1 AND status IN ('parsing','parsed') AND updated_at<now()-interval '5 minutes'",[row.id]);
    const busy=row?await sql.query("SELECT 1 FROM whatsapp_instructions WHERE job_id=$1 AND status IN ('parsing','parsed') LIMIT 1",[row.id]):{rows:[]};
    const job=row&&!busy.rows.length?parseJob(row.snapshot):null;
    await sql.query("INSERT INTO whatsapp_instructions(message_id,job_id,publication_id,context_hash,status,error_code,interpretation) VALUES($1,$2,$3,$4,$5,$6,$7)",[input.id,job?.id||null,job?row!.publication_id:null,job?hash(job):null,job?'parsing':'clarify',job?null:busy.rows.length?'instruction_busy':'target_unresolved',JSON.stringify({routing:{candidate_job_ids:targets.rows.map(row=>row.id)}})]);
    if(job && input.replyToMessageId && /^(nein[,\s]|ich meinte|korrektur:)/i.test(input.body.trim())) {
      const previous=await sql.query("SELECT message_id FROM whatsapp_instructions WHERE job_id=$1 AND interpretation->>'notice_message_id'=$2 ORDER BY created_at DESC LIMIT 1",[job.id,input.replyToMessageId]);
      if(previous.rows[0])await sql.query("UPDATE whatsapp_instructions SET interpretation=jsonb_set(interpretation,'{correction_source_message_id}',to_jsonb($2::text)) WHERE message_id=$1",[input.id,previous.rows[0].message_id]);
    }
    if(job&&row?.publication_id){
      const held=await sql.query("UPDATE publication_requests SET status='changes_requested',feedback=$2,updated_at=now() WHERE id=$1 AND status IN ('pending','changes_requested','rejected') AND publish_attempted_at IS NULL RETURNING id",[row.publication_id,input.body]);
      if(!held.rows.length)throw Error('stale_instruction_context');
    }
    if(job){
      const held=await sql.query("UPDATE daily_drafts SET status='changes_requested',feedback=$2,updated_at=now() WHERE job_id=$1 AND status IN ('awaiting_approval','changes_requested') RETURNING job_id",[job.id,input.body]);
      if(!row?.publication_id&&!held.rows.length)throw Error('stale_instruction_context');
    }
    return {job,publicationId:job?row!.publication_id as string|null:null,
      targetNotice:targets.rows.length?`Welchen Auftrag meinst du? ${targets.rows.map(row=>{const p=parseJob(row.snapshot).opportunity.product;return `${p.name.slice(0,90)} (ASIN ${p.asin})`;}).join(' oder ')}. Nenne bitte das Produkt oder antworte direkt auf dessen Freigabenachricht. Es wurde nichts produziert oder veröffentlicht.`:'Es gibt keine eindeutig zuordenbare offene Freigabe für diese Nachricht. Bitte den Auftrag im Content Studio prüfen. Es wurde nichts produziert oder veröffentlicht.'};
  });
  if(!claim)return true; // Durable dedup precedes inference and notifications.
  let instruction:Instruction=clarification();
  let parserFailure:string|null=null;
  if(claim.job){
    try{const examples=await loadLanguageExamples(db,trusted,input.body,claim.job);instruction=validateInstruction(await interpret(input.body,claim.job,fetch,examples),input.body);}catch(error){instruction=clarification();parserFailure=error instanceof InstructionParserError?error.message:"parser_unavailable";}
    await db.query("UPDATE whatsapp_instructions SET status='parsed',interpretation=jsonb_set(COALESCE(interpretation,'{}'),'{instruction}',$2::jsonb),updated_at=now() WHERE message_id=$1 AND status='parsing'",[input.id,JSON.stringify(instruction)]);
  }
  let notice=claim.job?clarifyText:claim.targetNotice,dailyJobId:string|null=null;
  if(claim.job){
    try{
      const result=await db.transaction(async sql=>{
        const stored=await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE",[claim.job!.id]);
        const record=await sql.query("SELECT * FROM whatsapp_instructions WHERE message_id=$1 FOR UPDATE",[input.id]);
        if(!stored.rows[0]||record.rows[0]?.status!=="parsed")throw Error("instruction_not_available");
        const original=parseJob(stored.rows[0].snapshot);
        if(hash(original)!==record.rows[0].context_hash)throw Error("stale_instruction_context");
        if(instruction.intent==='change_product'){
          original.status='needs_input';original.error='product_change_required';original.updatedAt=new Date().toISOString();
          const event={sequence:original.events.length+1,at:original.updatedAt,agent:'orchestrator' as const,kind:'decision' as const,message:'Neue Produktauswahl erforderlich. Bestehendes Produkt und bestehende ASIN bleiben unverändert.',data:instruction};original.events.push(event);
          await sql.query("UPDATE content_jobs SET status='needs_input',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",[original.id,JSON.stringify(original),event.sequence,original.updatedAt]);
          await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[original.id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
          await sql.query("UPDATE daily_drafts SET status='needs_input',updated_at=now() WHERE job_id=$1",[original.id]);
          await sql.query("UPDATE whatsapp_instructions SET status='applied',updated_at=now() WHERE message_id=$1",[input.id]);
          return {daily:null,notice:"Bitte wähle ein neues konkretes Amazon-Produkt im Content Studio. Der alte Auftrag bleibt gesperrt und seine Produktzuordnung unverändert."};
        }
        if(parserFailure)throw Error(parserFailure);
        if(!['revise_image','revise_text','revise_both'].includes(instruction.intent))throw Error('clarify');
        const revised=reviseOperatorInstruction(original,instruction);
        const review=inspectContent(revised.content!,revised.decision!);
        if(!review.passed)throw Error('creative_review_failed');revised.review=review;
        const event={sequence:original.events.length+1,at:revised.updatedAt,agent:'orchestrator' as const,kind:'decision' as const,
          message:'Strukturierte WhatsApp-Revision übernommen; erneute Freigabe erforderlich.',
          data:{kind:'semantic_revision',instruction,messageId:input.id,sourcePublicationId:claim.publicationId,sourceVisualFingerprint:visualFingerprint(original)}};
        revised.events.push(event);
        await sql.query("UPDATE content_jobs SET status='awaiting_approval',opportunity=$2,snapshot=$3,event_sequence=$4,updated_at=$5 WHERE id=$1",[revised.id,JSON.stringify(revised.opportunity),JSON.stringify(revised),event.sequence,revised.updatedAt]);
        await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[revised.id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
        const daily=await sql.query("UPDATE daily_drafts SET status='awaiting_approval',whatsapp_message_id=NULL,whatsapp_send_attempted_at=NULL,updated_at=now() WHERE job_id=$1 RETURNING job_id",[revised.id]);
        await sql.query("UPDATE whatsapp_instructions SET status='applied',updated_at=now() WHERE message_id=$1",[input.id]);
        return {daily:daily.rows.length?revised.id:null,notice:"Änderung im selben Auftrag gespeichert. Bitte den überarbeiteten Plan im Content Studio prüfen und freigeben. Noch keine neue Medienproduktion oder Veröffentlichung."};
      });
      notice=result.notice;dailyJobId=result.daily;
    }catch(error){
      const allowed=['visual_context_mismatch','revision_not_available','revision_unchanged','stale_instruction_context','creative_review_failed','parser_auth_missing','parser_auth_rejected','parser_billing_required','parser_context_too_large','parser_unavailable'];
      const code=error instanceof Error && allowed.includes(error.message)?error.message:'instruction_unclear';
      if(code.startsWith('parser_'))notice='Deine Anweisung wurde gespeichert, aber der Sprachmodell-Zugang funktioniert momentan nicht. Das ist ein technischer Fehler; du musst die Anweisung nicht anders formulieren. Es wurde nichts produziert oder veröffentlicht.';
      if(code==='visual_context_mismatch')notice='Das Bildbriefing passt nicht zum bestehenden Produkt. Bitte beschreibe dessen Anwendung. Es wurde kein Bild erzeugt und nichts veröffentlicht.';
      if(code==='revision_not_available')notice='Diese Revision ist im aktuellen Zustand oder innerhalb des bestehenden Revisionslimits nicht möglich. Bitte den Auftrag im Content Studio prüfen. Es wurde nichts produziert oder veröffentlicht.';
      await db.query("UPDATE whatsapp_instructions SET status='clarify',error_code=$2,updated_at=now() WHERE message_id=$1 AND status='parsed'",[input.id,code]);
    }
  }
  const claimedNotice=await db.query("UPDATE whatsapp_instructions SET notice_attempted_at=now() WHERE message_id=$1 AND notice_attempted_at IS NULL RETURNING message_id",[input.id]);
  if(claimedNotice.rows.length){
    if(dailyJobId)await sendApproval(dailyJobId);else {
      const noticeId=await send(notice);
      await db.query("UPDATE whatsapp_instructions SET interpretation=jsonb_set(COALESCE(interpretation,'{}'),'{notice_message_id}',to_jsonb($2::text)) WHERE message_id=$1",[input.id,noticeId]);
    }
  }
  return true;
}

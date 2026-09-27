import type {Sql} from '../memory/db';
import type {ContentJob} from '../content/schema';
import {validateInstruction,type LanguageExample} from './instruction';
import type {Opportunity} from '../content/schema';
import {isPumpkinCarvingProduct} from '../content/category';
import type {ApprovedEditorialCorrection} from '../content/agent';

function sameFamily(a:string,b:string):boolean {
  const normalize=(value:string)=>value.toLocaleLowerCase('de-DE').replace(/[^\p{L}]+/gu,' ').trim();
  return !!a && !!b && (normalize(a)===normalize(b) || (isPumpkinCarvingProduct(a) && isPumpkinCarvingProduct(b)));
}

// Confirmed operator feedback is read as examples, never as new product facts or approvals.
// Keep the durable history intact; rank a bounded context for each new plan.
export async function loadApprovedEditorialCorrections(sql:Sql,operator:string,opportunity:Opportunity):Promise<ApprovedEditorialCorrection[]> {
  if(!operator || !await available(sql))return [];
  const structured=(await sql.query(`SELECT operator_message,interpreted_intent,product_context,created_at FROM operator_language_examples
    WHERE operator_wa_id=$1 AND confirmed=true AND interpreted_intent IN ('revise_image','revise_text','revise_both')
    ORDER BY created_at DESC LIMIT 200`,[operator])).rows;
  const other=await editorialFeedbackAvailable(sql)
    ?(await sql.query(`SELECT feedback,format,product_context,created_at FROM approved_editorial_feedback
      WHERE operator_wa_id=$1 ORDER BY created_at DESC LIMIT 200`,[operator])).rows:[];
  const rows=[...structured,...other.map(row=>({operator_message:row.feedback,interpreted_intent:
    /bild|szene|werkzeug|motiv|darstell|grafik|foto|gabel|besteck|hintergrund/i.test(String(row.feedback))?'revise_both':'revise_text',
    product_context:row.product_context,created_at:row.created_at}))]
    .sort((a,b)=>new Date(String(b.created_at||0)).getTime()-new Date(String(a.created_at||0)).getTime());
  const seen=new Set<string>();
  const corrections=rows.flatMap(row=>{
    const message=String(row.operator_message||'').replace(/https?:\/\/\S+/gi,'[Link]').trim().slice(0,500);
    const intent=String(row.interpreted_intent);
    if(!message || !['revise_image','revise_text','revise_both'].includes(intent) || seen.has(message.toLocaleLowerCase('de-DE')))return [];
    seen.add(message.toLocaleLowerCase('de-DE'));
    const context=row.product_context as {name?:unknown;asin?:unknown}|null;
    const same=String(context?.asin||'')===opportunity.product.asin || sameFamily(String(context?.name||''),opportunity.product.name);
    return [{message,intent:intent as ApprovedEditorialCorrection['intent'],sameProductFamily:same}];
  });
  return [...corrections.filter(item=>item.sameProductFamily),...corrections.filter(item=>!item.sameProductFamily)].slice(0,12);
}

// Optional during rollout: lack of migration must not block the core workflow.
async function available(sql:Sql) {
  return !!(await sql.query("SELECT to_regclass('public.operator_language_examples') AS name")).rows[0]?.name;
}
async function editorialFeedbackAvailable(sql:Sql) {
  return !!(await sql.query("SELECT to_regclass('public.approved_editorial_feedback') AS name")).rows[0]?.name;
}

// Called inside the content approval transaction, after confirming the revised
// snapshot and its WhatsApp approver. Unapproved feedback never enters memory.
export async function confirmContentEditorialFeedback(sql:Sql,job:ContentJob,operator:string,confirmationMessageId:string) {
  if(!await editorialFeedbackAvailable(sql))return;
  const rows=(await sql.query(`SELECT e.message_id,e.body FROM content_approval_requests p
    JOIN whatsapp_events e ON e.wa_id=$2 AND e.body=p.feedback AND e.received_at>=p.created_at
      AND e.received_at<=p.decided_at+interval '1 minute'
    WHERE p.job_id=$1 AND p.status='changes_requested' AND length(e.body) BETWEEN 1 AND 1000
    ORDER BY e.received_at DESC LIMIT 50`,[job.id,operator])).rows;
  const context=JSON.stringify({name:job.opportunity.product.name,asin:job.opportunity.product.asin});
  for(const row of rows)await sql.query(`INSERT INTO approved_editorial_feedback(operator_wa_id,source_message_id,confirmation_message_id,feedback,format,product_context,content_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_message_id,confirmation_message_id) DO NOTHING`,
    [operator,row.message_id,confirmationMessageId,row.body,job.content?.format||'text',context,job.id]);
}
export async function loadLanguageExamples(sql:Sql,operator:string,body:string,job:ContentJob):Promise<LanguageExample[]> {
  if(!await available(sql))return [];
  const rows=(await sql.query(`SELECT operator_message,structured_instruction,operator_correction,product_context FROM operator_language_examples
    WHERE operator_wa_id=$1 AND confirmed=true ORDER BY created_at DESC LIMIT 80`,[operator])).rows;
  const tokens=new Set(body.toLocaleLowerCase('de-DE').match(/[\p{L}]{3,}/gu)||[]);
  const ranked=rows.map(row=>{
    const message=String(row.operator_message);
    const instruction=validateInstruction(row.structured_instruction,message);
    const overlap=(message.toLocaleLowerCase('de-DE').match(/[\p{L}]{3,}/gu)||[]).filter(word=>tokens.has(word)).length;
    const sameProduct=(row.product_context as {asin?:string})?.asin===job.opportunity.product.asin;
    return {message,instruction,corrected:!!row.operator_correction,score:overlap*10+(sameProduct?2:0)+(row.operator_correction?5:0)};
  }).filter(row=>row.score>0&&['revise_image','revise_text','revise_both'].includes(row.instruction.intent)).sort((a,b)=>b.score-a.score);
  const seen=new Set<string>();
  return ranked.filter(row=>{const key=row.message.toLocaleLowerCase('de-DE');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,5)
    .map(row=>({operator_message:row.message,intent:row.instruction.intent,text_operations:row.instruction.text_operations,corrected:row.corrected}));
}

// Called inside the existing explicit plan-approval transaction, never by model output.
export async function confirmLanguageExample(sql:Sql,job:ContentJob,operator:string,confirmationMessageId:string) {
  if(!await available(sql))return;
  const previousApproval=job.events.reduce((index,event,position)=>event.agent==='orchestrator' && /Content-Plan nach eindeutiger WhatsApp-Freigabe genehmigt/.test(event.message)?position:index,-1);
  const messageIds=job.events.slice(previousApproval+1).filter(event=>(event.data as {kind?:string}|undefined)?.kind==='semantic_revision')
    .map(event=>(event.data as {messageId?:string}).messageId).filter((id):id is string=>typeof id==='string').reverse();
  for(const messageId of messageIds){
  const result=await sql.query(`SELECT i.interpretation,e.body,e.message_id FROM whatsapp_instructions i JOIN whatsapp_events e ON e.message_id=i.message_id
    WHERE i.message_id=$1 AND i.job_id=$2 AND i.status='applied' AND e.wa_id=$3`,[messageId,job.id,operator]);
  const source=result.rows[0];if(!source||String(source.body).length>1000)return;
  const envelope=source.interpretation as {instruction?:unknown;correction_source_message_id?:string};
  const instruction=validateInstruction(envelope.instruction,String(source.body));
  if(!['revise_image','revise_text','revise_both'].includes(instruction.intent))return;
  const context=JSON.stringify({name:job.opportunity.product.name,asin:job.opportunity.product.asin});
  const insert=async(id:string,body:string,correction:string|null)=>{
    if(!body.trim()||body.length>1000)return;
    await sql.query(`INSERT INTO operator_language_examples(operator_wa_id,source_message_id,confirmation_message_id,operator_message,interpreted_intent,structured_instruction,operator_correction,product_context,content_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_message_id,confirmation_message_id) DO NOTHING`,
    [operator,id,confirmationMessageId,body,instruction.intent,JSON.stringify(instruction),correction,context,job.id]);
  };
  await insert(messageId,String(source.body),null);
  if(envelope.correction_source_message_id){
    const original=await sql.query(`SELECT e.body,e.message_id FROM whatsapp_instructions i JOIN whatsapp_events e ON e.message_id=i.message_id
      WHERE i.message_id=$1 AND i.job_id=$2 AND e.wa_id=$3`,[envelope.correction_source_message_id,job.id,operator]);
    if(original.rows[0])await insert(String(original.rows[0].message_id),String(original.rows[0].body),String(source.body));
  }
  }
}

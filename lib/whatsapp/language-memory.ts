import type {Sql} from '../memory/db';
import type {ContentJob} from '../content/schema';
import {validateInstruction,type LanguageExample} from './instruction';

// Optional during rollout: lack of migration must not block the core workflow.
async function available(sql:Sql) {
  return !!(await sql.query("SELECT to_regclass('public.operator_language_examples') AS name")).rows[0]?.name;
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
  const event=job.events.at(-1);
  if((event?.data as {kind?:string}|undefined)?.kind!=='semantic_revision')return;
  const messageId=(event?.data as {messageId?:string}|undefined)?.messageId;
  if(typeof messageId!=='string')return;
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

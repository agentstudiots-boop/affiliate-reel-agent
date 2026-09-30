import type {Database} from "../memory/db";
import {processOperatorInstruction} from "./process-instruction";

// Plain-language reason for an unapplied correction; internal codes are never shown.
export function clarifyStatusText(code:string) {
  const nothing=' Es wurde nichts produziert oder veröffentlicht.';
  if(code==='target_unresolved')return 'Deine letzte Änderung konnte keinem Entwurf zugeordnet werden, weil gerade keine Inhaltsfreigabe auf dich wartet.'+nothing+' Für ein neues Motiv oder Produkt starte bitte einen neuen Auftrag, zum Beispiel „Artikelsuche Kürbisschnitzset“.';
  if(code==='instruction_busy')return 'Zu diesem Entwurf wird gerade noch eine andere Änderung verarbeitet. Bitte warte kurz und schicke den Wunsch danach erneut.'+nothing;
  if(code==='instruction_interrupted')return 'Die Verarbeitung deiner letzten Änderung wurde unterbrochen. Bitte schicke den Wunsch noch einmal als Antwort auf die Freigabenachricht.'+nothing;
  if(code.startsWith('parser_'))return 'Deine Änderung ist gespeichert, aber der Sprachmodell-Zugang funktioniert momentan nicht. Das ist ein technischer Fehler; du musst nichts anders formulieren.'+nothing;
  return 'Deine Änderung war nicht eindeutig genug, um sie umzusetzen. Bitte antworte direkt auf die Freigabenachricht und beschreibe, ob Bild, Text oder Produkt geändert werden soll.'+nothing;
}

// Only a trusted, explicit Status message resumes a previously saved correction.
// Reuse the stored interpretation and never repeat the paid parser call.
export async function recoverLatestInstruction(db:Database,waId:string,sendApproval:(jobId:string)=>Promise<boolean>) {
  const result=await db.query(`SELECT i.message_id,i.job_id,i.status,e.body,e.payload,e.reply_to_message_id,
      d.status AS draft_status,d.whatsapp_message_id AS draft_message_id,d.whatsapp_send_attempted_at
    FROM whatsapp_instructions i JOIN whatsapp_events e ON e.message_id=i.message_id
    LEFT JOIN daily_drafts d ON d.job_id=i.job_id
    WHERE e.wa_id=$1 AND i.created_at>now()-interval '24 hours'
    ORDER BY i.created_at DESC LIMIT 1`,[waId]);
  const row=result.rows[0];
  if(!row)return '';
  if(row.status==='parsed'){
    await processOperatorInstruction({id:String(row.message_id),from:waId,body:String(row.body),
      replyToMessageId:row.reply_to_message_id?String(row.reply_to_message_id):null,payload:row.payload},
      {database:db,sendApproval});
  }
  const current=await db.query(`SELECT i.status,i.error_code,d.status AS draft_status,d.whatsapp_message_id AS draft_message_id,
      d.whatsapp_send_attempted_at FROM whatsapp_instructions i LEFT JOIN daily_drafts d ON d.job_id=i.job_id
      WHERE i.message_id=$1`,[row.message_id]);
  const latest=current.rows[0];
  if(latest?.status==='applied' && latest.draft_status==='awaiting_approval' && !latest.draft_message_id && row.job_id){
    // The operator reports that the approval is missing by requesting Status.
    // Repeating an approval request cannot buy media or publish a post.
    // A short delay protects against an outbound send still in flight.
    const reset=await db.query(`UPDATE daily_drafts SET whatsapp_send_attempted_at=NULL,updated_at=now()
      WHERE job_id=$1 AND status='awaiting_approval' AND whatsapp_message_id IS NULL
        AND whatsapp_send_attempted_at<now()-interval '3 minutes' RETURNING job_id`,[row.job_id]);
    if(reset.rows.length || !latest.whatsapp_send_attempted_at){
      try{await sendApproval(String(row.job_id));}
      catch(error){
        console.error(JSON.stringify({event:'instruction_status_approval_delivery_failed',
          failureType:error instanceof Error?error.name:'unknown',
          httpStatus:typeof error==='object'&&error!==null&&'httpStatus' in error?error.httpStatus:undefined}));
      }
    }
    const refreshed=await db.query('SELECT whatsapp_message_id FROM daily_drafts WHERE job_id=$1',[row.job_id]);
    return refreshed.rows[0]?.whatsapp_message_id
      ? 'Deine Bild- und Textkorrektur ist gespeichert. Der überarbeitete Entwurf wurde dir gerade zur WhatsApp-Inhaltsfreigabe gesendet. Das alte Bild wird nicht veröffentlicht.'
      : 'Deine Korrektur ist gespeichert und die alte Veröffentlichung gesperrt. Die neue Freigabenachricht konnte noch nicht sicher zugestellt werden; keine neue Bildproduktion und kein Post.';
  }
  if(latest?.status==='parsed')return 'Deine Korrektur ist gespeichert, aber die technische Verarbeitung ist noch unterbrochen. Das alte Bild bleibt gesperrt; kein neuer Post.';
  if(latest?.status==='clarify')return clarifyStatusText(String(latest.error_code||''));
  if(latest?.status==='applied')return 'Deine Korrektur ist gespeichert. Die alte Veröffentlichungsfreigabe ist gesperrt; eine neue Freigabe ist erforderlich.';
  return 'Deine Korrektur wird verarbeitet. Das alte Bild bleibt gesperrt.';
}

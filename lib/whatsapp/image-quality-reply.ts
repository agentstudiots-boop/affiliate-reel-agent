import type { Database } from "../memory/db";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import type { VisualRequestMode } from "../meta/request-publication";

// The operator's manual decision on a stopped image job: a reply to exactly its notice message.
//   „Neues Bild“ / „Neues Bild: <Wunsch>“ → exactly one more paid attempt (the wish is added to the briefing)
//   „Bild trotzdem senden“                 → only after an uncertain check: the image goes to the operator's own approval
//   „Bildstatus prüfen“                    → one status lookup of the accepted provider job, never a new generation
//   „Stopp“                                → nothing further happens
// Idempotent: the reply message is claimed once (a redelivered webhook does nothing).
export type ImageReplyDeps = { database: () => Database; request: (jobId: string, mode: VisualRequestMode) => Promise<unknown>; send?: typeof sendWhatsAppText;
  notified?: (error: unknown) => boolean };

export async function handleImageQualityReply(input: IncomingWhatsAppMessage & { payload: unknown }, deps: ImageReplyDeps): Promise<boolean> {
  if (!input.replyToMessageId) return false;
  const trusted = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!trusted || input.from.replace(/\D/g, "") !== trusted) return false;
  // Only a reply to an image notice belongs here; any lookup problem leaves the message to the existing chain.
  let db: Database, notice: Record<string, unknown> | undefined;
  try {
    db = deps.database();
    notice = (await db.query("SELECT job_id,reason FROM image_quality_notices WHERE message_id=$1", [input.replyToMessageId])).rows[0];
  } catch { return false; }
  if (!notice) return false;
  const send = deps.send ?? sendWhatsAppText;
  const claim = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)]);
  if (!claim.rows.length) return true;
  const jobId = String(notice.job_id), reason = String(notice.reason);
  const text = input.body.trim().replace(/[.!]+$/, "");
  const run = async (mode: VisualRequestMode) => {
    try { await deps.request(jobId, mode); }
    catch (error) { if (!deps.notified?.(error)) await send(`Bildauftrag: ${error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "").slice(0, 400) : "nicht möglich."} Nichts veröffentlicht.`); }
  };
  const fresh = text.match(/^neues\s+bild(?:\s*[:\-–]\s*(.{3,300}))?$/i);
  if (fresh) {
    await db.query("INSERT INTO image_generation_grants(message_id,job_id,kind,change_instruction) VALUES($1,$2,'new_attempt',$3) ON CONFLICT DO NOTHING", [input.id, jobId, fresh[1]?.trim() ?? null]);
    await send(`Verstanden: genau ein weiterer kostenpflichtiger Bildversuch${fresh[1] ? ` mit deinem Wunsch („${fresh[1].trim().slice(0, 120)}“)` : ""}. Hauptmotiv und Ausschlüsse des Briefings bleiben; das Bild wird erneut automatisch geprüft. Ich melde mich mit dem Ergebnis.`);
    await run("continue");
    return true;
  }
  if (/^bild\s+trotzdem\s+senden$/i.test(text)) {
    if (reason !== "quality_uncertain") { await send("„Bild trotzdem senden“ geht nur, wenn die automatische Prüfung unsicher war. Bei einem klaren Fehler bitte „Neues Bild“ oder „Stopp“."); return true; }
    await db.query("INSERT INTO image_generation_grants(message_id,job_id,kind) VALUES($1,$2,'send_unchecked') ON CONFLICT DO NOTHING", [input.id, jobId]);
    await run("send_unchecked");
    return true;
  }
  if (/^bildstatus\s+prüfen$/i.test(text)) { await run("resume"); return true; }
  if (/^(?:stopp|stop|abbrechen|ablehnen)$/i.test(text)) { await send("Bildauftrag gestoppt. Es wird kein weiteres Bild erzeugt und nichts veröffentlicht."); return true; }
  await send("Antworte auf die Bildnachricht mit „Neues Bild“ (optional „Neues Bild: <Wunsch>“), „Bild trotzdem senden“ (nur bei unsicherer Prüfung), „Bildstatus prüfen“ oder „Stopp“. Es wurde nichts gestartet.");
  return true;
}

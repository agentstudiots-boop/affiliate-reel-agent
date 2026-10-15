import type { Database } from "../memory/db";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import type { VisualRequestMode } from "../meta/request-publication";
import { overrideClass, type OverrideClass } from "../content/image-quality/production";
import type { QualityResult } from "../content/image-quality/gate";

// The operator's manual decision on a stopped image job: a reply to exactly its notice message.
//   „Neues Bild“ / „Neues Bild: <Wunsch>“ → exactly one more paid attempt (the wish is added to the briefing)
//   „Bild trotzdem senden“                 → only after an uncertain check or design-only issues (never after a hard
//                                            failure): the image goes to the operator's own publication approval
//   „Bildstatus prüfen“                    → one status lookup of the accepted provider job, never a new generation
//   „Stopp“                                → nothing further happens
// Free phrasings („Mach es trotzdem“, „passt so“) are never executed directly: the operator gets a question back and must
// answer with the exact command. A reply is only valid for the newest notice of the job, for the content version the
// notice was about, and while the content approval still stands; anything else is answered and nothing is started.
// Idempotent: the reply message is claimed once (a redelivered webhook does nothing). Every decision is logged.
// An image decision is never a publication approval: the publication approval message follows separately.
export type ImageReplyDeps = { database: () => Database; request: (jobId: string, mode: VisualRequestMode) => Promise<unknown>; send?: typeof sendWhatsAppText;
  notified?: (error: unknown) => boolean };

const ANYWAY = /^(?:(?:bitte\s+)?(?:mach|mache|nimm|schick|schicke|sende|send|veröffentliche|poste|nehm)\s+(?:es|das|ihn|das\s+bild|es\s+bitte|das\s+bild\s+bitte)?\s*(?:doch\s+)?(?:bitte\s+)?trotzdem(?:\s+(?:senden|schicken|nehmen|machen|bitte))?|trotzdem(?:\s+(?:senden|schicken|nehmen|machen|bitte))?|(?:das\s+)?passt\s+(?:schon|so)|(?:ist\s+)?(?:gut|ok|okay)\s+so|(?:egal|schon\s+ok)|(?:ja\s+)?(?:nimm|nehm)\s+(?:es|das\s+bild)|(?:bild\s+)?(?:ist\s+)?in\s+ordnung)$/i;

async function decision(db: Database, input: IncomingWhatsAppMessage, jobId: string, action: string, reason?: string) {
  console.info(JSON.stringify({ event: "image_quality_decision", messageId: input.id, replyTo: input.replyToMessageId, jobId, action, reason: reason ?? null }));
  try {
    await db.query(`INSERT INTO whatsapp_context_log(message_id,action,wa_id,job_id,status,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (message_id, action) DO NOTHING`,
      [input.id, `image:${action}`, input.from.replace(/\D/g, ""), jobId, "image_stop", reason?.slice(0, 80) ?? null]);
  } catch { console.error(JSON.stringify({ event: "image_quality_decision_unsaved", messageId: input.id })); }
}

export async function handleImageQualityReply(input: IncomingWhatsAppMessage & { payload: unknown }, deps: ImageReplyDeps): Promise<boolean> {
  if (!input.replyToMessageId) return false;
  const trusted = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!trusted || input.from.replace(/\D/g, "") !== trusted) return false;
  // Only a reply to an image notice belongs here; any lookup problem leaves the message to the existing chain.
  let db: Database, notice: Record<string, unknown> | undefined;
  try {
    db = deps.database();
    notice = (await db.query("SELECT job_id,reason,attempt_no,created_at FROM image_quality_notices WHERE message_id=$1", [input.replyToMessageId])).rows[0];
  } catch { return false; }
  if (!notice) return false;
  const send = deps.send ?? sendWhatsAppText;
  const claim = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)]);
  if (!claim.rows.length) return true;
  const jobId = String(notice.job_id), reason = String(notice.reason);
  const attemptNo = notice.attempt_no === null || notice.attempt_no === undefined ? null : Number(notice.attempt_no);
  const text = input.body.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ");

  // Binding: newest notice of this job, same content version, content approval still in force.
  const latest = (await db.query("SELECT message_id FROM image_quality_notices WHERE job_id=$1 ORDER BY created_at DESC, attempt_no DESC NULLS LAST LIMIT 1", [jobId])).rows[0];
  if (latest && String(latest.message_id) !== input.replyToMessageId) {
    await decision(db, input, jobId, "stale_notice");
    await send("Diese Bildnachricht ist nicht mehr die aktuelle. Antworte bitte auf die neueste Bildnachricht zu diesem Auftrag. Es wurde nichts gestartet.");
    return true;
  }
  const job = (await db.query("SELECT status FROM content_jobs WHERE id=$1", [jobId])).rows[0];
  if (!job || String(job.status) !== "approved") {
    await decision(db, input, jobId, "content_not_approved", job ? String(job.status) : "missing");
    await send("Zu dieser Bildnachricht gibt es keine gültige Inhaltsfreigabe mehr (Entwurf geändert, abgelehnt oder ersetzt). Es wurde nichts gestartet; bei einer neuen Fassung kommt eine neue Inhaltsfreigabe.");
    return true;
  }
  let quality: QualityResult | null = null;
  if (attemptNo !== null) {
    const attempts = (await db.query("SELECT attempt_no,content_hash,quality FROM image_generation_attempts WHERE job_id=$1 ORDER BY attempt_no DESC", [jobId])).rows;
    const own = attempts.find(row => Number(row.attempt_no) === attemptNo);
    if (own && attempts[0] && String(attempts[0].content_hash) !== String(own.content_hash)) {
      await decision(db, input, jobId, "stale_version");
      await send("Diese Bildnachricht gehört zu einer älteren Fassung des Beitrags. Es wurde nichts gestartet.");
      return true;
    }
    quality = (own?.quality as QualityResult | null) ?? null;
  }
  const override: OverrideClass | null = reason === "quality_uncertain" ? "uncertain" : reason === "quality_failed" ? overrideClass(quality) : null;

  const run = async (mode: VisualRequestMode) => {
    try { await deps.request(jobId, mode); }
    catch (error) { if (!deps.notified?.(error)) await send(`Bildauftrag: ${error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "").slice(0, 400) : "nicht möglich."} Nichts veröffentlicht.`); }
  };
  const fresh = text.match(/^neues\s+bild(?:\s*[:\-–]\s*(.{3,300}))?$/i);
  if (fresh) {
    await decision(db, input, jobId, "new_attempt");
    await db.query("INSERT INTO image_generation_grants(message_id,job_id,kind,change_instruction) VALUES($1,$2,'new_attempt',$3) ON CONFLICT DO NOTHING", [input.id, jobId, fresh[1]?.trim() ?? null]);
    await send(`Verstanden: genau ein weiterer kostenpflichtiger Bildversuch${fresh[1] ? ` mit deinem Wunsch („${fresh[1].trim().slice(0, 120)}“)` : ""}. Hauptmotiv und Ausschlüsse des Briefings bleiben; das Bild wird erneut automatisch geprüft. Ich melde mich mit dem Ergebnis.`);
    await run("continue");
    return true;
  }
  if (/^bild\s+trotzdem\s+senden$/i.test(text)) {
    if (override !== "uncertain" && override !== "design") {
      await decision(db, input, jobId, "override_refused", reason);
      await send(reason === "quality_failed"
        ? "„Bild trotzdem senden“ ist hier nicht möglich: Das Bild verletzt eine harte Prüfregel (z. B. falsches oder fehlendes Produkt, ausgeschlossenes Motiv, Logo/Schrift, schwerer Bildfehler). Bitte „Neues Bild“ oder „Stopp“."
        : "„Bild trotzdem senden“ geht nur, wenn die automatische Prüfung unsicher war oder nur gestalterische Mängel fand. Bitte „Neues Bild“ oder „Stopp“.");
      return true;
    }
    await decision(db, input, jobId, "send_unchecked", override);
    await db.query("INSERT INTO image_generation_grants(message_id,job_id,kind) VALUES($1,$2,'send_unchecked') ON CONFLICT DO NOTHING", [input.id, jobId]);
    await run("send_unchecked");
    return true;
  }
  if (/^bildstatus\s+prüfen$/i.test(text)) { await decision(db, input, jobId, "resume"); await run("resume"); return true; }
  if (/^(?:stopp|stop|abbrechen|ablehnen)$/i.test(text)) {
    await decision(db, input, jobId, "stop");
    await send("Bildauftrag gestoppt. Es wird kein weiteres Bild erzeugt und nichts veröffentlicht.");
    return true;
  }
  if (ANYWAY.test(text)) {
    // A free "do it anyway" is ambiguous (new picture? send this one? publish?): ask, never guess.
    await decision(db, input, jobId, "clarify_anyway", override ?? reason);
    await send(override === "uncertain" || override === "design"
      ? "Meinst du, dass ich dir dieses Bild trotz der Prüfhinweise zur Veröffentlichungsfreigabe schicken soll? Dann antworte auf die Bildnachricht mit genau „Bild trotzdem senden“. Für einen neuen Versuch „Neues Bild“. Es wurde nichts gestartet und nichts veröffentlicht."
      : "Dieses Bild kann ich nicht trotzdem verwenden: Es verletzt eine harte Prüfregel. Möglich sind „Neues Bild“ (optional „Neues Bild: <Wunsch>“) oder „Stopp“. Es wurde nichts gestartet.");
    return true;
  }
  await decision(db, input, jobId, "help");
  await send(`Antworte auf die Bildnachricht mit „Neues Bild“ (optional „Neues Bild: <Wunsch>“)${override === "uncertain" || override === "design" ? ", „Bild trotzdem senden“" : ""}${reason === "provider_unclear" ? ", „Bildstatus prüfen“" : ""} oder „Stopp“. Es wurde nichts gestartet.`);
  return true;
}

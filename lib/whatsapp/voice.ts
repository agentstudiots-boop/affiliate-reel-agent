import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { sendWhatsAppText, whatsappMediaAccess } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { MAX_AUDIO_BYTES, TranscriptionError, transcribeAudio, type TranscriptionFailure } from "./transcribe";

// Voice layer in front of the normal WhatsApp text pipeline: audio → text, nothing else. The returned text is processed by
// exactly the same code as a typed message (same message id, same reply context). No audio and no transcript is stored here.

const MEDIA_HOSTS = /(?:^|\.)(?:fbsbx\.com|whatsapp\.net|fbcdn\.net|facebook\.com|whatsapp\.com)$/i;
const STALE_MINUTES = 2;

export type VoiceDeps = {
  db: Database; request?: typeof fetch; send?: (text: string) => Promise<unknown>;
  transcribe?: typeof transcribeAudio; approver?: string;
};
export type VoiceOutcome = { ok: true; body: string } | { ok: false; reason: "duplicate" | "ignored" | "failed" };

const MESSAGES: Record<string, string> = {
  not_configured: "Sprachnachrichten kann ich gerade nicht auswerten, weil keine Transkription eingerichtet ist. Bitte schreib mir den Auftrag als Text.",
  too_large: "Diese Sprachnachricht ist zu lang. Bitte fasse dich kürzer (unter etwa zwei Minuten) oder schreib mir den Auftrag.",
  provider_failed: "Die Transkription deiner Sprachnachricht ist gerade fehlgeschlagen. Bitte sende sie noch einmal oder schreib mir den Auftrag.",
  timeout: "Die Transkription deiner Sprachnachricht hat zu lange gedauert. Bitte sende sie noch einmal oder schreib mir den Auftrag.",
  unintelligible: "Ich konnte deine Sprachnachricht nicht sicher verstehen. Bitte sprich sie noch einmal ein oder schreib mir den Auftrag.",
  unsupported_format: "Dieses Audioformat kann ich nicht verarbeiten. Bitte nimm eine normale WhatsApp-Sprachnachricht auf oder schreib mir den Auftrag.",
  unreadable: "Ich konnte die Audiodatei nicht lesen. Bitte sprich sie noch einmal ein oder schreib mir den Auftrag.",
  media_unavailable: "Ich konnte die Sprachnachricht nicht von WhatsApp abrufen. Bitte sende sie noch einmal oder schreib mir den Auftrag.",
};

async function downloadMedia(mediaId: string, request: typeof fetch): Promise<{ bytes: Uint8Array; mime: string }> {
  const { token, version } = whatsappMediaAccess();
  if (!token) throw new Error("media_unavailable");
  const meta = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!meta.ok) throw new Error("media_unavailable");
  const info = await meta.json() as { url?: unknown; mime_type?: unknown; file_size?: unknown };
  let url: URL;
  try { url = new URL(String(info.url)); } catch { throw new Error("media_unavailable"); }
  if (url.protocol !== "https:" || url.username || url.password || !MEDIA_HOSTS.test(url.hostname)) throw new Error("media_unavailable");
  if (typeof info.file_size === "number" && info.file_size > MAX_AUDIO_BYTES) throw new TranscriptionError("too_large");
  const file = await request(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!file.ok) throw new Error("media_unavailable");
  const declared = Number(file.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) throw new TranscriptionError("too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, mime: typeof info.mime_type === "string" ? info.mime_type : "audio/ogg" };
}

async function claim(db: Database, id: string, from: string) {
  const result = await db.query(
    `INSERT INTO whatsapp_voice_messages(message_id,wa_id,status) VALUES($1,$2,'processing')
     ON CONFLICT(message_id) DO UPDATE SET attempts=whatsapp_voice_messages.attempts+1,updated_at=now()
       WHERE whatsapp_voice_messages.status='processing' AND whatsapp_voice_messages.updated_at<now()-make_interval(mins=>$3)
         AND whatsapp_voice_messages.attempts<3
     RETURNING message_id`, [id, from, STALE_MINUTES]);
  return result.rows.length > 0;
}
const finish = (db: Database, id: string, status: "done" | "failed" | "ignored", failure: string | null = null) =>
  db.query("UPDATE whatsapp_voice_messages SET status=$2,failure=$3,updated_at=now() WHERE message_id=$1", [id, status, failure]);

export async function completeVoice(db: Database, id: string) { await finish(db, id, "done"); }
// The text pipeline threw: let the provider's webhook retry reprocess the message instead of dropping it silently.
export async function releaseVoice(db: Database, id: string) {
  await db.query("UPDATE whatsapp_voice_messages SET updated_at=now()-interval '1 hour' WHERE message_id=$1 AND status='processing'", [id]);
}

export async function resolveVoiceMessage(incoming: IncomingWhatsAppMessage, deps: VoiceDeps): Promise<VoiceOutcome> {
  const audio = incoming.audio;
  if (!audio) return { ok: false, reason: "ignored" };
  const { db } = deps;
  const send = deps.send ?? (text => sendWhatsAppText(text, incoming.from));
  const tell = async (text: string) => { try { await send(text); } catch { console.error(JSON.stringify({ event: "voice_notice_unsent", messageId: incoming.id })); } };
  await ensureAutomationSchema(db);
  const approver = (deps.approver ?? process.env.WHATSAPP_APPROVER_WA_ID ?? "").replace(/\D/g, "");
  if (!approver || incoming.from.replace(/\D/g, "") !== approver) {
    // Only the operator may spend transcription budget or steer Jarvis.
    await db.query("INSERT INTO whatsapp_voice_messages(message_id,wa_id,status,failure) VALUES($1,$2,'ignored','not_operator') ON CONFLICT DO NOTHING", [incoming.id, incoming.from]);
    console.warn(JSON.stringify({ event: "voice_message_ignored", reason: "not_operator" }));
    return { ok: false, reason: "ignored" };
  }
  if (!await claim(db, incoming.id, incoming.from)) return { ok: false, reason: "duplicate" };
  try {
    const media = await downloadMedia(audio.mediaId, deps.request ?? fetch);
    const text = await (deps.transcribe ?? transcribeAudio)(media.bytes, media.mime || audio.mimeType, deps.request ? { request: deps.request } : {});
    console.info(JSON.stringify({ event: "voice_transcribed", messageId: incoming.id, chars: text.length }));
    // The operator sees what was understood. Commands are executed by the normal pipeline from this text only.
    await tell(`🎤 Verstanden: „${text.slice(0, 400)}“`);
    return { ok: true, body: text };
  } catch (error) {
    const code: TranscriptionFailure | "media_unavailable" = error instanceof TranscriptionError ? error.code
      : error instanceof Error && error.message === "media_unavailable" ? "media_unavailable" : "provider_failed";
    console.error(JSON.stringify({ event: "voice_message_failed", messageId: incoming.id, code, ...(error instanceof TranscriptionError && error.detail ? { detail: error.detail } : {}) }));
    await finish(db, incoming.id, "failed", code);
    await tell(`${MESSAGES[code] ?? MESSAGES.provider_failed} Es wurde nichts ausgeführt.`);
    return { ok: false, reason: "failed" };
  }
}

import { randomUUID } from "node:crypto";
import type { Sql } from "../memory/db";
import type { WhatsAppDeliveryStatus } from "../whatsapp/security";

// Durable evidence for the daily approval chain: every scheduled cron invocation and every delivery status Meta
// reports. The hosting plan keeps runtime logs for one hour only; without this, a silent day cannot be explained.
// Writing evidence never decides anything and never blocks the pipeline (callers catch).

export type SlotRun = { day: string | null; slot: string | null; outcome: string; whatsapp?: string | null; jobId?: string | null; reason?: string | null };

export async function recordSlotRun(db: Sql, run: SlotRun) {
  await db.query("INSERT INTO daily_slot_runs(id,day,slot,outcome,whatsapp,job_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), run.day, run.slot,
    run.outcome.slice(0, 60), run.whatsapp?.slice(0, 60) ?? null, run.jobId && /^[0-9a-f-]{36}$/i.test(run.jobId) ? run.jobId : null,
    run.reason ? run.reason.replace(/https?:\/\/\S+/g, "<url>").slice(0, 200) : null]);
}

export async function recordDeliveryStatuses(db: Sql, statuses: WhatsAppDeliveryStatus[]) {
  for (const item of statuses) {
    await db.query(`INSERT INTO whatsapp_delivery_statuses(message_id,status,error_code,error_title,provider_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (message_id,status) DO NOTHING`, [item.messageId, item.status, item.errorCode, item.errorTitle, item.providerAt]);
  }
  return statuses.length;
}

const WHATSAPP_LABEL: Record<string, string> = {
  approval_sent: "Freigabe gesendet", approval_not_sent: "nicht gesendet", approval_send_failed: "Versand fehlgeschlagen (unklar, nicht wiederholt)",
  template_required: "wartet: dein 24-h-WhatsApp-Fenster war geschlossen", notification_sent: "Vorlage gesendet", template_rejected: "Vorlage von Meta abgelehnt",
};
const DELIVERY_LABEL: Record<string, string> = { sent: "an Meta übergeben", delivered: "zugestellt", read: "gelesen", failed: "Zustellung fehlgeschlagen" };
const time = (value: unknown) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value)));

// Best (furthest) known delivery status per message id.
export async function deliveryStatusOf(db: Sql, messageIds: string[]) {
  const ids = messageIds.filter(Boolean);
  if (!ids.length) return new Map<string, { status: string; errorCode: number | null; at: string }>();
  const rows = (await db.query(`SELECT DISTINCT ON (message_id) message_id, status, error_code, COALESCE(provider_at, received_at) AS at FROM whatsapp_delivery_statuses
    WHERE message_id = ANY($1::text[]) ORDER BY message_id, CASE status WHEN 'failed' THEN 4 WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END DESC`, [ids])).rows;
  return new Map(rows.map(row => [String(row.message_id), { status: String(row.status), errorCode: row.error_code === null ? null : Number(row.error_code), at: String(row.at) }]));
}

// When the operator's 24 h service window closes (null = closed / never opened).
export async function serviceWindowClosesAt(db: Sql, approverWaId: string, now = new Date()): Promise<Date | null> {
  const approver = approverWaId.replace(/\D/g, "");
  if (!approver) return null;
  const row = (await db.query("SELECT max(received_at) AS last FROM whatsapp_events WHERE wa_id=$1", [approver])).rows[0];
  if (!row?.last) return null;
  const closes = new Date(new Date(String(row.last)).getTime() + 24 * 3600_000);
  return closes > now ? closes : null;
}

// Lines for the WhatsApp "Status" command: the last scheduled runs and the delivery state of the latest approvals.
export async function slotEvidenceLines(db: Sql, approverWaId: string, now = new Date()) {
  const runs = (await db.query(`SELECT r.invoked_at, r.day::text AS day, r.slot, r.outcome, r.whatsapp, r.reason, d.whatsapp_message_id
    FROM daily_slot_runs r LEFT JOIN daily_drafts d ON d.day=r.day AND d.slot=r.slot ORDER BY r.invoked_at DESC LIMIT 6`)).rows;
  const delivery = await deliveryStatusOf(db, runs.map(row => String(row.whatsapp_message_id ?? "")));
  const closes = await serviceWindowClosesAt(db, approverWaId, now);
  const lines = [closes ? `WhatsApp-Fenster offen bis ${time(closes.toISOString())} – danach warten neue Freigaben auf deine nächste Nachricht.`
    : "WhatsApp-Fenster geschlossen: neue Freigaben warten, bis du mir schreibst (Vorlage ist deaktiviert)."];
  if (!runs.length) lines.push("Noch kein protokollierter Cron-Lauf.");
  for (const row of runs) {
    const sent = row.whatsapp_message_id ? delivery.get(String(row.whatsapp_message_id)) : undefined;
    const proof = row.whatsapp_message_id ? ` · Zustellung: ${sent ? `${DELIVERY_LABEL[sent.status] ?? sent.status}${sent.errorCode ? ` (Fehler ${sent.errorCode})` : ""}` : "noch kein Status von Meta"}` : "";
    const slot = row.slot === "morning" ? "Vormittag" : row.slot === "afternoon" ? "Abend" : "außerhalb der Slots";
    lines.push(`${time(row.invoked_at)} Cron ${slot}: ${row.outcome}${row.whatsapp ? ` · ${WHATSAPP_LABEL[String(row.whatsapp)] ?? row.whatsapp}` : ""}${row.reason ? ` · ${String(row.reason).slice(0, 80)}` : ""}${proof}`);
  }
  return lines;
}

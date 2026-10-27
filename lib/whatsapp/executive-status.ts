// WhatsApp command „Executive“ (task B-11): the operator asks for the state of the executive level and gets the same
// read-only section as the weekly report (B-10), over the last 7 days. Deterministic, no model call: only the exact
// command from the configured approver number is answered, everything else is left to the existing chain. The reply is a
// status text – it starts nothing, and replying to it approves nothing (B-06 binds every decision to its own request
// message). Used by the webhook only with EXECUTIVE_WHATSAPP=true.

import type { Database } from "../memory/db";
import { formatExecutiveWeekly, readExecutiveWeekly } from "../enterprise/executive-weekly";

const COMMAND = /^executive(?:[ -]?status)?[.!?]*$/i;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type ExecutiveStatusMessage = { id: string; from: string; body: string; replyToMessageId?: string | null; payload?: unknown };
export type ExecutiveStatusDeps = { database: () => Database; send: (text: string) => Promise<string>; now?: () => Date };

export const isExecutiveStatusCommand = (body: string) => COMMAND.test(body.trim());

const digits = (value: string | undefined) => (value || "").replace(/\D/g, "");

export async function handleExecutiveStatus(message: ExecutiveStatusMessage, deps: ExecutiveStatusDeps): Promise<boolean> {
  if (!isExecutiveStatusCommand(message.body)) return false;
  const approver = digits(process.env.WHATSAPP_APPROVER_WA_ID);
  if (!approver || digits(message.from) !== approver) return false;
  const db = deps.database();
  // Same idempotency as „Status“: a redelivered message is answered exactly once.
  const claimed = await db.query(
    "INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",
    [message.id, message.from, message.replyToMessageId ?? null, message.body, JSON.stringify(message.payload ?? {})]);
  if (!claimed.rows.length) return true;
  const now = (deps.now ?? (() => new Date()))();
  const section = await readExecutiveWeekly(db, new Date(now.getTime() - WINDOW_MS), now, now);
  const priorities = await latestPriorities(db);
  await deps.send(`Executive-Status (letzte 7 Tage)\n\n${priorities}${formatExecutiveWeekly(section, "in den letzten 7 Tagen")}`.slice(0, 4000));
  return true;
}

// The newest prioritisation of the daily executive cycle (executive.prioritize), as a short list. Missing table, no task yet
// or an unreadable result gives an empty string – the status answer never fails because of it.
async function latestPriorities(db: Database): Promise<string> {
  try {
    // Stored as { output, evidence, usage } by the task repository; the priorities sit in the inner output.
    const row = (await db.query(`SELECT output->'output' AS output, updated_at FROM enterprise_tasks WHERE task_kind='executive.prioritize' AND status='succeeded'
      ORDER BY updated_at DESC LIMIT 1`)).rows[0];
    const list = (row?.output as { priorities?: unknown } | null | undefined)?.priorities;
    const items = Array.isArray(list) ? list as { rank: number; finding: string; action: string; operatorAction: boolean }[] : null;
    if (!row || !items) return "";
    const at = new Date(String(row.updated_at)).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
    if (!items.length) return `Prioritäten (${at}): nichts Offenes.\n\n`;
    return `Prioritäten (${at}):\n${items.slice(0, 6).map(item => `${item.rank}. ${String(item.finding).slice(0, 140)} → ${String(item.action).slice(0, 100)}${item.operatorAction ? " (deine Aktion)" : ""}`).join("\n")}\n\n`;
  } catch { return ""; }
}

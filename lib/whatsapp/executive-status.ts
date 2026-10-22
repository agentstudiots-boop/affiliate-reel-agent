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
  await deps.send(`Executive-Status (letzte 7 Tage)\n\n${formatExecutiveWeekly(section, "in den letzten 7 Tagen")}`.slice(0, 4000));
  return true;
}

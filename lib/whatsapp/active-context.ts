import type { Sql } from "../memory/db";

// The operator's active WhatsApp order: the latest explicit product order ("Erstelle einen Beitrag zum …", "Artikelsuche …",
// a product link with „Neuer Auftrag“) and its state. Persistent per operator, every change logged in whatsapp_context_log.
//
// Priority for "which product/draft is meant" (product pipeline):
//   1. safety, compliance and approvals (never decided here; the existing gates stay authoritative)
//   2. the explicit current message (a named product, a quoted approval message)
//   3. this active order and its state
//   4. conversation context and explicitly referenced drafts
//   5. automatic TrendScout rules
// Short follow-ups („Mach es trotzdem“, „Nimm lieber ein anderes Bild“) resolve against the active order, so an older
// open draft never silently takes over the conversation.

export type ActiveOrderStatus = "requested" | "in_progress" | "awaiting_approval" | "blocked" | "failed";
export type ActiveOrder = {
  waId: string; productLabel: string; asin: string | null; searchTerm: string | null; jobId: string | null;
  status: ActiveOrderStatus; reason: string | null; formatWish: "image" | "reel" | null; sourceMessageId: string; updatedAt: string;
};

// An order older than this no longer steers short follow-ups.
export const ACTIVE_ORDER_TTL_HOURS = 24;
// An order stuck "in_progress" this long (e.g. an interrupted webhook) may be resumed.
export const STALE_IN_PROGRESS_MINUTES = 10;

const row = (value: Record<string, unknown>): ActiveOrder => ({
  waId: String(value.wa_id), productLabel: String(value.product_label), asin: value.asin ? String(value.asin) : null,
  searchTerm: value.search_term ? String(value.search_term) : null, jobId: value.job_id ? String(value.job_id) : null,
  status: String(value.status) as ActiveOrderStatus, reason: value.reason ? String(value.reason) : null,
  formatWish: value.format_wish ? String(value.format_wish) as ActiveOrder["formatWish"] : null,
  sourceMessageId: String(value.source_message_id), updatedAt: new Date(String(value.updated_at)).toISOString(),
});

const digits = (waId: string) => waId.replace(/\D/g, "");

export async function loadActiveOrder(db: Sql, waId: string): Promise<ActiveOrder | null> {
  const result = await db.query(`SELECT * FROM whatsapp_active_context WHERE wa_id=$1 AND updated_at>now()-make_interval(hours => $2::int)`,
    [digits(waId), ACTIVE_ORDER_TTL_HOURS]);
  return result.rows[0] ? row(result.rows[0]) : null;
}

export function resumable(order: ActiveOrder, now = Date.now()) {
  if (order.status === "blocked" || order.status === "failed" || order.status === "requested") return true;
  return order.status === "in_progress" && now - Date.parse(order.updatedAt) > STALE_IN_PROGRESS_MINUTES * 60_000;
}

async function log(db: Sql, messageId: string, action: string, waId: string, order: { productLabel?: string | null; jobId?: string | null; status?: string | null; reason?: string | null }) {
  await db.query(`INSERT INTO whatsapp_context_log(message_id,action,wa_id,product_label,job_id,status,reason) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (message_id, action) DO NOTHING`, [messageId, action, digits(waId), order.productLabel?.slice(0, 120) ?? null, order.jobId ?? null, order.status ?? null, order.reason?.slice(0, 80) ?? null]);
  console.info(JSON.stringify({ event: "whatsapp_active_order", action, messageId, status: order.status ?? null, jobId: order.jobId ?? null, reason: order.reason ?? null }));
}

// A new explicit order replaces the active one (the newest explicit instruction wins).
export async function startActiveOrder(db: Sql, input: { waId: string; messageId: string; productLabel: string; asin?: string | null; searchTerm?: string | null;
  formatWish?: "image" | "reel" | null; status?: ActiveOrderStatus; jobId?: string | null; reason?: string | null }) {
  const status = input.status ?? "in_progress";
  await db.query(`INSERT INTO whatsapp_active_context(wa_id,product_label,asin,search_term,job_id,status,reason,format_wish,source_message_id,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
    ON CONFLICT (wa_id) DO UPDATE SET product_label=excluded.product_label,asin=excluded.asin,search_term=excluded.search_term,job_id=excluded.job_id,
      status=excluded.status,reason=excluded.reason,format_wish=excluded.format_wish,source_message_id=excluded.source_message_id,updated_at=now()`,
    [digits(input.waId), input.productLabel.slice(0, 160), input.asin ?? null, input.searchTerm?.slice(0, 120) ?? null, input.jobId ?? null, status, input.reason ?? null,
      input.formatWish ?? null, input.messageId]);
  await log(db, input.messageId, "order", input.waId, { productLabel: input.productLabel, jobId: input.jobId, status, reason: input.reason });
}

// Outcome of the order started by exactly this message. A later order is never overwritten by an earlier one's result.
export async function settleActiveOrder(db: Sql, input: { waId: string; messageId: string; status: ActiveOrderStatus; jobId?: string | null; reason?: string | null;
  productLabel?: string | null; asin?: string | null }) {
  await db.query(`UPDATE whatsapp_active_context SET status=$3,job_id=COALESCE($4,job_id),reason=$5,product_label=COALESCE($6,product_label),
      asin=COALESCE($7,asin),updated_at=now() WHERE wa_id=$1 AND source_message_id=$2`,
    [digits(input.waId), input.messageId, input.status, input.jobId ?? null, input.reason ?? null, input.productLabel?.slice(0, 160) ?? null, input.asin ?? null]);
  await log(db, input.messageId, `outcome:${input.status}`, input.waId, input);
}

// A follow-up („Mach es trotzdem“) continues the active order under a new message id.
export async function resumeActiveOrder(db: Sql, order: ActiveOrder, messageId: string, formatWish: "image" | "reel" | null = null) {
  const updated = await db.query(`UPDATE whatsapp_active_context SET status='in_progress',reason=NULL,source_message_id=$3,format_wish=COALESCE($4,format_wish),updated_at=now()
    WHERE wa_id=$1 AND source_message_id=$2 RETURNING *`, [digits(order.waId), order.sourceMessageId, messageId, formatWish]);
  if (!updated.rows[0]) return null; // a concurrent message already changed the order
  await log(db, messageId, "resume", order.waId, { productLabel: order.productLabel, jobId: order.jobId, status: "in_progress" });
  return row(updated.rows[0]);
}

export async function noteFormatWish(db: Sql, order: ActiveOrder, messageId: string, formatWish: "image" | "reel") {
  await db.query("UPDATE whatsapp_active_context SET format_wish=$2,updated_at=now() WHERE wa_id=$1", [digits(order.waId), formatWish]);
  await log(db, messageId, `format:${formatWish}`, order.waId, { productLabel: order.productLabel, jobId: order.jobId, status: order.status });
}

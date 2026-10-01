import type { Sql } from "../memory/db";

// Everything the semantic router may see. Product names and captions are data, never instructions.
export type OpenItem = {
  draft_id: string; product: string; asin: string | null;
  stage: "content_approval" | "publication_approval";
  approval_message_id: string; waiting_since: string; caption_excerpt: string;
};
export type RouteContext = {
  now: string;
  replying_to: string | null; // draft_id of the open item the operator quoted, if any
  open_items: OpenItem[];
  recent_messages: { from: "operator" | "assistant"; text: string; at: string }[];
  recent_products: { product: string; asin: string | null; state: string; at: string }[];
  recent_instructions: { text: string; outcome: string; at: string }[];
};

const clip = (value: unknown, length: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);

export async function loadRouteContext(db: Sql, waId: string, currentMessageId: string, replyToMessageId: string | null): Promise<RouteContext> {
  const open = await db.query(`
    SELECT j.id,j.snapshot->'opportunity'->'product'->>'name' AS product,j.snapshot->'opportunity'->'product'->>'asin' AS asin,
      COALESCE(j.snapshot->'content'->>'caption',j.snapshot->'content'->>'body','') AS caption,
      d.whatsapp_message_id AS msg,d.updated_at AS since,'content_approval' AS stage
    FROM daily_drafts d JOIN content_jobs j ON j.id=d.job_id
    WHERE d.status IN ('awaiting_approval','changes_requested') AND d.whatsapp_message_id IS NOT NULL
      AND j.status='awaiting_approval' AND d.created_at>now()-interval '36 hours'
    UNION ALL
    SELECT j.id,j.snapshot->'opportunity'->'product'->>'name',j.snapshot->'opportunity'->'product'->>'asin',
      COALESCE(p.caption,''),p.whatsapp_message_id,p.updated_at,'publication_approval'
    FROM publication_requests p JOIN content_jobs j ON j.id=p.job_id
    WHERE p.platform='facebook' AND p.status IN ('pending','changes_requested') AND p.whatsapp_message_id IS NOT NULL
      AND p.publish_attempted_at IS NULL AND p.created_at>now()-interval '36 hours'
    ORDER BY since DESC LIMIT 5`);
  const open_items: OpenItem[] = open.rows.map(row => ({
    draft_id: String(row.id), product: clip(row.product, 120), asin: row.asin ? String(row.asin) : null,
    stage: row.stage as OpenItem["stage"], approval_message_id: String(row.msg),
    waiting_since: new Date(String(row.since)).toISOString(), caption_excerpt: clip(row.caption, 220),
  }));
  const messages = await db.query(`SELECT body,received_at FROM whatsapp_events
    WHERE wa_id=$1 AND message_id<>$2 AND body IS NOT NULL AND received_at>now()-interval '6 hours'
    ORDER BY received_at DESC LIMIT 8`, [waId, currentMessageId]);
  const replies = await db.query(`SELECT reply_text,created_at FROM whatsapp_chat_turns
    WHERE wa_id=$1 AND status='sent' AND created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 4`, [waId]);
  const recent_messages = [
    ...messages.rows.map(row => ({ from: "operator" as const, text: clip(row.body, 300), at: new Date(String(row.received_at)).toISOString() })),
    ...replies.rows.map(row => ({ from: "assistant" as const, text: clip(row.reply_text, 300), at: new Date(String(row.created_at)).toISOString() })),
    ...open_items.map(item => ({ from: "assistant" as const, text: `Freigabenachricht (${item.stage === "content_approval" ? "Inhalt" : "Veröffentlichung"}) zu „${item.product}“`, at: item.waiting_since })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(-14);
  const products = await db.query(`SELECT j.snapshot->'opportunity'->'product'->>'name' AS product,j.snapshot->'opportunity'->'product'->>'asin' AS asin,
      j.created_at,j.status,d.status AS draft_status,
      EXISTS(SELECT 1 FROM publication_requests p WHERE p.job_id=j.id AND p.status='published') AS published
    FROM content_jobs j LEFT JOIN daily_drafts d ON d.job_id=j.id
    WHERE j.created_at>now()-interval '7 days' ORDER BY j.created_at DESC LIMIT 15`);
  const recent_products = products.rows.map(row => ({
    product: clip(row.product, 100), asin: row.asin ? String(row.asin) : null, at: new Date(String(row.created_at)).toISOString(),
    state: row.published ? "veröffentlicht" : row.draft_status === "rejected" || row.status === "rejected" ? "abgelehnt"
      : row.draft_status === "needs_input" || row.status === "needs_input" || row.status === "failed" ? "abgebrochen/ersetzt"
      : row.status === "awaiting_approval" ? "wartet auf Freigabe" : String(row.status || "offen"),
  }));
  const instructions = await db.query(`SELECT e.body,i.status,i.error_code,i.created_at FROM whatsapp_instructions i
    JOIN whatsapp_events e ON e.message_id=i.message_id WHERE e.wa_id=$1 AND i.created_at>now()-interval '24 hours'
    ORDER BY i.created_at DESC LIMIT 3`, [waId]);
  const recent_instructions = instructions.rows.map(row => ({ text: clip(row.body, 200),
    outcome: clip(`${row.status}${row.error_code ? `:${row.error_code}` : ""}`, 60), at: new Date(String(row.created_at)).toISOString() }));
  const replying = replyToMessageId ? open_items.find(item => item.approval_message_id === replyToMessageId) : undefined;
  return { now: new Date().toISOString(), replying_to: replying?.draft_id ?? null, open_items, recent_messages, recent_products, recent_instructions };
}

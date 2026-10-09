import type { Sql } from "../memory/db";
import { cleanAmazonTitle } from "../product-resolver";
import { loadActiveOrder, type ActiveOrder } from "./active-context";

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
  focus: FocusProduct | null; // the product the operator is most plausibly talking about
  candidate_job_ids: string[];
  // The operator's latest explicit product order (persistent, see active-context.ts). Short follow-ups refer to it.
  active_order: ActiveOrderSummary | null;
};
export type ActiveOrderSummary = { product: string; status: string; reason: string | null; draft_id: string | null; format_wish: string | null; at: string };
const ORDER_STATE: Record<string, string> = { requested: "beauftragt", in_progress: "Entwurf wird erstellt", awaiting_approval: "Entwurf wartet auf Inhaltsfreigabe",
  blocked: "gestoppt", failed: "unterbrochen" };
export const orderState = (status: string) => ORDER_STATE[status] ?? status;
export type FocusProduct = {
  draft_id: string; source: "replying_to" | "active_order" | "single_open" | "latest_recent";
  product: string; asin: string | null; state: string;
  selection_basis: string[]; use_case_in_plan: string; caption_excerpt: string;
  verified_product_data: string[]; data_limits: string;
};

const clip = (value: unknown, length: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
// Product names come from Amazon titles: decode entities, repair casing, shorten at a word boundary.
export function tidyName(value: unknown, length = 70) {
  const name = cleanAmazonTitle(String(value ?? ""));
  if (name.length <= length) return name;
  const cut = name.slice(0, length), space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 30 ? space : length).replace(/[\s,;:–-]+$/, "")} …`;
}

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
    draft_id: String(row.id), product: tidyName(row.product), asin: row.asin ? String(row.asin) : null,
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
    product: tidyName(row.product, 60), asin: row.asin ? String(row.asin) : null, at: new Date(String(row.created_at)).toISOString(),
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
  const active = await loadActiveOrder(db, waId).catch(() => null);
  const focus = await resolveFocus(db, open_items, replyToMessageId, active);
  const active_order = active ? { product: tidyName(active.productLabel), status: active.status, reason: active.reason, draft_id: active.jobId,
    format_wish: active.formatWish, at: active.updatedAt } : null;
  return { now: new Date().toISOString(), replying_to: replying?.draft_id ?? null, open_items, recent_messages, recent_products, recent_instructions,
    focus, candidate_job_ids: open_items.map(item => item.draft_id), active_order };
}

const stateOf = (row: Record<string, unknown>, open: boolean) => open ? "wartet auf Freigabe"
  : row.published ? "veröffentlicht" : row.draft_status === "rejected" || row.status === "rejected" ? "abgelehnt"
  : row.draft_status === "needs_input" || row.status === "needs_input" || row.status === "failed" ? "gestoppt/ersetzt" : String(row.status || "offen");

// Which product do „dieses Produkt“, „das Bild“, „nochmal“ refer to? A quoted approval message wins
// (even if that draft is closed), then the active order's draft, then the only open draft, then the latest product of
// the last 6 hours. An active order that has no draft yet hides older drafts (no silent context switch); several open
// drafts without a quote or active order: no focus; the router must ask instead of guessing.
async function resolveFocus(db: Sql, open_items: OpenItem[], replyToMessageId: string | null, active: ActiveOrder | null = null): Promise<FocusProduct | null> {
  let jobId: string | null = null, source: FocusProduct["source"] = "latest_recent";
  if (replyToMessageId) {
    const quoted = await db.query(`SELECT job_id FROM daily_drafts WHERE whatsapp_message_id=$1
      UNION SELECT job_id FROM publication_requests WHERE whatsapp_message_id=$1
      UNION SELECT job_id FROM content_approval_requests WHERE whatsapp_message_id=$1 LIMIT 1`, [replyToMessageId]);
    if (quoted.rows[0]) { jobId = String(quoted.rows[0].job_id); source = "replying_to"; }
  }
  // The active order is the current topic while its draft is open or nothing newer arrived since. If it is still waiting
  // for its draft, no older draft becomes the focus (the router sees it as active_order).
  const current = !!active && (open_items.some(item => item.draft_id === active.jobId) || open_items.every(item => item.waiting_since <= active.updatedAt));
  if (!jobId && current && active!.jobId) { jobId = active!.jobId; source = "active_order"; }
  if (!jobId && current && ["requested", "in_progress", "blocked", "failed"].includes(active!.status)) return null;
  if (!jobId && open_items.length === 1) { jobId = open_items[0].draft_id; source = "single_open"; }
  if (!jobId && open_items.length > 1) return null;
  if (!jobId) {
    const latest = await db.query("SELECT id FROM content_jobs WHERE created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 1");
    if (!latest.rows[0]) return null;
    jobId = String(latest.rows[0].id);
  }
  const data = await db.query(`SELECT j.snapshot,j.status,d.status AS draft_status,d.scout_report,
      EXISTS(SELECT 1 FROM publication_requests p WHERE p.job_id=j.id AND p.status='published') AS published
    FROM content_jobs j LEFT JOIN daily_drafts d ON d.job_id=j.id WHERE j.id=$1`, [jobId]);
  const row = data.rows[0];
  if (!row) return null;
  const snapshot = row.snapshot as { opportunity?: { product?: Record<string, unknown>; useCase?: string; trend?: string; verifiedFacts?: { claim?: string }[] }; content?: { caption?: string; body?: string } };
  const product = snapshot.opportunity?.product || {};
  const asin = product.asin ? String(product.asin) : null;
  const basis: string[] = [];
  const report = row.scout_report as { requestedSearch?: string; requestedProduct?: string; report?: { candidates?: { kind?: string; whyNow?: string; reelIdea?: string; category?: string; resolvedProduct?: { asin?: string } }[] } } | null;
  if (report?.requestedSearch) basis.push(`Der Betreiber hat nach „${clip(report.requestedSearch, 80)}“ gesucht.`);
  if (report?.requestedProduct) basis.push("Das Produkt wurde vom Betreiber per ASIN oder Link vorgegeben.");
  const candidate = report?.report?.candidates?.find(item => item.resolvedProduct?.asin && item.resolvedProduct.asin === asin);
  if (candidate) basis.push(`Trendscout-Kandidat (${clip(candidate.kind, 30)}${candidate.category ? `, ${clip(candidate.category, 30)}` : ""})${candidate.whyNow ? `: ${clip(candidate.whyNow, 160)}` : ""}.`);
  if (snapshot.opportunity?.trend) basis.push(`Anlass laut Plan: ${clip(snapshot.opportunity.trend, 160)}`);
  if (!basis.length) basis.push("Ein gespeicherter Auswahlgrund liegt nicht vor.");
  return {
    draft_id: jobId, source, product: tidyName(product.name), asin, state: stateOf(row, open_items.some(item => item.draft_id === jobId)),
    selection_basis: basis, use_case_in_plan: clip(snapshot.opportunity?.useCase, 220),
    caption_excerpt: clip(snapshot.content?.caption ?? snapshot.content?.body, 260),
    verified_product_data: [`Titel der Amazon-Produktseite: ${tidyName(product.productVerifiedName ?? product.name, 160)}`, ...(asin ? [`ASIN ${asin}`] : []),
      ...(snapshot.opportunity?.verifiedFacts || []).slice(0, 6).map(fact => `Beleg: ${clip(fact.claim, 120)}`)],
    data_limits: "Geprüft wurden nur Titel und ASIN der Amazon-Produktseite. Bulletpoints, Beschreibung, Preis, Lieferumfang und Bilder sind nicht gespeichert; Eigenschaften darüber hinaus sind unbelegt.",
  };
}

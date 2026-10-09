import { createHash } from "node:crypto";
import type { Database, Sql } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { classifyWhatsAppReply } from "./intent";
import { loadActiveOrder, noteFormatWish, resumable, resumeActiveOrder, settleActiveOrder, startActiveOrder, type ActiveOrder } from "./active-context";

// Explicit operator product orders over WhatsApp („Erstelle einen Beitrag zum Roborock Qrevo Edge 2“, „Bewirb bitte
// trotzdem den Roborock“, „Mach es trotzdem“, „Nimm genau dieses Produkt“, „Ich möchte dieses Produkt bewerben“,
// „Mach daraus einen Reel-Entwurf“). Clear phrasings are recognised deterministically; everything else stays with the
// semantic router. An order is never an approval: content review, content approval and publication approval stay as
// they are; it only lets the operator's explicit wish override the TrendScout cooldown (see reserveMandatedProduct).

export type FormatWish = "image" | "reel" | null;
export type ManualOrder =
  | { kind: "named"; product: string; formatWish: FormatWish; anyway: boolean }
  | { kind: "referential"; formatWish: FormatWish };

const PRONOUN = /^(?:es|das|ihn|sie|den|die|dies(?:es|en|e)?|das\s+produkt|dieses\s+produkt|den\s+artikel|diesen\s+artikel|das\s+ding)$/i;
const NOT_A_PRODUCT = /^(?:thema\b|bild\b|text\b|foto\b|caption\b|beitrag\b|post\b|entwurf\b|kategorie\b|status\b)/i;
const formatOf = (word: string | undefined): FormatWish => !word ? null : /reel|video/i.test(word) ? "reel" : "image";

function productName(raw: string): string | null {
  const name = raw.trim().replace(/^(?:dem|der|den|das|die|einem|einen|einer)\s+/i, "").replace(/\s+(?:bitte|trotzdem|doch|jetzt)$/i, "").trim();
  if (name.length < 3 || name.length > 80 || name.split(/\s+/).length > 10) return null;
  if (PRONOUN.test(name) || NOT_A_PRODUCT.test(name) || /https?:\/\/|www\./i.test(name)) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N}\s.,+&/'’-]*$/u.test(name) ? name : null;
}

export function manualOrderCommand(body: string): ManualOrder | null {
  if (body.includes("?")) return null; // questions never start an order
  if (classifyWhatsAppReply(body).intent !== "changes_requested") return null; // approval words keep their meaning
  const text = body.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  if (text.length > 160) return null;
  const anyway = /\btrotzdem\b/i.test(text);
  // Referential follow-ups: resolved against the active order.
  if (/^(?:bitte\s+)?(?:mach|mache|erstelle|erstell)\s+(?:es|das|ihn|den\s+auftrag|den\s+beitrag)\s+(?:bitte\s+)?(?:doch\s+)?trotzdem(?:\s+bitte)?$/i.test(text)
    || /^(?:bitte\s+)?trotzdem(?:\s+(?:machen|bewerben|erstellen))?(?:\s+bitte)?$/i.test(text)
    || /^(?:bitte\s+)?bewirb\s+(?:es|ihn|sie|das|das\s+produkt|dieses\s+produkt)\s+(?:bitte\s+)?trotzdem$/i.test(text)
    || /^(?:bitte\s+)?nimm\s+(?:bitte\s+)?(?:genau|doch)\s+(?:dieses|das|den|diesen)(?:\s+(?:produkt|artikel))?$/i.test(text)
    || /^ich\s+(?:möchte|will|würde\s+gern[e]?)\s+(?:gern[e]?\s+)?(?:dieses|das|den)\s+(?:produkt|artikel)\s+bewerben$/i.test(text)) {
    return { kind: "referential", formatWish: null };
  }
  const derived = text.match(/^(?:bitte\s+)?(?:mach|mache|erstelle|erstell)\s+(?:mir\s+)?daraus\s+(?:bitte\s+)?(?:einen?|ein)\s+(reel(?:-entwurf)?|video|bildpost|beitrag|post)(?:-entwurf|\s+entwurf)?$/i);
  if (derived) return { kind: "referential", formatWish: formatOf(derived[1]) };
  // Named orders.
  const create = text.match(/^(?:bitte\s+)?(?:erstelle|erstell|mach|mache|schreib|schreibe)\s+(?:mir\s+)?(?:bitte\s+)?(?:einen?|ein)\s+(?:neuen?\s+)?(beitrag|post|bildpost|entwurf|reel(?:-entwurf)?|video)\s+(?:zum|zur|zu|über|für|mit)\s+(.+)$/i);
  if (create) { const product = productName(create[2]); return product ? { kind: "named", product, formatWish: formatOf(create[1]), anyway } : null; }
  const promote = text.match(/^(?:bitte\s+)?bewirb\s+(?:bitte\s+)?(?:doch\s+)?(?:trotzdem\s+)?(.+)$/i);
  if (promote) { const product = productName(promote[1]); return product ? { kind: "named", product, formatWish: null, anyway } : null; }
  const wish = text.match(/^ich\s+(?:möchte|will|würde\s+gern[e]?)\s+(?:gern[e]?\s+)?(?:trotzdem\s+)?(.+?)\s+bewerben$/i);
  if (wish) { const product = productName(wish[1]); return product ? { kind: "named", product, formatWish: null, anyway } : null; }
  return null;
}

type DraftResult = { status: string; jobId?: string; reason?: string; whatsapp?: string; reviewIssues?: string[] };
export type ManualOrderDeps = {
  database: () => Database; // resolved only when the message is an order
  start: (day: string, slot: string, productQuery?: string, productSearch?: string, options?: { mandate?: boolean }) => Promise<DraftResult>;
  send?: typeof sendWhatsAppText;
};

const berlinDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const short = (label: string) => label.length > 60 ? `${label.slice(0, 57).replace(/\s+\S*$/, "")} …` : label;

// Operator-facing explanation of a stopped order: understandable, no internal details.
export function orderFailureText(reason: string | undefined): string {
  switch (reason) {
    case "product_already_open": return "Für genau dieses Produkt läuft bereits ein Entwurf oder eine Veröffentlichung. Ich lege keinen zweiten parallel an; antworte auf dessen Freigabenachricht oder schreibe „Status“.";
    case "product_repeat_blocked": return "Kein passendes Produkt war verfügbar.";
    case "product_unresolved": return "Ich konnte dazu keine sicher geprüfte Amazon-Produktseite finden. Nenne bitte den genauen Produktnamen oder sende den Amazon-Link.";
    case "amazon_verification_blocked": return "Amazon hat die automatische Prüfung der Produktseite blockiert; ohne geprüfte Seite erstelle ich keinen Entwurf.";
    case "amazon_identity_missing": return "Die Amazon-Seite enthielt keinen eindeutigen Nachweis für dieses Produkt. Bitte den direkten Amazon.de/dp/-Link senden.";
    case "product_data_uncertain": return "Die Produktdaten belegen die geplanten Aussagen nicht; ich rate nicht und erzeuge keinen Entwurf.";
    case "content_review_failed": return "Auch nach Überarbeitung lag kein freigabefähiger Entwurf vor; die Inhaltsprüfung hat ihn gestoppt.";
    case "missing_caption": return "Der Beitragstext fehlte; die Inhaltsprüfung hat den Entwurf gestoppt.";
    default: return "Die Planung wurde unterbrochen. Schreibe „Status“ für den Stand.";
  }
}

// Records the outcome of a draft run on the active order started by exactly this message.
export async function settleOrderFromDraft(db: Sql, waId: string, messageId: string, result: DraftResult) {
  if (result.status === "already_claimed") return;
  let productLabel: string | null = null, asin: string | null = null;
  if (result.jobId) {
    const job = (await db.query("SELECT opportunity->'product'->>'name' AS name, opportunity->'product'->>'asin' AS asin FROM content_jobs WHERE id=$1", [result.jobId]).catch(() => ({ rows: [] }))).rows[0];
    productLabel = job?.name ? String(job.name) : null; asin = job?.asin ? String(job.asin) : null;
  }
  const status = result.status === "awaiting_approval" ? "awaiting_approval" : result.status === "failed" ? "failed" : "blocked";
  await settleActiveOrder(db, { waId, messageId, status, jobId: result.jobId ?? null, reason: result.reason ?? null, productLabel, asin });
}

function sameProduct(order: ActiveOrder, name: string) {
  const a = order.productLabel.toLocaleLowerCase("de-DE"), b = name.toLocaleLowerCase("de-DE");
  return a.includes(b) || b.includes(a) || (!!order.searchTerm && order.searchTerm.toLocaleLowerCase("de-DE").includes(b));
}

async function openDrafts(db: Sql) {
  const rows = await db.query(`SELECT j.opportunity->'product'->>'name' AS name FROM daily_drafts d JOIN content_jobs j ON j.id=d.job_id
    WHERE d.status IN ('awaiting_approval','changes_requested') AND j.status='awaiting_approval' AND d.created_at>now()-interval '36 hours'
    ORDER BY d.updated_at DESC LIMIT 3`);
  return rows.rows.map(row => String(row.name ?? ""));
}

async function run(input: IncomingWhatsAppMessage, order: ActiveOrder, deps: ManualOrderDeps & { db: Database }, send: typeof sendWhatsAppText, intro: string) {
  await send(intro);
  const slot = `manual:${createHash("sha256").update(input.id).digest("hex")}`;
  let result: DraftResult;
  try { result = await deps.start(berlinDay(), slot, order.asin ?? undefined, order.asin ? undefined : order.searchTerm ?? order.productLabel, { mandate: true }); }
  catch (error) {
    await settleActiveOrder(deps.db, { waId: input.from, messageId: input.id, status: "failed", reason: "planning_error" });
    console.error(JSON.stringify({ event: "manual_order_failed", messageId: input.id, failureType: error instanceof Error ? error.name : "unknown" }));
    await send(`Der Auftrag „${short(order.productLabel)}“ wurde unterbrochen. ${orderFailureText(undefined)} Es wurde nichts veröffentlicht.`);
    return true;
  }
  await settleOrderFromDraft(deps.db, input.from, input.id, result);
  if (result.status === "failed" || result.status === "needs_input") {
    await send(`Auftrag „${short(order.productLabel)}“: ${orderFailureText(result.reason)} Kein Bild gekauft und nichts veröffentlicht. Der Auftrag bleibt aktiv; nach einer Klärung genügt „Mach es trotzdem“.`);
  } else if (result.status === "awaiting_approval" && result.whatsapp !== "approval_sent") {
    await send(`Der Entwurf zu „${short(order.productLabel)}“ ist gespeichert, die Freigabenachricht konnte noch nicht zugestellt werden. Schreibe „Status“, dann sende ich sie. Nichts veröffentlicht.`);
  }
  // awaiting_approval with approval_sent: the content approval message itself is the confirmation.
  return true;
}

// Returns true when the message was handled as a manual order (or as an order follow-up).
export async function handleManualOrder(input: IncomingWhatsAppMessage & { payload: unknown }, deps: ManualOrderDeps): Promise<boolean> {
  const trusted = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!trusted || input.from.replace(/\D/g, "") !== trusted) return false;
  if (input.replyToMessageId) return false; // quoted messages keep their existing, more specific meaning
  const command = manualOrderCommand(input.body);
  if (!command) return false;
  const db = deps.database(), send = deps.send ?? sendWhatsAppText;
  await ensureAutomationSchema(db);
  const active = await loadActiveOrder(db, trusted);
  // Referential follow-up without an active order: only answered here when it is genuinely ambiguous (several open
  // drafts); otherwise the existing chain decides as before.
  if (command.kind === "referential" && !active) {
    const open = await openDrafts(db);
    if (open.length < 2) return false;
    if (!await claimMessage(db, input)) return true;
    await send(`Welches Produkt meinst du? ${open.map(name => `„${short(name)}“`).join(" oder ")}. Nenne es bitte, z. B. „Erstelle einen Beitrag zum ${short(open[0])}“, oder antworte direkt auf dessen Freigabenachricht. Es wurde nichts gestartet.`);
    return true;
  }
  // Idempotent: a redelivered webhook never starts a second order.
  if (!await claimMessage(db, input)) return true;
  const target = command.kind === "referential" ? active! : active && sameProduct(active, command.product) ? active : null;
  const formatWish = command.formatWish;
  if (formatWish === "reel") {
    // Reels need their own planning and cost approval in the studio; nothing is started from here.
    const label = target?.productLabel ?? (command.kind === "named" ? command.product : null);
    if (target) await noteFormatWish(db, target, input.id, "reel");
    else if (command.kind === "named") await startActiveOrder(db, { waId: trusted, messageId: input.id, productLabel: command.product, searchTerm: command.product, formatWish: "reel", status: "requested" });
    await send(`Reel-Wunsch für „${short(label ?? "das Produkt")}“ notiert. Einen Reel-Entwurf kann ich per WhatsApp noch nicht anlegen (Videos brauchen eine eigene Planung und Kostenfreigabe im Studio). Es wurde nichts gestartet. Für einen Bildpost-Entwurf zu diesem Produkt schreibe „Mach es trotzdem“.`);
    return true;
  }
  if (target) {
    // The stored state can be outdated (draft since rejected, approved or published): the draft itself decides.
    const draftOpen = target.jobId ? (await db.query(`SELECT 1 FROM content_jobs j WHERE j.id=$1 AND j.status='awaiting_approval'
      AND NOT EXISTS(SELECT 1 FROM daily_drafts d WHERE d.job_id=j.id AND d.status IN ('rejected','needs_input','failed'))`, [target.jobId])).rows.length > 0 : false;
    if (target.status === "awaiting_approval" && draftOpen) {
      await send(`Der Entwurf zu „${short(target.productLabel)}“ wartet bereits auf deine Inhaltsfreigabe. Antworte direkt auf die Freigabenachricht mit „Freigeben“ oder sage, was geändert werden soll. Ich lege keinen zweiten Entwurf an.`);
      return true;
    }
    if (!resumable(target) && !(target.status === "awaiting_approval" && !draftOpen)) {
      await send(`Der Auftrag „${short(target.productLabel)}“ läuft bereits; ich starte ihn nicht doppelt. Die Inhaltsfreigabe kommt, sobald der Entwurf fertig ist.`);
      return true;
    }
    const resumed = await resumeActiveOrder(db, target, input.id, formatWish);
    if (!resumed) { await send("Gerade kam ein neuerer Auftrag dazwischen. Schreibe „Status“ für den aktuellen Stand; es wurde nichts doppelt gestartet."); return true; }
    const note = target.reason === "product_repeat_blocked" || command.kind === "named" && command.anyway
      ? " Die 7-Tage-Sperre gilt nur für automatische Vorschläge; dein ausdrücklicher Auftrag hat Vorrang." : "";
    return run(input, resumed, { ...deps, db }, send, `Ich setze den Auftrag „${short(target.productLabel)}“ fort und erstelle jetzt den Entwurf.${note} Danach bekommst du wie gewohnt die Inhaltsfreigabe; es wurde nichts veröffentlicht.`);
  }
  if (command.kind === "referential") return false; // unreachable: referential without active order returned above
  await startActiveOrder(db, { waId: trusted, messageId: input.id, productLabel: command.product, searchTerm: command.product, formatWish });
  const order = await loadActiveOrder(db, trusted);
  if (!order || order.sourceMessageId !== input.id) { await send("Gerade kam ein neuerer Auftrag dazwischen. Schreibe „Status“ für den aktuellen Stand."); return true; }
  return run(input, order, { ...deps, db }, send, `Ich habe den Auftrag „${short(command.product)}“ übernommen und erstelle jetzt den Entwurf. Ein ausdrücklicher Auftrag hat Vorrang vor der 7-Tage-Sperre des Trendscouts; Prüfungen und Freigaben bleiben unverändert. Es wurde nichts veröffentlicht.`);
}

async function claimMessage(db: Sql, input: IncomingWhatsAppMessage & { payload: unknown }) {
  const claim = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)]);
  return claim.rows.length > 0;
}

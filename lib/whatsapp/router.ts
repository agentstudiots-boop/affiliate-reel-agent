import { getDatabase, type Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { classifyWhatsAppReply } from "./intent";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { loadRouteContext, type OpenItem, type RouteContext } from "./route-context";
import { interpretMessage, routeSchema, RouterUnavailable, type Route } from "./route-llm";
import { imagePostCommand } from "./start-image-post";
import { operatorProductLink } from "./product-link";

export type Message = IncomingWhatsAppMessage & { payload: unknown };
// handled: the router answered or delegated completely. rewritten: continue the existing gated chain
// with the resolved target (quoted approval message) and skip the keyword stages in front of it.
export type RouterResult = { handled: true } | { handled: false; message?: Message; skipKeywordStages?: boolean };

export type RouterDeps = {
  database?: Database;
  interpret?: typeof interpretMessage;
  send?: typeof sendWhatsAppText;
  searchProduct: (input: Message, request: { search: string | null; replaceDraftId: string | null; replace: boolean; note: string | null }) => Promise<boolean>;
  converse: (input: Message, facts: string) => Promise<boolean>;
};

// Literal gate words keep their exact, deterministic meaning and never reach the model.
const LITERAL = /^(?:status|weiter|entwurf|wochenbilanz)[.!?]*$/i;
export const isLiteralGate = (body: string) => LITERAL.test(body.trim()) || classifyWhatsAppReply(body).intent !== "changes_requested";

const time = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const stage = (item: OpenItem) => item.stage === "content_approval" ? "Inhaltsfreigabe" : "Veröffentlichungsfreigabe";

export function systemFacts(context: RouteContext) {
  const open = context.open_items.map(item => `- „${item.product}“${item.asin ? ` (ASIN ${item.asin})` : ""}: wartet seit ${time(item.waiting_since)} Uhr auf die ${stage(item)}`).join("\n") || "- nichts offen";
  const recent = context.recent_products.slice(0, 10).map(item => `- ${item.product}${item.asin ? ` (${item.asin})` : ""}: ${item.state}`).join("\n") || "- keine";
  const focus = context.focus ? `Besprochenes Produkt (${context.focus.source}): „${context.focus.product}“${context.focus.asin ? ` (ASIN ${context.focus.asin})` : ""}, Zustand: ${context.focus.state}.\nAuswahlgrund: ${context.focus.selection_basis.join(" ")}\nIm Plan vorgesehene Anwendung: ${context.focus.use_case_in_plan || "–"}\nBelegte Produktdaten: ${context.focus.verified_product_data.join("; ")}\n${context.focus.data_limits}\n` : "";
  return `${focus}Offene Freigaben:\n${open}\nProdukte der letzten 7 Tage:\n${recent}\nProdukte dürfen innerhalb von 7 Tagen nicht erneut automatisch vorgeschlagen werden; abgelehnte oder ersetzte Produkte bleiben ebenfalls gesperrt.`;
}

export function statusText(context: RouteContext) {
  if (!context.open_items.length) {
    const last = context.recent_products.slice(0, 3).map(item => `${item.product}: ${item.state}`).join("; ");
    return `Gerade wartet nichts auf deine Freigabe.${last ? ` Zuletzt: ${last}.` : ""} Schreibe „Status“ für die Liste der letzten Aufträge oder nenne mir ein Produkt, das ich suchen soll.`;
  }
  return `Offen:\n${context.open_items.map(item => `• „${item.product}“ – ${stage(item)} seit ${time(item.waiting_since)} Uhr. Antworte direkt auf die Freigabenachricht mit „Freigeben“ oder „Ablehnen“.`).join("\n")}`;
}

function target(route: Route, context: RouteContext): { item: OpenItem | null; ambiguous: boolean } {
  const byId = (id: string | null) => context.open_items.find(item => item.draft_id === id) ?? null;
  const chosen = byId(route.draft_id) ?? byId(context.replying_to);
  if (chosen) return { item: chosen, ambiguous: false };
  if (context.open_items.length === 1) return { item: context.open_items[0], ambiguous: false };
  return { item: null, ambiguous: context.open_items.length > 1 };
}

function whichQuestion(context: RouteContext) {
  return `Welchen Entwurf meinst du? ${context.open_items.slice(0, 3).map(item => `„${item.product.slice(0, 70)}“ (${stage(item)})`).join(" oder ")}. Antworte direkt auf dessen Freigabenachricht oder nenne das Produkt. Es wurde nichts geändert.`;
}

function log(event: Record<string, unknown>) { console.info(JSON.stringify({ event: "whatsapp_route", ...event })); }

export async function routeOperatorMessage(input: Message, deps: RouterDeps): Promise<RouterResult> {
  const trusted = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!trusted || input.from.replace(/\D/g, "") !== trusted) return { handled: false };
  if (isLiteralGate(input.body)) return { handled: false };
  // Explicit, unambiguous commands and product links keep their deterministic, already tested path.
  if (!input.replyToMessageId && (imagePostCommand(input.body) || operatorProductLink(input.body))) return { handled: false };
  const db = deps.database ?? getDatabase();
  const send = deps.send ?? sendWhatsAppText;
  await ensureAutomationSchema(db);
  // Replies to a cost approval belong to the production gate.
  if (input.replyToMessageId) {
    const cost = await db.query("SELECT 1 FROM approval_requests WHERE whatsapp_message_id=$1 LIMIT 1", [input.replyToMessageId]);
    if (cost.rows.length) return { handled: false };
  }
  const context = await loadRouteContext(db, trusted, input.id, input.replyToMessageId);
  const saved = await db.query("SELECT route,action FROM whatsapp_routes WHERE message_id=$1", [input.id]);
  let route: Route;
  if (saved.rows[0]) {
    const parsed = routeSchema.safeParse(saved.rows[0].route);
    if (!parsed.success) return { handled: false };
    route = parsed.data;
    if (["answered", "clarified", "guided"].includes(String(saved.rows[0].action))) return { handled: true }; // webhook replay
  } else {
    try { route = await (deps.interpret ?? interpretMessage)(input.body, context); }
    catch (error) {
      // Without a usable interpretation the existing keyword chain stays the safe fallback.
      log({ stage: "interpret_failed", reason: error instanceof RouterUnavailable ? error.message : "unknown", raw_message: input.body.slice(0, 300) });
      return { handled: false };
    }
    await db.query("INSERT INTO whatsapp_routes(message_id,wa_id,raw_message,route,context_summary) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [input.id, trusted, input.body.slice(0, 1500), JSON.stringify(route), JSON.stringify({ open_items: context.open_items.map(item => ({ id: item.draft_id, stage: item.stage })),
        replying_to: context.replying_to, recent_message_count: context.recent_messages.length, recent_product_count: context.recent_products.length })]);
  }
  const mark = (action: string) => db.query("UPDATE whatsapp_routes SET action=$2 WHERE message_id=$1", [input.id, action]);
  const reply = async (text: string, action: string) => {
    const claimed = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
      [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)]);
    await mark(action);
    if (claimed.rows.length) await send(text);
    return { handled: true as const };
  };
  const { item, ambiguous } = target(route, context);
  const base = { raw_message: input.body.slice(0, 300), normalized_message: input.body.trim().replace(/\s+/g, " ").slice(0, 300), wa_message_id: input.id,
    active_content_id: item?.draft_id ?? null, active_state: item?.stage ?? (context.open_items.length ? "multiple_open" : "idle"),
    inbound_message_id: input.id, reply_to_message_id: input.replyToMessageId, resolved_job_id: context.focus?.draft_id ?? item?.draft_id ?? null,
    resolved_content_id: context.focus?.draft_id ?? item?.draft_id ?? null, resolved_product_name: context.focus?.product ?? item?.product ?? null,
    asin: context.focus?.asin ?? item?.asin ?? null, focus_source: context.focus?.source ?? null, candidate_job_ids: context.candidate_job_ids,
    context_fields_supplied: ["open_items", "recent_messages", "recent_products", "recent_instructions", ...(context.focus ? ["focus"] : [])],
    open_items: context.open_items.length, intent: route.intent, search_query: route.search_query, reject_current: route.reject_current,
    confidence: route.confidence, ambiguity: route.ambiguity };

  if ((route.confidence < 0.5 || route.ambiguity === "high") && route.intent !== "question" && route.intent !== "chitchat" && route.intent !== "status") {
    log({ ...base, action: "clarify_low_confidence" });
    return reply(route.clarification_question?.trim() || (context.open_items.length ? whichQuestion(context) : "Das habe ich nicht eindeutig verstanden. Was soll ich tun: ein Produkt suchen, Bild oder Text ändern oder etwas erklären? Es wurde nichts geändert."), "clarified");
  }

  switch (route.intent) {
    case "search_product": {
      const replace = route.reject_current && context.open_items.length > 0;
      if (replace && !item) { log({ ...base, action: "clarify_target" }); return reply(whichQuestion(context), "clarified"); }
      log({ ...base, action: replace ? "replace_product" : "search_product", pipeline: "product_search" });
      await mark(replace ? "replace_product" : "search_product");
      await deps.searchProduct(input, { search: route.search_query?.trim() || null, replaceDraftId: replace ? item!.draft_id : null, replace, note: route.operator_note });
      return { handled: true };
    }
    case "revise_image": case "revise_text": case "revise_both": {
      if (!item) { log({ ...base, action: ambiguous ? "clarify_target" : "no_open_item" });
        return reply(ambiguous ? whichQuestion(context) : "Dazu gibt es gerade keinen offenen Entwurf. Nenne mir ein Produkt, das ich suchen soll, dann schicke ich dir eine neue Inhaltsfreigabe. Es wurde nichts geändert.", "clarified"); }
      log({ ...base, action: "revise_existing", pipeline: "instruction" });
      await mark("revise_existing");
      return { handled: false, message: { ...input, replyToMessageId: item.approval_message_id }, skipKeywordStages: true };
    }
    case "reject_current": {
      if (!item) { log({ ...base, action: ambiguous ? "clarify_target" : "no_open_item" });
        return reply(ambiguous ? whichQuestion(context) : "Es wartet gerade nichts auf deine Freigabe, das ich ablehnen könnte.", "clarified"); }
      log({ ...base, action: "reject_via_gate", pipeline: "approval_gate" });
      await mark("reject_via_gate");
      return { handled: false, message: { ...input, body: "Ablehnen", replyToMessageId: item.approval_message_id }, skipKeywordStages: true };
    }
    case "approve_attempt":
      log({ ...base, action: "guide_explicit_approval" });
      return reply(item ? `Freigaben gebe ich nur auf ein ausdrückliches „Freigeben“. Antworte direkt auf die Freigabenachricht zu „${item.product.slice(0, 70)}“ mit „Freigeben“ oder sage mir, was geändert werden soll.`
        : "Es wartet gerade nichts auf deine Freigabe. Freigaben gebe ich nur auf ein ausdrückliches „Freigeben“ als Antwort auf die Freigabenachricht.", "guided");
    case "status":
      log({ ...base, action: "status_answer" });
      return reply(statusText(context), "answered");
    case "clarify":
      log({ ...base, action: "clarify" });
      return reply(route.clarification_question?.trim() || whichQuestion(context), "clarified");
    default: { // question | chitchat: answered in the same model call from the supplied facts, never starts a pipeline
      const answer = route.answer?.trim();
      if (answer && answer.length >= 10) {
        log({ ...base, action: "answer_inline", answer_status: "answered_inline" });
        return reply(answer.slice(0, 1500), "answered");
      }
      log({ ...base, action: "converse", pipeline: "conversation", answer_status: "fallback_chat", abort_reason: "no_inline_answer" });
      await mark("converse");
      await deps.converse(input, systemFacts(context));
      return { handled: true };
    }
  }
}

import { randomUUID } from "node:crypto";
import type { Generator } from "../content/agent";
import { loadSelectionHistory } from "../content/selection-history";
import { buildMasterContent, type AffiliateData, type MasterContent } from "../distribution/master-content";
import { PLATFORM_ADAPTERS, type PlatformVariant } from "../distribution/platforms/adapters";
import { liveTopicPublishingEnabled, publishAll, publishableContent, reconcilePublishing, storedOutcomes, type PlatformPublisher, type PublishOutcome, type PublishRun } from "../distribution/publish";
import { activePlatforms } from "../capabilities";
import { FORMAT_LABEL, PLATFORM_LABEL, type Platform } from "../formats/catalog";
import { emptyOverride, hasOverride, mergeOverrides, type FormatOverride } from "../formats/override";
import { interpretTopicMessage, type TopicRoute, type TopicRouteContext } from "../whatsapp/topic-route";
import { RouterUnavailable } from "../whatsapp/route-llm";
import { loadRouteContext } from "../whatsapp/route-context";
import { overrideFromTopicRoute } from "./instructions";
import { decideFormat, type FormatDecision } from "../formats/router";
import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { emitEvent } from "../observability/events";
import { ApprovalDecisionError, bindApprovalRequest, contentIdForRequestMessage, invalidateApprovals, recordApprovalDecision, registerContentVersion } from "../publishing/approval-gate";
import { formatPublishReport, type ReportFormat } from "../publishing/report";
import { discoverTopic } from "../topics/discovery";
import { topicGate } from "../topics/gate";
import { claimTopicRun, loadTopicHistory, recordTopicHistory, saveTopicRun } from "../topics/repository";
import { buildCandidate, type ScoutOptions } from "../topics/scout";
import type { RawSignal, ScoutResult, TopicCandidate } from "../topics/schema";
import { classifyWhatsAppReply } from "../whatsapp/intent";
import { providerAvailability } from "../visual/availability";
import { produceContent } from "../visual/engine";
import { blobRasterizer, type Rasterizer } from "../visual/rasterize";
import { createStyleBrief } from "../visual/style";
import type { RenderContext } from "../visual/renderers";
import type { ProductionResult } from "../visual/types";
import { writeTopicCopy, type TopicCopy } from "./copy";
import { productSuggestionsText, proposalText, publishApprovalText } from "./messages";
import { closeRoute } from "../trendsetter/repository";
import { jarvisSelectTopic } from "../trendsetter/topic";
import { productCouplingBlocked, productListCommand, productSelection, suggestProducts, type ProductState, type ProductSuggester } from "./product-coupling";

// The only module that connects topic scout, Jarvis gate, format router, visual engine, master content, platform
// adapters, the publish gate and WhatsApp. Stages:
//   proposed ──„Freigeben“──▶ producing/in_production ──▶ awaiting_publish_approval ──„Freigeben“──▶ publishing ──▶ report
// The first „Freigeben“ approves production costs only. Publishing needs a second, separate approval of exactly the
// produced version (central publish gate). Every change creates a new version and a new approval request.

export const MAX_MODEL_CALLS_PER_CONTENT = 4;

export type TopicPipelineDeps = {
  db: Database;
  send: (text: string) => Promise<string>;
  trustedWaId: string;
  render: RenderContext;
  now?: () => Date;
  scout?: (options: ScoutOptions) => Promise<ScoutResult>;
  scoutOptions?: Partial<ScoutOptions>;
  generate?: Generator | null;
  publishers?: PlatformPublisher[];
  suggester?: ProductSuggester | null;
  resolveProduct?: ((query: string) => Promise<{ name: string; asin: string; affiliateUrl: string; sourceUrl: string } | null>) | null;
  platforms?: Platform[];
  rasterize?: Rasterizer;
  liveEnabled?: boolean;
  // Semantic understanding of free messages (existing router transport). Injected in tests.
  interpret?: (body: string, context: TopicRouteContext) => Promise<TopicRoute>;
};

type Stage = "proposed" | "producing" | "in_production" | "awaiting_publish_approval" | "publishing" | "published" | "partially_published" | "not_published" | "rejected" | "discarded" | "failed";
// chance_id: the Trendsetter chance Jarvis routed to this content (absent for rows created before the Trendsetter).
type StoredCandidate = { candidate: TopicCandidate; cluster: { title: string; signals: RawSignal[] } | null; variant: number; chance_id?: string };
export type TopicContentRow = {
  content_id: string; run_id: string | null; topic_id: string; category: "topic" | "affiliate"; stage: Stage; format: string; revision: number;
  candidate: StoredCandidate; decision: FormatDecision | null; override: FormatOverride; copy: TopicCopy | null; production: ProductionResult | null;
  master: { master: MasterContent; variants: PlatformVariant[]; version: number } | null; product: ProductState;
  proposal_message_id: string | null; product_message_id: string | null; model_calls: number; last_error: string | null;
};

const now = (deps: TopicPipelineDeps) => (deps.now ?? (() => new Date()))();
// Activated platforms come from the central capability check (TOPIC_PLATFORMS); deps can only narrow them.
const platformsOf = (deps: TopicPipelineDeps) => deps.platforms ? deps.platforms.filter(platform => activePlatforms().includes(platform)) : activePlatforms();
// Live publishing only with TOPIC_LIVE_PUBLISHING=true; deps.liveEnabled can switch it off, never on.
const liveFor = (deps: TopicPipelineDeps) => deps.liveEnabled !== false && liveTopicPublishingEnabled();

async function load(db: Database, contentId: string): Promise<TopicContentRow | null> {
  const row = (await db.query("SELECT * FROM topic_contents WHERE content_id=$1", [contentId])).rows[0];
  return row ? (row as unknown as TopicContentRow) : null;
}
async function rememberOutdated(db: Database, contentId: string, messageId: string) {
  await db.query("UPDATE topic_contents SET previous_message_ids=previous_message_ids||$2::jsonb WHERE content_id=$1 AND NOT previous_message_ids ? $3",
    [contentId, JSON.stringify([messageId]), messageId]);
}

async function save(db: Database, row: TopicContentRow) {
  await db.query(`INSERT INTO topic_contents(content_id,run_id,topic_id,category,stage,format,revision,candidate,decision,override,copy,production,master,product,proposal_message_id,product_message_id,model_calls,last_error)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (content_id) DO UPDATE SET category=EXCLUDED.category, stage=EXCLUDED.stage, format=EXCLUDED.format, revision=EXCLUDED.revision, candidate=EXCLUDED.candidate,
      decision=EXCLUDED.decision, override=EXCLUDED.override, copy=EXCLUDED.copy, production=EXCLUDED.production, master=EXCLUDED.master, product=EXCLUDED.product,
      proposal_message_id=EXCLUDED.proposal_message_id, product_message_id=EXCLUDED.product_message_id, model_calls=EXCLUDED.model_calls, last_error=EXCLUDED.last_error, updated_at=now()`,
  [row.content_id, row.run_id, row.topic_id, row.category, row.stage, row.format, row.revision, JSON.stringify(row.candidate), JSON.stringify(row.decision), JSON.stringify(row.override),
    JSON.stringify(row.copy), row.production ? JSON.stringify(row.production) : null, row.master ? JSON.stringify(row.master) : null, JSON.stringify(row.product),
    row.proposal_message_id, row.product_message_id, row.model_calls, row.last_error]);
}

// Outcome of the Trendsetter route of this content (time lock / duplicate control). Never blocks the reply itself.
async function closeTopicRoute(deps: TopicPipelineDeps, row: TopicContentRow, status: "published" | "rejected") {
  const chanceId = row.candidate.chance_id;
  if (!chanceId) return;
  await closeRoute(deps.db, { chanceId, pipeline: "topic", status, ref: row.content_id })
    .catch(() => emitEvent("trendsetter_unavailable", { stage: "close_route", contentId: row.content_id }, "warn"));
}

// ---------- proposal ----------
// Router decision, copy and a dry-run production plan (no provider call, no cost).
async function plan(deps: TopicPipelineDeps, row: TopicContentRow): Promise<TopicContentRow & { decision: FormatDecision; copy: TopicCopy }> {
  const candidate = row.candidate.candidate;
  const availability = await providerAvailability(deps.render, now(deps));
  const decision = decideFormat({ topic: candidate, platforms: platformsOf(deps), availability, override: row.override });
  let copy = row.copy;
  let modelCalls = row.model_calls;
  if (!copy) {
    const written = await writeTopicCopy(candidate, { generate: modelCalls < MAX_MODEL_CALLS_PER_CONTENT ? deps.generate ?? null : null, override: row.override });
    copy = written.copy; modelCalls += written.modelCalls;
  }
  const production = await produceContent({ contentId: row.content_id, format: decision.format, exclude: row.override.exclude, slides: decision.slides, copy, style: styleFor(row),
    dryRun: true, visualPotential: candidate.visual_potential }, deps.render);
  return { ...row, decision, copy, model_calls: modelCalls, production, format: production.producedFormat, override: { ...row.override, newHook: false, newTopic: false } };
}

async function propose(deps: TopicPipelineDeps, row: TopicContentRow, note: string | null = null): Promise<TopicContentRow> {
  const planned = await plan(deps, row);
  const candidate = planned.candidate.candidate;
  const messageId = await deps.send(proposalText({ candidate, decision: planned.decision, copy: planned.copy, production: planned.production, revision: row.revision,
    product: row.product.status === "selected" ? { status: "selected", name: row.product.product.name } : { status: row.product.status }, note }));
  const updated: TopicContentRow = { ...planned, stage: "proposed", proposal_message_id: messageId };
  await save(deps.db, updated);
  if (row.proposal_message_id && row.proposal_message_id !== messageId) await rememberOutdated(deps.db, row.content_id, row.proposal_message_id);
  await recordTopicHistory(deps.db, candidate, "proposed", `${row.content_id}:${row.revision}`);
  emitEvent("topic_approval_requested", { contentId: row.content_id, stage: "proposal", revision: row.revision, format: updated.format });
  return updated;
}

function styleFor(row: TopicContentRow) {
  return createStyleBrief({ topicId: row.topic_id, trendType: row.candidate.candidate.trend_type, tone: row.override.tone });
}

const newContentId = () => `tc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

function newRow(candidate: TopicCandidate, cluster: StoredCandidate["cluster"], runId: string | null, contentId = newContentId(), chanceId: string | null = null): TopicContentRow {
  return { content_id: contentId, run_id: runId, topic_id: candidate.topic_id, category: "topic", stage: "proposed", format: candidate.suggested_format,
    revision: 1, candidate: { candidate, cluster, variant: 0, ...(chanceId ? { chance_id: chanceId } : {}) }, decision: null, override: emptyOverride(), copy: null, production: null,
    master: null, product: { status: "none" }, proposal_message_id: null, product_message_id: null, model_calls: 0, last_error: null };
}

// Scheduled topic proposals per Berlin calendar day (default 1; TOPIC_POSTS_PER_DAY raises it, at most 4). Only scheduled
// runs (with a slot key) count; a topic the operator explicitly asks for ("anderes Thema") is never limited by it.
export const dailyTopicLimit = (env: Record<string, string | undefined> = process.env) => Math.max(1, Math.min(4, Math.floor(Number(env.TOPIC_POSTS_PER_DAY)) || 1));

// Cron entry point. Never throws: a failing topic run cannot affect the product pipeline.
export async function runTopicPipeline(deps: TopicPipelineDeps, input: { slotKey: string | null; exclude?: string[] }) {
  try {
    await ensureAutomationSchema(deps.db);
    const day = input.slotKey?.match(/^(\d{4}-\d{2}-\d{2}):/)?.[1];
    // A slot that was already claimed keeps answering "already_ran" (claimTopicRun below); the daily limit applies to new slots.
    const slotKnown = input.slotKey ? (await deps.db.query("SELECT 1 FROM topic_runs WHERE slot_key=$1", [input.slotKey])).rows.length > 0 : false;
    if (day && !slotKnown) {
      const taken = Number((await deps.db.query("SELECT count(*)::int AS n FROM topic_runs WHERE slot_key LIKE $1 AND selected_topic_id IS NOT NULL", [`${day}:%`])).rows[0]?.n ?? 0);
      if (taken >= dailyTopicLimit()) return { status: "daily_limit" as const, taken, limit: dailyTopicLimit() };
    }
    const runId = randomUUID();
    if (input.slotKey && !(await claimTopicRun(deps.db, runId, input.slotKey, now(deps).toISOString()))) return { status: "already_ran" as const };
    if (!input.slotKey) await claimTopicRun(deps.db, runId, null, now(deps).toISOString());
    const history = await loadTopicHistory(deps.db).catch(() => []);
    const productHistory = await loadSelectionHistory(deps.db).catch(() => undefined);
    const selection = await discoverTopic({ now: now(deps), history, productHistory, exclude: input.exclude, scout: deps.scout, ...deps.scoutOptions });
    // Trendsetter + Jarvis: the scout's accepted topics and the shared chances of the trend agent are routed centrally
    // (duplicate control, time locks, priority). If that layer is unreachable, the scout's own best topic is used
    // (documented fallback, logged); the topic history and gate still applied above.
    let pick: { candidate: TopicCandidate; cluster: StoredCandidate["cluster"]; contentId: string; chanceId: string | null } | null = null;
    let failure = selection.failure;
    try {
      const routed = await jarvisSelectTopic(deps.db, { selection, now: now(deps), exclude: input.exclude, history, productHistory, contentIdFor: newContentId });
      if (routed.pick && routed.contentId) pick = { candidate: routed.pick.candidate, cluster: routed.pick.cluster, contentId: routed.contentId, chanceId: routed.pick.chance.chance_id };
      else failure = failure ?? "no_routed_topic";
    } catch (error) {
      emitEvent("trendsetter_unavailable", { stage: "topic_routing", failure: error instanceof Error ? error.name : "unknown" }, "warn");
      if (selection.selected) pick = { candidate: selection.selected, cluster: selection.scout?.clusters[selection.selected.topic_id] ?? null, contentId: newContentId(), chanceId: null };
    }
    await saveTopicRun(deps.db, runId, selection.scout, selection.verdicts, selection.candidates, pick?.candidate ?? null, pick ? null : failure);
    if (!pick) return { status: "no_topic" as const, runId, failure };
    const row = await propose(deps, newRow(pick.candidate, pick.cluster, runId, pick.contentId, pick.chanceId));
    return { status: "proposed" as const, runId, contentId: row.content_id, format: row.format };
  } catch (error) {
    emitEvent("topic_pipeline_failed", { stage: "run", failure: error instanceof Error ? error.name : "unknown" }, "error");
    return { status: "failed" as const, failure: error instanceof Error ? error.name : "unknown" };
  }
}

// ---------- production and publish approval ----------
function affiliateFrom(row: TopicContentRow): AffiliateData | null {
  if (row.product.status !== "selected") return null;
  return { product: { name: row.product.product.name, asin: row.product.product.asin, sourceUrl: row.product.product.sourceUrl }, affiliateUrl: row.product.product.affiliateUrl,
    approval: { channel: "whatsapp", messageId: row.product.selectedBy } };
}

async function requestPublishApproval(deps: TopicPipelineDeps, row: TopicContentRow, production: ProductionResult): Promise<TopicContentRow> {
  const candidate = row.candidate.candidate;
  const master = buildMasterContent({ contentId: row.content_id, topic: { topic_id: candidate.topic_id, title: candidate.title, trend_type: candidate.trend_type },
    format: production.producedFormat, copy: row.copy!, assets: production.assets, carousel: production.carousel ?? null, video: production.video ?? null,
    sources: candidate.source_signals.filter(signal => signal.kind === "news").map(signal => ({ title: signal.title, url: signal.url, publisher: signal.publisher, published_at: signal.published_at })),
    runId: row.run_id, origin: "topic_pipeline", affiliate: affiliateFrom(row), affiliateBlocked: productCouplingBlocked(candidate) !== null });
  if (!row.copy) throw new Error("copy_missing");
  const variants = PLATFORM_ADAPTERS.filter(adapter => platformsOf(deps).includes(adapter.platform)).map(adapter => adapter.render(master));
  const version = await registerContentVersion(deps.db, publishableContent(master, variants));
  const plan = await publishAll(deps.db, { master, variants, publishers: deps.publishers ?? [], origin: "approval_preview", dryRun: true });
  const live = liveFor(deps);
  const messageId = await deps.send(publishApprovalText(master, variants, plan.plan, version.version, live));
  await bindApprovalRequest(deps.db, row.content_id, version.version, messageId);
  const updated: TopicContentRow = { ...row, production, format: production.producedFormat, category: master.category, master: { master, variants, version: version.version }, stage: "awaiting_publish_approval" };
  await save(deps.db, updated);
  emitEvent("topic_approval_requested", { contentId: row.content_id, stage: "publish", version: version.version, format: master.selected_format });
  return updated;
}

async function produce(deps: TopicPipelineDeps, row: TopicContentRow): Promise<TopicContentRow> {
  if (!row.decision || !row.copy) throw new Error("plan_missing");
  await save(deps.db, { ...row, stage: "producing" });
  let production = await produceContent({ contentId: row.content_id, format: row.decision.format, exclude: row.override.exclude, slides: row.decision.slides, copy: row.copy,
    style: styleFor(row), dryRun: false, visualPotential: row.candidate.candidate.visual_potential }, deps.render);
  if (production.status === "in_progress") {
    const waiting = { ...row, production, stage: "in_production" as const };
    await save(deps.db, waiting);
    await deps.send(`„${row.candidate.candidate.title}“: ${FORMAT_LABEL[production.producedFormat]} wird noch erzeugt. Ich setze den Auftrag automatisch fort (kein zweiter Auftrag beim Anbieter) und schicke dir danach die Veröffentlichungsfreigabe.`);
    return waiting;
  }
  if (production.status === "failed") {
    const failed = { ...row, production, stage: "failed" as const, last_error: production.errors.join("; ").slice(0, 300) };
    await save(deps.db, failed);
    await deps.send(`„${row.candidate.candidate.title}“ konnte nicht produziert werden (${failed.last_error}). Es wurde nichts veröffentlicht.`);
    return failed;
  }
  const rasterize = deps.rasterize ?? blobRasterizer();
  const assets = [];
  for (const item of production.assets) assets.push({ role: item.role, asset: await rasterize(item.asset, row.content_id, item.role) });
  production = { ...production, assets };
  return requestPublishApproval(deps, row, production);
}

// Continues video jobs that were still running (called by cron and by „Status“/„Weiter“). Resumes by provider job id.
export async function resumeTopicProductions(deps: TopicPipelineDeps) {
  const rows = await deps.db.query("SELECT content_id FROM topic_contents WHERE stage='in_production' AND updated_at>now()-interval '2 days' ORDER BY updated_at LIMIT 3");
  let resumed = 0;
  for (const item of rows.rows) {
    const row = await load(deps.db, String(item.content_id));
    if (!row) continue;
    try { await produce(deps, row); resumed++; }
    catch { emitEvent("topic_pipeline_failed", { stage: "resume", contentId: row.content_id }, "error"); }
  }
  return resumed;
}

// ---------- WhatsApp replies ----------
type Inbound = { id: string; from: string; body: string; replyToMessageId: string | null; payload?: unknown };
const CHANGE_STAGES: Stage[] = ["proposed", "awaiting_publish_approval"];
const deterministicWord = (body: string) => classifyWhatsAppReply(body).intent !== "changes_requested" || /^(status|weiter|entwurf|wochenbilanz|wiederholen|erneut versuchen)[.!?]*$/i.test(body.trim());

async function topicRouteContext(deps: TopicPipelineDeps, message: Inbound, replying: TopicRouteContext["replying_to"]): Promise<TopicRouteContext> {
  const rows = await deps.db.query(`SELECT content_id, candidate->'candidate'->>'title' AS title, stage, format, product->'product'->>'name' AS product FROM topic_contents
    WHERE stage = ANY($1::text[]) AND updated_at > now() - interval '7 days' ORDER BY updated_at DESC LIMIT 6`, [CHANGE_STAGES]);
  let products: TopicRouteContext["product_drafts"] = [];
  try {
    const context = await loadRouteContext(deps.db, deps.trustedWaId.replace(/\D/g, ""), message.id, message.replyToMessageId);
    products = context.open_items.slice(0, 6).map(item => ({ draft_id: item.draft_id, product: item.product.slice(0, 80), stage: item.stage }));
  } catch { /* product context is optional for the topic decision */ }
  return { replying_to: replying, topic_drafts: rows.rows.map(row => ({ content_id: String(row.content_id), title: String(row.title ?? "").slice(0, 100), stage: String(row.stage),
    format: String(row.format), product: row.product ? String(row.product) : null })), product_drafts: products };
}

async function interpretFor(deps: TopicPipelineDeps, body: string, context: TopicRouteContext): Promise<TopicRoute | null> {
  try { return await (deps.interpret ?? interpretTopicMessage)(body, context); }
  catch (error) {
    emitEvent("topic_pipeline_failed", { stage: "interpret", failure: error instanceof RouterUnavailable ? error.message : "unknown" }, "warn");
    return null;
  }
}

// Replies that quote a topic-pipeline message (proposal, product suggestions, publish approval).
export async function handleTopicReply(deps: TopicPipelineDeps, message: Inbound): Promise<boolean> {
  if (!message.replyToMessageId) return false;
  const db = deps.db;
  await ensureAutomationSchema(db);
  const byProposal = (await db.query("SELECT content_id FROM topic_contents WHERE proposal_message_id=$1 OR product_message_id=$1", [message.replyToMessageId])).rows[0];
  const byApproval = byProposal ? null : await contentIdForRequestMessage(db, message.replyToMessageId);
  const contentId = byProposal ? String(byProposal.content_id) : byApproval?.contentId;
  if (!contentId) {
    // A reply to an earlier (replaced) proposal of a topic draft: answered as outdated, never handed to another pipeline.
    const outdated = (await db.query("SELECT content_id FROM topic_contents WHERE previous_message_ids ? $1 LIMIT 1", [message.replyToMessageId])).rows[0];
    if (!outdated) return false;
    const trustedWa = deps.trustedWaId.replace(/\D/g, "");
    if (!trustedWa || message.from.replace(/\D/g, "") !== trustedWa) return true;
    const first = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",
      [message.id, message.from, message.replyToMessageId, message.body, JSON.stringify(message.payload ?? {})]);
    if (first.rows.length) await deps.send("Diese Nachricht ist veraltet: Der Themenbeitrag wurde inzwischen geändert. Antworte bitte auf die neueste Nachricht dazu. Es wurde nichts geändert oder freigegeben.");
    return true;
  }
  const row = await load(db, contentId);
  if (!row) return false;
  const trusted = deps.trustedWaId.replace(/\D/g, "");
  if (!trusted || message.from.replace(/\D/g, "") !== trusted) return true; // belongs to the topic pipeline, but not from the operator: ignore
  const claimed = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",
    [message.id, message.from, message.replyToMessageId, message.body, JSON.stringify(message.payload ?? {})]);
  if (!claimed.rows.length) return true; // webhook replay
  await guarded(deps, row, async () => {
    if (row.product_message_id === message.replyToMessageId) await onProductReply(deps, row, message);
    else if (row.proposal_message_id === message.replyToMessageId) await onProposalReply(deps, row, message);
    else await onPublishReply(deps, row, message);
  });
  return true;
}

// Free messages WITHOUT a quoted message. Only when topic drafts are open; the semantic router decides whether the
// message is about a topic draft (and which one) or about the product pipeline. Product messages are left untouched.
export async function routeTopicMessage(deps: TopicPipelineDeps, message: Inbound): Promise<boolean> {
  if (message.replyToMessageId || deterministicWord(message.body)) return false;
  const trusted = deps.trustedWaId.replace(/\D/g, "");
  if (!trusted || message.from.replace(/\D/g, "") !== trusted) return false;
  await ensureAutomationSchema(deps.db);
  if ((await deps.db.query("SELECT 1 FROM topic_inbound WHERE message_id=$1", [message.id])).rows.length) return true; // replay of a handled message
  const context = await topicRouteContext(deps, message, { kind: "none", content_id: null });
  if (!context.topic_drafts.length) return false;
  const route = await interpretFor(deps, message.body, context);
  if (!route || route.domain === "product") return false; // the existing product router handles it
  const claim = async (contentId: string | null, action: string) =>
    (await deps.db.query("INSERT INTO topic_inbound(message_id,content_id,action) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING message_id", [message.id, contentId, action])).rows.length > 0;
  const target = context.topic_drafts.find(item => item.content_id === route.content_id) ?? (context.topic_drafts.length === 1 && route.domain === "topic" ? context.topic_drafts[0] : null);
  if (route.domain === "unclear" || !target || route.ambiguity === "high" || route.confidence < 0.5 || route.intent === "clarify") {
    if (!(await claim(null, "clarify"))) return true;
    await deps.send(clarificationText(context, route));
    return true;
  }
  if (!(await claim(target.content_id, route.intent))) return true;
  const row = await load(deps.db, target.content_id);
  if (!row) return true;
  await guarded(deps, row, () => applyRoute(deps, row, route, message, row.stage === "proposed" ? "proposal" : "publish"));
  return true;
}

function clarificationText(context: TopicRouteContext, route: TopicRoute | null) {
  const topics = context.topic_drafts.slice(0, 3).map(item => `• Themenbeitrag „${item.title}“`);
  const products = context.product_drafts.slice(0, 3).map(item => `• Produktentwurf „${item.product}“`);
  return [route?.clarification_question?.trim() || "Welchen Entwurf meinst du?", ...topics, ...products,
    "Antworte am besten direkt auf die Nachricht des gemeinten Entwurfs. Es wurde nichts geändert."].join("\n");
}

async function guarded(deps: TopicPipelineDeps, row: TopicContentRow, work: () => Promise<unknown>) {
  try { await work(); }
  catch (error) {
    emitEvent("topic_pipeline_failed", { stage: "reply", contentId: row.content_id, failure: error instanceof Error ? error.name : "unknown" }, "error");
    await save(deps.db, { ...(await load(deps.db, row.content_id) ?? row), last_error: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
    await deps.send("Die Antwort zum Themenbeitrag konnte nicht vollständig verarbeitet werden. Es wurde nichts veröffentlicht. „Status“ zeigt Details.").catch(() => undefined);
  }
}

async function requestProducts(deps: TopicPipelineDeps, row: TopicContentRow, wish: string | null, messageId: string) {
  const candidate = row.candidate.candidate;
  if (!deps.suggester) { await deps.send("Der Produkt-Trendscout ist gerade nicht angebunden. Es bleibt ein Themen-Post ohne Link."); return; }
  const result = await suggestProducts(candidate, deps.suggester, wish);
  if (!result.ok) { await deps.send(`Keine Produktvorschläge für „${candidate.title}“: ${result.reason}. Es bleibt ein Themen-Post ohne Affiliate-Link.`); return; }
  const sent = await deps.send(productSuggestionsText(candidate.title, result.suggestions));
  await save(deps.db, { ...row, product: { status: "suggested", suggestions: result.suggestions, requestedBy: messageId, suggestedAt: now(deps).toISOString() }, product_message_id: sent });
  if (row.product_message_id && row.product_message_id !== sent) await rememberOutdated(deps.db, row.content_id, row.product_message_id);
  emitEvent("topic_instruction_applied", { contentId: row.content_id, instruction: "product_suggestions", count: result.suggestions.length });
}

async function onProposalReply(deps: TopicPipelineDeps, row: TopicContentRow, message: Inbound) {
  if (row.stage !== "proposed") { await deps.send("Dieser Themenvorschlag ist nicht mehr offen. Es wurde nichts geändert."); return; }
  const intent = classifyWhatsAppReply(message.body).intent;
  if (intent === "approve") { await produce(deps, row); return; }
  if (intent === "reject") {
    await save(deps.db, { ...row, stage: "rejected" });
    await recordTopicHistory(deps.db, row.candidate.candidate, "rejected", message.id);
    await closeTopicRoute(deps, row, "rejected");
    await deps.send(`Verworfen: „${row.candidate.candidate.title}“. Es wird nichts produziert oder veröffentlicht.`);
    return;
  }
  if (productListCommand(message.body)) return requestProducts(deps, row, null, message.id);
  await understandAndApply(deps, row, message, "proposal");
}

// Free text quoting a topic message: the target is fixed by the quote; the semantic router says what is wanted.
async function understandAndApply(deps: TopicPipelineDeps, row: TopicContentRow, message: Inbound, stage: "proposal" | "publish") {
  const context = await topicRouteContext(deps, message, { kind: "topic", content_id: row.content_id });
  const route = await interpretFor(deps, message.body, context);
  if (!route) { await deps.send("Ich konnte die Nachricht gerade nicht sicher verstehen (Sprachmodell nicht erreichbar). Es wurde nichts geändert; bitte später noch einmal schreiben."); return; }
  if (route.domain === "product") {
    await deps.send(`Das klingt nach dem Produktentwurf, nicht nach dem Themenbeitrag „${row.candidate.candidate.title}“. Antworte bitte direkt auf die Nachricht des Produktentwurfs. Am Themenbeitrag wurde nichts geändert.`);
    return;
  }
  if (route.ambiguity === "high" || route.confidence < 0.5 || route.intent === "clarify") { await deps.send(`${route.clarification_question?.trim() || "Was genau soll ich am Themenbeitrag ändern?"} Es wurde nichts geändert.`); return; }
  await applyRoute(deps, row, route, message, stage);
}

async function applyRoute(deps: TopicPipelineDeps, row: TopicContentRow, route: TopicRoute, message: Inbound, stage: "proposal" | "publish") {
  if (!CHANGE_STAGES.includes(row.stage)) { await deps.send("Dieser Themenbeitrag ist nicht mehr änderbar. Es wurde nichts geändert."); return; }
  if (route.intent === "request_products") return requestProducts(deps, row, route.product_wish, message.id);
  if (route.intent === "question") { await deps.send(route.answer?.trim() || "Dazu habe ich keine gespeicherte Information. Es wurde nichts geändert."); return; }
  const wish = overrideFromTopicRoute(route);
  if (!hasOverride(wish)) { await deps.send("Das habe ich nicht als Änderung am Themenbeitrag verstanden. Es wurde nichts geändert."); return; }
  await applyWish(deps, row, wish, message, stage);
}

async function applyWish(deps: TopicPipelineDeps, row: TopicContentRow, wish: FormatOverride, message: { id: string }, stage: "proposal" | "publish") {
  // Any accepted change voids every open or granted publish approval of this content right away.
  const voided = await invalidateApprovals(deps.db, row.content_id, "operator_change");
  if (voided.length) emitEvent("platform_publish_skipped", { contentId: row.content_id, reason: "approval_invalidated_by_operator_change", versions: voided });
  if (wish.newTopic) {
    await save(deps.db, { ...row, stage: "discarded" });
    await recordTopicHistory(deps.db, row.candidate.candidate, "discarded", message.id);
    await closeTopicRoute(deps, row, "rejected");
    const next = await runTopicPipeline(deps, { slotKey: null, exclude: [row.topic_id] });
    if (next.status !== "proposed") await deps.send("Ich habe gerade kein weiteres Thema, das Jarvis' Prüfung besteht. Es wird nichts produziert.");
    return;
  }
  if (wish.noProduct && row.product.status !== "none") row = { ...row, product: { status: "declined", by: message.id } };
  let candidate = row.candidate;
  if (wish.newHook && candidate.cluster) {
    const variant = candidate.variant + 1;
    const rebuilt = buildCandidate(candidate.cluster, now(deps), variant);
    if (!("error" in rebuilt) && topicGate(rebuilt, { now: now(deps) }).decision !== "reject") candidate = { ...candidate, candidate: rebuilt, variant };
  }
  const override = mergeOverrides(row.override, wish);
  const changedCopy = wish.newHook || wish.tone.length > 0;
  const updated: TopicContentRow = { ...row, candidate, override, revision: row.revision + 1, copy: changedCopy ? null : row.copy };
  emitEvent("topic_instruction_applied", { contentId: row.content_id, stage, matched: wish.matched });
  if (stage === "proposal") { await propose(deps, updated, `Übernommen: ${wish.matched.join(", ")}`); return; }
  // After production: re-plan (format/slides), produce again (finished slides/images are reused via the job ledger),
  // then a new version and a new approval request.
  await produce(deps, await plan(deps, updated));
}

async function onProductReply(deps: TopicPipelineDeps, row: TopicContentRow, message: { id: string; body: string }) {
  const choice = productSelection(message.body);
  if (choice === null) { await deps.send("Bitte antworte auf die Produktvorschläge mit „Produkt 1“, „Produkt 2“, „Produkt 3“ oder „Kein Produkt“. Es wurde nichts übernommen."); return; }
  if (row.product.status !== "suggested") { await deps.send("Diese Produktvorschläge sind nicht mehr offen. Es wurde nichts übernommen."); return; }
  if (choice === "none") {
    await save(deps.db, { ...row, product: { status: "declined", by: message.id } });
    await deps.send("Alles klar, kein Produkt. Es bleibt ein Themen-Post ohne Affiliate-Link.");
    return;
  }
  const suggestion = row.product.suggestions[choice - 1];
  if (!suggestion) { await deps.send(`Produkt ${choice} gibt es in dieser Liste nicht. Es wurde nichts übernommen.`); return; }
  // Re-check sensitivity at the moment of the choice (the topic may have been revised).
  const blocked = productCouplingBlocked(row.candidate.candidate);
  if (blocked) { await deps.send(`Für dieses Thema ist kein Produkt erlaubt (${blocked}). Es bleibt ohne Link.`); return; }
  const resolved = deps.resolveProduct ? await deps.resolveProduct(suggestion.searchQuery).catch(() => null) : null;
  if (!resolved) { await deps.send(`Für „${suggestion.name}“ habe ich keinen verifizierten Amazon-Artikel gefunden. Es bleibt ein Themen-Post ohne Link.`); return; }
  const selected: TopicContentRow = { ...row, product: { status: "selected", suggestion, selectedBy: message.id, product: resolved }, revision: row.revision + 1 };
  emitEvent("topic_instruction_applied", { contentId: row.content_id, instruction: "product_selected" });
  if (row.stage === "proposed") { await propose(deps, selected, `Produkt übernommen: ${resolved.name}`); return; }
  if (row.stage === "awaiting_publish_approval" && row.production) { await requestPublishApproval(deps, selected, row.production); return; }
  await save(deps.db, selected);
  await deps.send(`Produkt „${resolved.name}“ gespeichert; es wird mit der nächsten Fassung zur Freigabe vorgelegt.`);
}

async function onPublishReply(deps: TopicPipelineDeps, row: TopicContentRow, message: Inbound) {
  // Deterministic command: retry only definitely failed platforms of the already approved version.
  if (/^(wiederholen|erneut versuchen)[.!]?$/i.test(message.body.trim()) && ["not_published", "partially_published", "publishing", "published"].includes(row.stage)) {
    await retryFailedPlatforms(deps, row.content_id, message.id);
    return;
  }
  const intent = classifyWhatsAppReply(message.body).intent;
  let decision: string | null = null;
  try {
    decision = (await recordApprovalDecision(deps.db, { authority: "whatsapp_operator", trustedWaId: deps.trustedWaId,
      evidence: { channel: "whatsapp", messageId: message.id, replyToMessageId: message.replyToMessageId!, senderWaId: message.from, body: message.body } })).decision;
  } catch (error) {
    if (!(error instanceof ApprovalDecisionError)) throw error;
    if (intent !== "changes_requested") { await deps.send("Diese Fassung ist nicht mehr aktuell oder bereits entschieden. Es wurde nichts veröffentlicht. Antworte auf die neueste Freigabenachricht."); return; }
  }
  if (decision === "rejected") {
    await save(deps.db, { ...row, stage: "rejected" });
    await recordTopicHistory(deps.db, row.candidate.candidate, "rejected", message.id);
    await closeTopicRoute(deps, row, "rejected");
    await deps.send(`Abgelehnt: „${row.candidate.candidate.title}“. Es wird nichts veröffentlicht.`);
    return;
  }
  if (decision === "approved") { await publish(deps, row, message.id); return; }
  if (productListCommand(message.body)) return requestProducts(deps, row, null, message.id);
  await understandAndApply(deps, row, message, "publish");
}

async function publish(deps: TopicPipelineDeps, row: TopicContentRow, approvalMessageId: string, only?: Platform[]) {
  if (!row.master) return;
  await save(deps.db, { ...row, stage: "publishing" });
  await recordTopicHistory(deps.db, row.candidate.candidate, "approved", approvalMessageId);
  const run: PublishRun = await publishAll(deps.db, { master: row.master.master, variants: row.master.variants, publishers: deps.publishers ?? [], origin: only ? "retry_failed" : "whatsapp_approval",
    dryRun: !liveFor(deps), only });
  const format = row.master.master.selected_format as ReportFormat;
  const category = row.master.master.category;
  if (run.dryRun) {
    await save(deps.db, { ...row, stage: "not_published", last_error: "dry_run" });
    await deps.send([`Probelauf (Dry-Run): ${category === "affiliate" ? "Affiliate-Post" : "Themen-Post"}, ${FORMAT_LABEL[format]} – nichts veröffentlicht`, "",
      ...run.plan.map(entry => `• ${PLATFORM_LABEL[entry.platform]}: ${entry.publishable ? `${entry.mediaFormat}, Link: ${entry.linkStrategy}` : "nicht vorgesehen"} – ${entry.reason}`),
      "", "Live-Veröffentlichung ist ausgeschaltet (TOPIC_LIVE_PUBLISHING). Deine Freigabe gilt nur für genau diese Fassung."].join("\n"));
    return;
  }
  await reportStored(deps, row, approvalMessageId);
}

// Report and stage are always computed from the stored per-platform results, so retries and reconciliation never
// mark a successful platform as failed.
async function reportStored(deps: TopicPipelineDeps, row: TopicContentRow, historyOrigin: string) {
  if (!row.master) return;
  const outcomes: PublishOutcome[] = await storedOutcomes(deps.db, row.master.master, row.master.variants);
  const live = outcomes.filter(item => item.status === "published").length;
  const pending = outcomes.some(item => item.status === "processing");
  const stage: Stage = pending ? "publishing" : !outcomes.length || !live ? "not_published" : live === outcomes.length ? "published" : "partially_published";
  await save(deps.db, { ...row, stage });
  if (live) { await recordTopicHistory(deps.db, row.candidate.candidate, "published", historyOrigin); await closeTopicRoute(deps, row, "published"); }
  const failed = outcomes.some(item => item.status === "failed");
  await deps.send(formatPublishReport({ category: row.master.master.category, format: row.master.master.selected_format as ReportFormat, outcomes,
    note: [row.master.variants.some(variant => !variant.publishable) ? `Nicht vorgesehen: ${row.master.variants.filter(variant => !variant.publishable).map(variant => `${PLATFORM_LABEL[variant.platform]} (${variant.skipReason})`).join(", ")}` : null,
      failed ? "Antworte auf die Freigabenachricht mit „Wiederholen“, um nur die fehlgeschlagenen Plattformen erneut zu versuchen." : null,
      pending ? "Noch in Verarbeitung; ich melde mich, sobald die Plattform bestätigt (oder bei „Status“)." : null].filter(Boolean).join("\n") || null }));
}

// Retry exactly the platforms whose last attempt for the approved version definitely failed. Published, processing
// or unclear platforms are untouched. The publish gate re-checks the approval and all switches.
export async function retryFailedPlatforms(deps: TopicPipelineDeps, contentId: string, triggerMessageId: string) {
  const row = await load(deps.db, contentId);
  if (!row?.master) return { retried: [] as Platform[] };
  const failed = (await storedOutcomes(deps.db, row.master.master, row.master.variants)).filter(item => item.status === "failed").map(item => item.platform as Platform);
  if (!failed.length) { await deps.send("Es gibt keine fehlgeschlagene Plattform, die erneut versucht werden kann. Es wurde nichts veröffentlicht."); return { retried: [] }; }
  await publish(deps, row, triggerMessageId, failed);
  return { retried: failed };
}

// Completes asynchronous publishes (TikTok, YouTube, Instagram reels) by asking the platforms; sends the final
// report once nothing is processing any more. Called by cron and "Status".
export async function reconcileTopicPublications(deps: TopicPipelineDeps) {
  const settled = await reconcilePublishing(deps.db, deps.publishers ?? []);
  for (const contentId of [...new Set(settled.map(item => item.contentId))]) {
    const row = await load(deps.db, contentId);
    if (row?.master) await reportStored(deps, row, `reconcile:${contentId}`);
  }
  return settled.length;
}

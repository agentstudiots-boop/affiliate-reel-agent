import { randomUUID } from "node:crypto";
import type { Generator } from "../content/agent";
import { loadSelectionHistory } from "../content/selection-history";
import { buildMasterContent, type AffiliateData, type MasterContent } from "../distribution/master-content";
import { PLATFORM_ADAPTERS, type PlatformVariant } from "../distribution/platforms/adapters";
import { liveTopicPublishingEnabled, publishAll, publishableContent, type PlatformPublisher, type PublishRun } from "../distribution/publish";
import { PLATFORMS, FORMAT_LABEL, type Platform } from "../formats/catalog";
import { emptyOverride, hasOverride, mergeOverrides, parseFormatInstruction, type FormatOverride } from "../formats/override";
import { decideFormat, type FormatDecision } from "../formats/router";
import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { emitEvent } from "../observability/events";
import { ApprovalDecisionError, bindApprovalRequest, contentIdForRequestMessage, recordApprovalDecision, registerContentVersion } from "../publishing/approval-gate";
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
import { productCouplingBlocked, productRequest, productSelection, suggestProducts, type ProductState, type ProductSuggester } from "./product-coupling";

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
};

type Stage = "proposed" | "producing" | "in_production" | "awaiting_publish_approval" | "publishing" | "published" | "partially_published" | "not_published" | "rejected" | "discarded" | "failed";
type StoredCandidate = { candidate: TopicCandidate; cluster: { title: string; signals: RawSignal[] } | null; variant: number };
export type TopicContentRow = {
  content_id: string; run_id: string | null; topic_id: string; category: "topic" | "affiliate"; stage: Stage; format: string; revision: number;
  candidate: StoredCandidate; decision: FormatDecision | null; override: FormatOverride; copy: TopicCopy | null; production: ProductionResult | null;
  master: { master: MasterContent; variants: PlatformVariant[]; version: number } | null; product: ProductState;
  proposal_message_id: string | null; product_message_id: string | null; model_calls: number; last_error: string | null;
};

const now = (deps: TopicPipelineDeps) => (deps.now ?? (() => new Date()))();
const platformsOf = (deps: TopicPipelineDeps) => deps.platforms ?? (process.env.TOPIC_PLATFORMS ? process.env.TOPIC_PLATFORMS.split(",").map(item => item.trim()).filter((item): item is Platform => (PLATFORMS as readonly string[]).includes(item)) : [...PLATFORMS]);

async function load(db: Database, contentId: string): Promise<TopicContentRow | null> {
  const row = (await db.query("SELECT * FROM topic_contents WHERE content_id=$1", [contentId])).rows[0];
  return row ? (row as unknown as TopicContentRow) : null;
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
  await recordTopicHistory(deps.db, candidate, "proposed", `${row.content_id}:${row.revision}`);
  emitEvent("topic_approval_requested", { contentId: row.content_id, stage: "proposal", revision: row.revision, format: updated.format });
  return updated;
}

function styleFor(row: TopicContentRow) {
  return createStyleBrief({ topicId: row.topic_id, trendType: row.candidate.candidate.trend_type, tone: row.override.tone });
}

function newRow(candidate: TopicCandidate, cluster: StoredCandidate["cluster"], runId: string | null): TopicContentRow {
  return { content_id: `tc_${randomUUID().replace(/-/g, "").slice(0, 16)}`, run_id: runId, topic_id: candidate.topic_id, category: "topic", stage: "proposed", format: candidate.suggested_format,
    revision: 1, candidate: { candidate, cluster, variant: 0 }, decision: null, override: emptyOverride(), copy: null, production: null,
    master: null, product: { status: "none" }, proposal_message_id: null, product_message_id: null, model_calls: 0, last_error: null };
}

// Cron entry point. Never throws: a failing topic run cannot affect the product pipeline.
export async function runTopicPipeline(deps: TopicPipelineDeps, input: { slotKey: string | null; exclude?: string[] }) {
  try {
    await ensureAutomationSchema(deps.db);
    const runId = randomUUID();
    if (input.slotKey && !(await claimTopicRun(deps.db, runId, input.slotKey, now(deps).toISOString()))) return { status: "already_ran" as const };
    if (!input.slotKey) await claimTopicRun(deps.db, runId, null, now(deps).toISOString());
    const history = await loadTopicHistory(deps.db).catch(() => []);
    const productHistory = await loadSelectionHistory(deps.db).catch(() => undefined);
    const selection = await discoverTopic({ now: now(deps), history, productHistory, exclude: input.exclude, scout: deps.scout, ...deps.scoutOptions });
    await saveTopicRun(deps.db, runId, selection.scout, selection.verdicts, selection.candidates, selection.selected, selection.failure);
    if (!selection.selected) return { status: "no_topic" as const, runId, failure: selection.failure };
    const row = await propose(deps, newRow(selection.selected, selection.scout?.clusters[selection.selected.topic_id] ?? null, runId));
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
  const live = deps.liveEnabled ?? liveTopicPublishingEnabled();
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
export async function handleTopicReply(deps: TopicPipelineDeps, message: { id: string; from: string; body: string; replyToMessageId: string | null; payload?: unknown }): Promise<boolean> {
  if (!message.replyToMessageId) return false;
  const db = deps.db;
  await ensureAutomationSchema(db);
  const byProposal = (await db.query("SELECT content_id FROM topic_contents WHERE proposal_message_id=$1 OR product_message_id=$1", [message.replyToMessageId])).rows[0];
  const byApproval = byProposal ? null : await contentIdForRequestMessage(db, message.replyToMessageId);
  const contentId = byProposal ? String(byProposal.content_id) : byApproval?.contentId;
  if (!contentId) return false;
  const row = await load(db, contentId);
  if (!row) return false;
  const trusted = deps.trustedWaId.replace(/\D/g, "");
  if (!trusted || message.from.replace(/\D/g, "") !== trusted) return true; // belongs to the topic pipeline, but not from the operator: ignore
  const claimed = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",
    [message.id, message.from, message.replyToMessageId, message.body, JSON.stringify(message.payload ?? {})]);
  if (!claimed.rows.length) return true; // webhook replay
  try {
    if (row.product_message_id === message.replyToMessageId) await onProductReply(deps, row, message);
    else if (row.proposal_message_id === message.replyToMessageId) await onProposalReply(deps, row, message);
    else await onPublishReply(deps, row, message);
  } catch (error) {
    emitEvent("topic_pipeline_failed", { stage: "reply", contentId, failure: error instanceof Error ? error.name : "unknown" }, "error");
    await save(db, { ...(await load(db, contentId) ?? row), last_error: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
    await deps.send("Die Antwort zum Themenbeitrag konnte nicht vollständig verarbeitet werden. Es wurde nichts veröffentlicht. „Status“ zeigt Details.").catch(() => undefined);
  }
  return true;
}

async function requestProducts(deps: TopicPipelineDeps, row: TopicContentRow, wish: string | null, messageId: string) {
  const candidate = row.candidate.candidate;
  if (!deps.suggester) { await deps.send("Der Produkt-Trendscout ist gerade nicht angebunden. Es bleibt ein Themen-Post ohne Link."); return; }
  const result = await suggestProducts(candidate, deps.suggester, wish);
  if (!result.ok) { await deps.send(`Keine Produktvorschläge für „${candidate.title}“: ${result.reason}. Es bleibt ein Themen-Post ohne Affiliate-Link.`); return; }
  const sent = await deps.send(productSuggestionsText(candidate.title, result.suggestions));
  await save(deps.db, { ...row, product: { status: "suggested", suggestions: result.suggestions, requestedBy: messageId, suggestedAt: now(deps).toISOString() }, product_message_id: sent });
  emitEvent("topic_instruction_applied", { contentId: row.content_id, instruction: "product_suggestions", count: result.suggestions.length });
}

async function onProposalReply(deps: TopicPipelineDeps, row: TopicContentRow, message: { id: string; body: string }) {
  if (row.stage !== "proposed") { await deps.send("Dieser Themenvorschlag ist nicht mehr offen. Es wurde nichts geändert."); return; }
  const product = productRequest(message.body);
  if (product.requested) return requestProducts(deps, row, product.wish, message.id);
  const intent = classifyWhatsAppReply(message.body).intent;
  if (intent === "approve") { await produce(deps, row); return; }
  if (intent === "reject") {
    await save(deps.db, { ...row, stage: "rejected" });
    await recordTopicHistory(deps.db, row.candidate.candidate, "rejected", message.id);
    await deps.send(`Verworfen: „${row.candidate.candidate.title}“. Es wird nichts produziert oder veröffentlicht.`);
    return;
  }
  await applyWish(deps, row, message, "proposal");
}

async function applyWish(deps: TopicPipelineDeps, row: TopicContentRow, message: { id: string; body: string }, stage: "proposal" | "publish") {
  const wish = parseFormatInstruction(message.body);
  if (wish.newTopic) {
    await save(deps.db, { ...row, stage: "discarded" });
    await recordTopicHistory(deps.db, row.candidate.candidate, "discarded", message.id);
    const next = await runTopicPipeline(deps, { slotKey: null, exclude: [row.topic_id] });
    if (next.status !== "proposed") await deps.send("Ich habe gerade kein weiteres Thema, das Jarvis' Prüfung besteht. Es wird nichts produziert.");
    return;
  }
  if (wish.noProduct && row.product.status !== "none") row = { ...row, product: { status: "declined", by: message.id } };
  if (!hasOverride(wish)) {
    await deps.send("Das habe ich nicht als Änderung erkannt. Möglich sind z. B. „Nur Bild“, „Karussell“, „Nur vier Slides“, „Lieber Video“, „Kein Avatar“, „Weniger werblich“, „Mehr Humor“, „Anderer Aufhänger“, „Neues Thema“, „Such mir dazu ein passendes Produkt“. Es wurde nichts geändert.");
    return;
  }
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
  // then a new version → automatic invalidation of the old approval → new approval request.
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

async function onPublishReply(deps: TopicPipelineDeps, row: TopicContentRow, message: { id: string; from: string; body: string; replyToMessageId: string | null }) {
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
    await deps.send(`Abgelehnt: „${row.candidate.candidate.title}“. Es wird nichts veröffentlicht.`);
    return;
  }
  if (decision === "approved") { await publish(deps, row, message.id); return; }
  const product = productRequest(message.body);
  if (product.requested) return requestProducts(deps, row, product.wish, message.id);
  await applyWish(deps, row, message, "publish");
}

async function publish(deps: TopicPipelineDeps, row: TopicContentRow, approvalMessageId: string) {
  if (!row.master) return;
  await save(deps.db, { ...row, stage: "publishing" });
  await recordTopicHistory(deps.db, row.candidate.candidate, "approved", approvalMessageId);
  const dryRun = !(deps.liveEnabled ?? liveTopicPublishingEnabled());
  const run: PublishRun = await publishAll(deps.db, { master: row.master.master, variants: row.master.variants, publishers: deps.publishers ?? [], origin: "whatsapp_approval", dryRun });
  const format = row.master.master.selected_format as ReportFormat;
  const category = row.master.master.category;
  if (run.dryRun) {
    await save(deps.db, { ...row, stage: "not_published", last_error: "dry_run" });
    await deps.send([`Probelauf (Dry-Run): ${category === "affiliate" ? "Affiliate-Post" : "Themen-Post"}, ${FORMAT_LABEL[format]} – nichts veröffentlicht`, "",
      ...run.plan.map(entry => `• ${entry.platform}: ${entry.publishable ? `${entry.mediaFormat}, Link: ${entry.linkStrategy}` : "nicht vorgesehen"} – ${entry.reason}`),
      "", "Live-Veröffentlichung ist ausgeschaltet (TOPIC_LIVE_PUBLISHING). Deine Freigabe gilt nur für genau diese Fassung."].join("\n"));
    return;
  }
  const live = run.outcomes.filter(item => item.status === "published").length;
  const stage: Stage = !run.outcomes.length || !live ? "not_published" : live === run.outcomes.length ? "published" : "partially_published";
  await save(deps.db, { ...row, stage });
  if (live) await recordTopicHistory(deps.db, row.candidate.candidate, "published", approvalMessageId);
  await deps.send(formatPublishReport({ category, format, outcomes: run.outcomes,
    note: row.master.variants.some(variant => !variant.publishable) ? `Nicht vorgesehen: ${row.master.variants.filter(variant => !variant.publishable).map(variant => `${variant.platform} (${variant.skipReason})`).join(", ")}` : null }));
}

import { createHash } from "node:crypto";
import type { Database } from "../../memory/db";
import type { ContentJob } from "../schema";
import type { OriginalVisualAsset, OriginalVisualProvider } from "../image-provider";
import { emitEvent } from "../../observability/events";
import { checkGeneratedImage, type QualityResult } from "./gate";
import { buildProviderPrompt, validatedPrompt, type PromptCorrection } from "./prompt";
import { imageSpecErrors, imageSpecFor, productBriefing, type ImageSpec } from "./spec";
import { feedbackFor, reviseSpecFromFeedback, type FeedbackItem, type IssueCode } from "./feedback";
import { lessonsFor, recordExperience } from "./learning";

// One image job of the existing affiliate image path:
//   structured briefing → briefing validation → provider prompt → prompt validation → ONE paid generation
//   → visual quality gate → passed: image goes to the operator's approval | failed: targeted correction within the budget
//   | otherwise: stop with a traceable reason. Never a parallel or blind second generation.

export type StopReason = "briefing_invalid" | "prompt_invalid" | "budget_exhausted" | "daily_budget_exhausted" | "concurrent" | "provider_unclear" | "quality_failed" | "quality_uncertain";
export type VisualOutcome =
  | { status: "passed"; asset: OriginalVisualAsset; quality: QualityResult | null; attemptNo: number; checked: boolean; manualOverride: boolean }
  | { status: "stopped"; reason: StopReason; detail: string[]; attemptNo: number | null; used: number; allowed: number; quality?: QualityResult };

export type VisualProductionDeps = {
  db: Database;
  provider: OriginalVisualProvider;
  model: string;
  gate?: (input: { url: string; spec: ImageSpec }) => Promise<QualityResult>;
  buildPrompt?: typeof buildProviderPrompt;
  sleep?: (ms: number) => Promise<void>;
};

// Configuration (all optional): IMAGE_MAX_GENERATIONS_PER_JOB (default 2 = first image + one targeted correction),
// IMAGE_QUALITY_GATE=strict|off (default strict; "off" skips the vision check and marks the approval as unchecked),
// IMAGE_COST_PER_GENERATION_USD (estimate per paid image; default by model).
export const maxGenerations = () => Math.max(1, Math.min(5, Number(process.env.IMAGE_MAX_GENERATIONS_PER_JOB) || 2));
// The vision check runs on the existing Replicate account. Unset: strict whenever that account is configured; without it the
// check cannot run and the approval message says so explicitly (the operator's own check is then the only one).
export const qualityGateMode = (): "strict" | "off" | "unavailable" => {
  const configured = process.env.IMAGE_QUALITY_GATE?.trim();
  if (configured === "off") return "off";
  if (configured === "strict") return "strict";
  return process.env.REPLICATE_API_TOKEN?.trim() ? "strict" : "unavailable";
};
// Daily cap over all jobs: IMAGE_DAILY_GENERATION_LIMIT paid images per rolling 24 hours (default 12, about 0.50 USD).
export const dailyGenerationLimit = () => Math.max(1, Number(process.env.IMAGE_DAILY_GENERATION_LIMIT) || 12);
const MODEL_COST_USD: Record<string, number> = { "black-forest-labs/flux-1.1-pro": 0.04, "black-forest-labs/flux-1.1-pro-ultra": 0.06 };
const costPerImage = (model: string) => Number(process.env.IMAGE_COST_PER_GENERATION_USD) || MODEL_COST_USD[model] || null;
const RATE_LIMIT_RETRIES = 2;
const PAID = "status NOT IN ('rejected_by_provider')";

export async function generationBudget(db: Database, job: ContentJob) {
  const used = Number((await db.query(`SELECT count(*)::int AS n FROM image_generation_attempts WHERE job_id=$1 AND ${PAID}`, [job.id])).rows[0]?.n ?? 0);
  const grants = (await db.query("SELECT kind,change_instruction FROM image_generation_grants WHERE job_id=$1 ORDER BY created_at", [job.id])).rows;
  // Every explicit operator image revision and every "Neues Bild" reply is a manual decision worth exactly one more attempt.
  const revisions = job.events.filter(event => { const data = event.data as { kind?: string; instruction?: { intent?: string } } | undefined;
    return data?.kind === "semantic_revision" && ["revise_image", "revise_both"].includes(String(data.instruction?.intent)); }).length;
  const allowed = maxGenerations() + revisions + grants.filter(row => row.kind === "new_attempt").length;
  return { used, allowed, changes: grants.map(row => String(row.change_instruction ?? "")).filter(Boolean) };
}

const correctionFrom = (quality: QualityResult | null | undefined): PromptCorrection => quality ? { primaryMissing: quality.findings.primaryMissing,
  forbiddenSeen: quality.findings.forbiddenSeen, wrongProduct: quality.findings.wrongProduct, defects: quality.findings.defects, composition: quality.findings.composition } : {};

export async function produceCheckedVisual(job: ContentJob, contentHash: string, deps: VisualProductionDeps): Promise<VisualOutcome> {
  const { db, provider } = deps;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const budget = await generationBudget(db, job);
  const { allowed, changes } = budget;
  let used = budget.used;
  // Relevant, confirmed experience of comparable jobs (product type first); the article-specific briefing stays leading.
  const productType = job.content?.format === "image" && job.content.imageSpec?.product_type ? job.content.imageSpec.product_type : productBriefing(job).product_type;
  const lessons = await lessonsFor(db, { category: job.opportunity.category, productType }).catch(() => null);
  let spec = imageSpecFor(job, changes, lessons);
  const specErrors = imageSpecErrors(spec);
  if (specErrors.length) return { status: "stopped", reason: "briefing_invalid", detail: specErrors, attemptNo: null, used, allowed };
  // A failed earlier attempt of this content version steers the correction of the next one.
  const last = (await db.query("SELECT quality FROM image_generation_attempts WHERE job_id=$1 AND content_hash=$2 AND quality IS NOT NULL ORDER BY attempt_no DESC LIMIT 1", [job.id, contentHash])).rows[0];
  const lastQuality = last?.quality as (QualityResult & { feedback?: FeedbackItem[] }) | undefined;
  let correction = correctionFrom(lastQuality);
  let applied: FeedbackItem[] | null = lastQuality?.feedback?.length ? lastQuality.feedback : null;
  if (applied) spec = reviseSpecFromFeedback(spec, applied);
  const seenCodes: IssueCode[] = applied ? applied.map(item => item.code) : [];
  for (;;) {
    if (used >= allowed) return { status: "stopped", reason: "budget_exhausted", detail: [`${used} von ${allowed} kostenpflichtigen Versuchen genutzt.`], attemptNo: null, used, allowed };
    const today = Number((await db.query(`SELECT count(*)::int AS n FROM image_generation_attempts WHERE ${PAID} AND created_at>now()-interval '24 hours'`)).rows[0]?.n ?? 0);
    if (today >= dailyGenerationLimit()) return { status: "stopped", reason: "daily_budget_exhausted", detail: [`${today} von ${dailyGenerationLimit()} Bildern in den letzten 24 Stunden.`], attemptNo: null, used, allowed };
    const raw = (deps.buildPrompt ?? buildProviderPrompt)(spec, job, correction);
    const checked = validatedPrompt(spec, raw, "4:5");
    if (!checked.ok) {
      emitEvent("image_prompt_rejected", { jobId: job.id, errors: checked.errors });
      return { status: "stopped", reason: "prompt_invalid", detail: checked.errors, attemptNo: null, used, allowed };
    }
    const attemptNo = Number((await db.query("SELECT coalesce(max(attempt_no),0)::int AS n FROM image_generation_attempts WHERE job_id=$1", [job.id])).rows[0].n) + 1;
    const claimed = await db.query(`INSERT INTO image_generation_attempts(job_id,attempt_no,content_hash,provider,model,prompt_sha256,prompt_corrected,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'claimed') ON CONFLICT DO NOTHING RETURNING attempt_no`,
      [job.id, attemptNo, contentHash, provider.name, deps.model, createHash("sha256").update(checked.prompt).digest("hex"), checked.corrected]);
    if (!claimed.rows.length) return { status: "stopped", reason: "concurrent", detail: ["Ein anderer Bildversuch läuft bereits."], attemptNo: null, used, allowed };
    const set = (fields: string, values: unknown[]) => db.query(`UPDATE image_generation_attempts SET ${fields},updated_at=now() WHERE job_id=$1 AND attempt_no=$2`, [job.id, attemptNo, ...values]);
    emitEvent("image_generation_started", { contentId: job.id, attempt: attemptNo, allowed, corrected: checked.corrected, correction: Object.keys(correction).filter(key => (correction as Record<string, unknown>)[key]) });
    let asset: OriginalVisualAsset | null = null;
    for (let rateLimited = 0; !asset;) {
      try {
        asset = await provider.render(job, { prompt: checked.prompt, onPrediction: id => set("status='accepted',prediction_id=$3", [id]).then(() => undefined) });
      } catch (error) {
        const failure = error as { definite?: boolean; category?: string; retryAfterSeconds?: number | null };
        // HTTP 429 before acceptance: nothing was created or charged. With the provider's own retry hint: bounded exponential
        // backoff on the same attempt. Without a hint the existing rule applies (claim released, operator restarts with „Weiter“).
        if (failure?.definite === true && failure.category === "rate_limit" && failure.retryAfterSeconds && rateLimited < RATE_LIMIT_RETRIES) {
          await sleep(Math.min(15_000, Math.max(failure.retryAfterSeconds * 1000, 2000 * 2 ** rateLimited++)));
          continue;
        }
        if (failure?.definite === true) { await set("status='rejected_by_provider'", []); throw error; }
        // Accepted or unknown: never generate again blindly; the stored provider job id is looked up instead.
        await set("status='unclear'", []);
        return { status: "stopped", reason: "provider_unclear", detail: ["Der Bildprovider hat den Auftrag angenommen, das Ergebnis ist unklar."], attemptNo, used: used + 1, allowed };
      }
    }
    used++;
    const cost = { estimatedUsd: costPerImage(deps.model), ...(asset.usage?.predictTimeSeconds !== undefined ? { predictTimeSeconds: asset.usage.predictTimeSeconds } : {}) };
    await set("status='generated',image_url=$3,sha256=$4,cost=$5,prediction_id=coalesce(prediction_id,$6)", [asset.url, asset.sha256 ?? null, JSON.stringify(cost), asset.usage?.predictionId ?? null]);
    const outcome = await assess(job.id, attemptNo, asset, spec, deps, set);
    // Quality manager → creative briefing: structured findings, stored with the attempt and as an experience.
    const quality = outcome.quality;
    const feedback = quality ? feedbackFor(quality, { spec, attemptNo, promptCorrected: checked.corrected, previous: seenCodes }) : [];
    if (quality) {
      await set("quality=$3", [JSON.stringify({ ...quality, feedback })]);
      await recordExperience(db, { jobId: job.id, attemptNo, category: job.opportunity.category, spec, promptSha: createHash("sha256").update(checked.prompt).digest("hex"),
        imageUrl: asset.url, quality, feedback, correction: applied, generations: used, costUsd: cost.estimatedUsd }).catch(() => emitEvent("image_quality_failed", { jobId: job.id, detail: "experience_unsaved" }, "warn"));
    }
    if (outcome.status === "passed") return outcome;
    if (!quality) throw new Error("quality_missing");
    if (quality.uncertain) return { status: "stopped", reason: "quality_uncertain", detail: quality.soft_failures, attemptNo, used, allowed, quality };
    if (!quality.retry_recommended || used >= allowed) return { status: "stopped", reason: "quality_failed", detail: [...quality.hard_failures, ...quality.soft_failures], attemptNo, used, allowed, quality };
    // Targeted correction by the creative briefing: only the violated aspects change, everything else stays.
    correction = correctionFrom(quality);
    spec = reviseSpecFromFeedback(spec, feedback);
    applied = feedback;
    seenCodes.push(...feedback.map(item => item.code));
  }
}

async function assess(jobId: string, attemptNo: number, asset: OriginalVisualAsset, spec: ImageSpec, deps: VisualProductionDeps,
  set: (fields: string, values: unknown[]) => Promise<unknown>): Promise<{ status: "passed"; asset: OriginalVisualAsset; quality: QualityResult | null; attemptNo: number; checked: boolean; manualOverride: boolean } | { status: "failed"; quality: QualityResult }> {
  if (!deps.gate && qualityGateMode() !== "strict") {
    await set("quality_status='skipped'", []);
    emitEvent("image_quality_skipped", { jobId, attempt: attemptNo });
    return { status: "passed", asset, quality: null, attemptNo, checked: false, manualOverride: false };
  }
  const quality = await (deps.gate ?? (input => checkGeneratedImage(input)))({ url: asset.url, spec });
  const status = quality.approved ? "passed" : quality.uncertain ? "uncertain" : "failed";
  await set("quality_status=$3,quality=$4", [status, JSON.stringify(quality)]);
  emitEvent(quality.approved ? "image_quality_passed" : "image_quality_failed", { jobId, attempt: attemptNo, uncertain: quality.uncertain,
    hard: quality.hard_failures.length, soft: quality.soft_failures.length }, quality.approved ? "info" : "warn");
  return quality.approved ? { status: "passed", asset, quality, attemptNo, checked: true, manualOverride: false } : { status: "failed", quality };
}

const assetOf = (row: Record<string, unknown>, provider: string, model: string): OriginalVisualAsset => ({ url: String(row.image_url), provider, mediaType: "image", model,
  sha256: row.sha256 ? String(row.sha256) : undefined, generatedAt: new Date(String(row.updated_at)).toISOString(), usage: row.prediction_id ? { predictionId: String(row.prediction_id) } : undefined });

// "Bildstatus prüfen": look up the accepted provider job of an unclear attempt (one GET), never a new paid generation.
export async function resumeUnclearVisual(job: ContentJob, contentHash: string, deps: VisualProductionDeps): Promise<VisualOutcome | { status: "pending" | "none" }> {
  const row = (await deps.db.query("SELECT * FROM image_generation_attempts WHERE job_id=$1 AND content_hash=$2 AND status='unclear' ORDER BY attempt_no DESC LIMIT 1", [job.id, contentHash])).rows[0];
  const { used, allowed, changes } = await generationBudget(deps.db, job);
  if (!row) return { status: "none" };
  const attemptNo = Number(row.attempt_no);
  if (!row.prediction_id || !deps.provider.resume) return { status: "stopped", reason: "provider_unclear", detail: ["Für diesen Versuch ist keine Provider-Auftrags-ID gespeichert; das Ergebnis lässt sich nicht automatisch klären."], attemptNo, used, allowed };
  const set = (fields: string, values: unknown[]) => deps.db.query(`UPDATE image_generation_attempts SET ${fields},updated_at=now() WHERE job_id=$1 AND attempt_no=$2`, [job.id, attemptNo, ...values]);
  let found: OriginalVisualAsset | "pending";
  try { found = await deps.provider.resume(String(row.prediction_id), job); }
  catch {
    await set("status='failed'", []);
    return { status: "stopped", reason: "quality_failed", detail: ["Der Provider meldet den Bildauftrag als fehlgeschlagen."], attemptNo, used, allowed };
  }
  if (found === "pending") return { status: "pending" };
  await set("status='generated',image_url=$3,sha256=$4", [found.url, found.sha256 ?? null]);
  const outcome = await assess(job.id, attemptNo, found, imageSpecFor(job, changes), deps, set);
  if (outcome.status === "passed") return outcome;
  return { status: "stopped", reason: outcome.quality.uncertain ? "quality_uncertain" : "quality_failed", detail: [...outcome.quality.hard_failures, ...outcome.quality.soft_failures], attemptNo, used, allowed, quality: outcome.quality };
}

// "Bild trotzdem senden": only an image whose automatic check was uncertain (never one with a hard failure) may go to the
// operator's own approval, explicitly marked as not automatically confirmed.
export async function uncheckedVisual(job: ContentJob, contentHash: string, deps: VisualProductionDeps): Promise<VisualOutcome> {
  const row = (await deps.db.query(`SELECT * FROM image_generation_attempts WHERE job_id=$1 AND content_hash=$2 AND status='generated'
    ORDER BY attempt_no DESC LIMIT 1`, [job.id, contentHash])).rows[0];
  const { used, allowed } = await generationBudget(deps.db, job);
  if (!row || row.quality_status !== "uncertain") return { status: "stopped", reason: "quality_failed", detail: ["Nur ein Bild mit unsicherer Prüfung (ohne harten Fehler) kann manuell zur Freigabe gesendet werden."], attemptNo: row ? Number(row.attempt_no) : null, used, allowed };
  await deps.db.query("UPDATE image_generation_attempts SET quality_status='manual_override',updated_at=now() WHERE job_id=$1 AND attempt_no=$2", [job.id, row.attempt_no]);
  return { status: "passed", asset: assetOf(row, String(row.provider), String(row.model)), quality: row.quality as QualityResult, attemptNo: Number(row.attempt_no), checked: false, manualOverride: true };
}

const REASON_TEXT: Record<StopReason, string> = {
  briefing_invalid: "Das Bildbriefing ist widersprüchlich; ein neues Bild würde den Fehler nur wiederholen.",
  prompt_invalid: "Der Bildauftrag wurde vor der Bestellung gestoppt, weil der Prompt das Briefing nicht erfüllt.",
  budget_exhausted: "Das Bildbudget dieses Auftrags ist ausgeschöpft.",
  daily_budget_exhausted: "Das Tageslimit für kostenpflichtige Bilder ist erreicht (IMAGE_DAILY_GENERATION_LIMIT).",
  concurrent: "Für diesen Auftrag läuft bereits ein Bildversuch.",
  provider_unclear: "Der Bildprovider hat den Auftrag angenommen, das Ergebnis ist noch unklar. Kein automatischer zweiter Versuch; ich bestelle kein neues Bild.",
  quality_failed: "Die automatische Bildprüfung hat das erzeugte Bild abgelehnt.",
  quality_uncertain: "Die automatische Bildprüfung konnte das Bild nicht sicher bewerten; es geht nicht automatisch zur Freigabe.",
};

// Operator notice of a stopped image job, with the manual decisions that fit the reason.
export function stopNoticeText(productName: string, outcome: Extract<VisualOutcome, { status: "stopped" }>) {
  const options = [
    ["quality_failed", "quality_uncertain", "budget_exhausted", "prompt_invalid"].includes(outcome.reason) ? "„Neues Bild“ (genau ein weiterer kostenpflichtiger Versuch; optional mit Wunsch, z. B. „Neues Bild: Pilze größer im Vordergrund“)" : "",
    outcome.reason === "quality_uncertain" ? "„Bild trotzdem senden“ (du prüfst das Bild selbst in der Freigabe)" : "",
    outcome.reason === "provider_unclear" ? "„Bildstatus prüfen“ (fragt den vorhandenen Auftrag ab, kein neues Bild)" : "",
    "„Stopp“",
  ].filter(Boolean);
  return `Bildauftrag „${productName.slice(0, 70)}“ angehalten. ${REASON_TEXT[outcome.reason]}${outcome.detail.length ? `\nGrund: ${outcome.detail.join(" ").replace(/https?:\/\/\S+/g, "").slice(0, 400)}` : ""}
Kostenpflichtige Bildversuche: ${outcome.used} von ${outcome.allowed}. Es wurde nichts zur Freigabe gesendet und nichts veröffentlicht.
Antworte direkt auf diese Nachricht mit ${options.join(" · ")}.`;
}

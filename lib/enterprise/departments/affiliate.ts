// Affiliate Content Studio as the first department behind the contract (task G-01). Read-only adapter.
//
// The studio keeps its own orchestrator (Jarvis), gates and tables; nothing here changes its behaviour. The adapter only
// reads existing evidence tables through named read views, each in a READ ONLY transaction, and reports health and key
// figures. Publication requests are decision-level tasks and are never handled here. No writes, no messages, no model calls.

import type { Database, Sql } from "../../memory/db";
import { createReadCapability, type DepartmentContext, type DepartmentModule, type HealthReport, type ReadView, type TaskEnvelope, type TaskResult } from "../contract";

const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // no draft reached the operator for two days ⇒ degraded
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// Every outcome written to daily_slot_runs by app/api/cron/daily-draft/route.ts and lib/daily/draft.ts, and every WhatsApp
// delivery value (lib/daily/evidence.ts). Tests keep both lists complete in both directions.
export const DAILY_OUTCOMES = {
  draft: "awaiting_approval", // a draft was saved for approval – it counts only if the approval request reached the operator
  failures: ["error", "failed"],
  idle: ["outside_berlin_slot", "already_claimed"], // cron hour outside the Berlin slot, or slot already handled
  neutral: ["needs_input"], // the slot ran but the quality gates found nothing worth a draft
} as const;
export const DELIVERY = {
  delivered: ["approval_sent", "notification_sent"],
  undelivered: ["approval_not_sent", "approval_send_failed", "template_required", "template_rejected"],
} as const;

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "string" && value ? new Date(value).toISOString() : null;
const count = (value: unknown) => value === null || value === undefined ? 0 : Number(value);

async function readOnly(db: Database, work: (sql: Sql) => Promise<Record<string, unknown>[]>) {
  return db.transaction(async sql => { await sql.query("SET TRANSACTION READ ONLY"); return work(sql); });
}

// Named read views of this department. Parameters are bound, never interpolated.
export function affiliateReadViews(db: Database): Record<string, ReadView> {
  return {
    // A run counts as a delivered draft only with a delivered WhatsApp value; a draft or resend whose delivery failed or is
    // pending counts as undelivered. Idle cron calls without delivery information are skipped for the "last result".
    daily_runs: params => readOnly(db, async sql => (await sql.query(`WITH runs AS (
        SELECT invoked_at, outcome, whatsapp,
          (whatsapp = ANY($5::text[]) AND outcome IN ($3, 'already_claimed')) AS delivered,
          ((outcome = $3 AND (whatsapp IS NULL OR NOT whatsapp = ANY($5::text[]))) OR (whatsapp IS NOT NULL AND NOT whatsapp = ANY($5::text[]))) AS undelivered,
          (outcome = ANY($4::text[]) AND whatsapp IS NULL) AS idle
        FROM daily_slot_runs WHERE invoked_at > $1::timestamptz)
      SELECT count(*)::int AS total, count(*) FILTER (WHERE outcome = ANY($2::text[]))::int AS errors,
        count(*) FILTER (WHERE delivered)::int AS drafts, count(*) FILTER (WHERE undelivered)::int AS undelivered,
        max(invoked_at) FILTER (WHERE delivered) AS last_draft_at, max(invoked_at) AS last_at,
        (array_agg(CASE WHEN undelivered THEN 'undelivered' ELSE outcome END ORDER BY invoked_at DESC) FILTER (WHERE NOT idle))[1] AS last_outcome
      FROM runs`,
      [params.since, [...DAILY_OUTCOMES.failures], DAILY_OUTCOMES.draft, [...DAILY_OUTCOMES.idle], [...DELIVERY.delivered]])).rows),
    open_approvals: () => readOnly(db, async sql => (await sql.query(`SELECT
        (SELECT count(*)::int FROM content_approval_requests WHERE status='pending') AS content_pending,
        (SELECT count(*)::int FROM publication_requests WHERE status='pending') AS publication_pending`)).rows),
    // publication_requests holds Facebook posts and Instagram reels (migration 011); images are in instagram_image_posts.
    published: params => readOnly(db, async sql => (await sql.query(`SELECT
        (SELECT count(*)::int FROM publication_requests WHERE status='published' AND platform='facebook' AND updated_at > $1::timestamptz) AS facebook,
        (SELECT count(*)::int FROM publication_requests WHERE status='published' AND platform='instagram' AND updated_at > $1::timestamptz) AS instagram_reels,
        (SELECT count(*)::int FROM instagram_image_posts WHERE status='published' AND updated_at > $1::timestamptz) AS instagram`, [params.since])).rows),
  };
}

export function affiliateContext(db: Database, now: () => Date = () => new Date()): DepartmentContext {
  return { departmentId: "affiliate", now, read: createReadCapability("affiliate", affiliateReadViews(db)) };
}

type Figures = { totalRuns: number; errorRuns: number; drafts: number; undeliveredDrafts: number; lastDraftAt: string | null; lastRunAt: string | null;
  lastOutcome: string | null; contentApprovalsPending: number; publicationApprovalsPending: number; publishedFacebook: number; publishedInstagram: number;
  publishedInstagramReels: number };

async function readFigures(context: DepartmentContext): Promise<Figures> {
  const since = new Date(context.now().getTime() - WINDOW_MS).toISOString();
  const [runs] = await context.read("daily_runs", { since });
  const [open] = await context.read("open_approvals");
  const [published] = await context.read("published", { since });
  return {
    totalRuns: count(runs?.total), errorRuns: count(runs?.errors), drafts: count(runs?.drafts), undeliveredDrafts: count(runs?.undelivered), lastDraftAt: iso(runs?.last_draft_at), lastRunAt: iso(runs?.last_at),
    lastOutcome: runs?.last_outcome ? String(runs.last_outcome) : null,
    contentApprovalsPending: count(open?.content_pending), publicationApprovalsPending: count(open?.publication_pending),
    publishedFacebook: count(published?.facebook), publishedInstagram: count(published?.instagram), publishedInstagramReels: count(published?.instagram_reels),
  };
}

function evaluate(figures: Figures, now: Date): Pick<HealthReport, "status" | "reason"> {
  if (figures.totalRuns === 0) return { status: "unknown", reason: "kein Cron-Aufruf des Tagesentwurfs in den letzten 7 Tagen protokolliert" };
  if ((DAILY_OUTCOMES.failures as readonly string[]).includes(figures.lastOutcome ?? "")) return { status: "degraded", reason: "letzter Tageslauf fehlgeschlagen" };
  if (figures.lastOutcome === "undelivered") return { status: "degraded", reason: "letzte Freigabeanfrage nicht beim Betreiber angekommen" };
  const age = figures.lastDraftAt ? now.getTime() - Date.parse(figures.lastDraftAt) : Infinity;
  if (age < -CLOCK_SKEW_MS) return { status: "degraded", reason: "Zeitstempel des letzten Entwurfs liegt in der Zukunft" };
  if (age > STALE_AFTER_MS) return { status: "degraded", reason: "seit über zwei Tagen kein Entwurf beim Betreiber angekommen" };
  return { status: "ok" };
}

export const affiliateDepartment: DepartmentModule = {
  id: "affiliate",
  contractVersion: 1,
  async health(context) {
    const checkedAt = context.now().toISOString();
    let figures: Figures;
    try { figures = await readFigures(context); }
    catch { return { department: "affiliate", status: "unknown", checkedAt, evidence: [], reason: "Nachweise nicht lesbar (Datenbank oder Tabelle nicht verfügbar)" }; }
    return { department: "affiliate", checkedAt, ...evaluate(figures, context.now()), evidence: [
      { label: "Cron-Aufrufe Tagesentwurf (7 Tage)", value: figures.totalRuns, source: "daily_slot_runs" },
      { label: "davon Fehler", value: figures.errorRuns, source: "daily_slot_runs" },
      { label: "Freigabeanfragen zugestellt (7 Tage)", value: figures.drafts, source: "daily_slot_runs" },
      { label: "Entwürfe ohne Zustellung (7 Tage)", value: figures.undeliveredDrafts, source: "daily_slot_runs" },
      { label: "letzte zugestellte Freigabeanfrage", value: figures.lastDraftAt, source: "daily_slot_runs" },
      { label: "letztes Slot-Ergebnis", value: figures.lastOutcome, source: "daily_slot_runs" },
      { label: "offene Inhaltsfreigaben", value: figures.contentApprovalsPending, source: "content_approval_requests" },
      { label: "offene Veröffentlichungsfreigaben (Facebook und Instagram-Reels)", value: figures.publicationApprovalsPending, source: "publication_requests" },
      { label: "veröffentlicht Facebook (7 Tage)", value: figures.publishedFacebook, source: "publication_requests" },
      { label: "veröffentlicht Instagram-Reels (7 Tage)", value: figures.publishedInstagramReels, source: "publication_requests" },
      { label: "veröffentlicht Instagram-Bilder (7 Tage)", value: figures.publishedInstagram, source: "instagram_image_posts" },
    ] };
  },
  async handle(task: TaskEnvelope, context): Promise<TaskResult> {
    if (task.to !== "affiliate" || task.taskKind !== "affiliate.status_report")
      return { status: "failed", failureClass: "invalid_input", reason: `Aufgabenart ${task.taskKind} wird vom Adapter nicht ausgeführt`, usedCostCents: 0, usedModelCalls: 0 };
    try {
      const figures = await readFigures(context);
      return { status: "succeeded", output: { ...figures, windowDays: 7 }, usedCostCents: 0, usedModelCalls: 0,
        evidence: [{ claim: `${figures.drafts} zugestellte Freigabeanfragen bei ${figures.totalRuns} Cron-Aufrufen in 7 Tagen`, kind: "fact", source: "daily_slot_runs" }] };
    } catch {
      return { status: "failed", failureClass: "provider_error", reason: "Nachweise nicht lesbar", usedCostCents: 0, usedModelCalls: 0 };
    }
  },
};

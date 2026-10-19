// Affiliate Content Studio as the first department behind the contract (task G-01). Read-only adapter.
//
// The studio keeps its own orchestrator (Jarvis), gates and tables; nothing here changes its behaviour. The adapter only
// reads existing evidence tables through named read views, each in a READ ONLY transaction, and reports health and key
// figures. Publication requests are decision-level tasks and are never handled here. No writes, no messages, no model calls.

import type { Database, Sql } from "../../memory/db";
import { createReadCapability, type DepartmentContext, type DepartmentModule, type HealthReport, type ReadView, type TaskEnvelope, type TaskResult } from "../contract";

const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // no draft reached the operator for two days ⇒ degraded
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Outcomes written to daily_slot_runs by app/api/cron/daily-draft/route.ts and lib/daily/draft.ts. A test keeps them in sync.
export const DAILY_OUTCOMES = {
  success: "awaiting_approval", // a draft was sent to the operator for approval
  failures: ["error", "failed"],
  idle: ["outside_berlin_slot", "already_claimed"], // cron hour outside the Berlin slot, or slot already handled
} as const;

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "string" && value ? new Date(value).toISOString() : null;
const count = (value: unknown) => value === null || value === undefined ? 0 : Number(value);

async function readOnly(db: Database, work: (sql: Sql) => Promise<Record<string, unknown>[]>) {
  return db.transaction(async sql => { await sql.query("SET TRANSACTION READ ONLY"); return work(sql); });
}

// Named read views of this department. Parameters are bound, never interpolated.
export function affiliateReadViews(db: Database): Record<string, ReadView> {
  return {
    daily_runs: params => readOnly(db, async sql => (await sql.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE outcome = ANY($2::text[]))::int AS errors, count(*) FILTER (WHERE outcome = $3)::int AS drafts,
        max(invoked_at) FILTER (WHERE outcome = $3) AS last_draft_at, max(invoked_at) AS last_at,
        (array_agg(outcome ORDER BY invoked_at DESC) FILTER (WHERE outcome <> ALL($4::text[])))[1] AS last_outcome
      FROM daily_slot_runs WHERE invoked_at > $1::timestamptz`,
      [params.since, [...DAILY_OUTCOMES.failures], DAILY_OUTCOMES.success, [...DAILY_OUTCOMES.idle]])).rows),
    open_approvals: () => readOnly(db, async sql => (await sql.query(`SELECT
        (SELECT count(*)::int FROM content_approval_requests WHERE status='pending') AS content_pending,
        (SELECT count(*)::int FROM publication_requests WHERE status='pending') AS publication_pending`)).rows),
    published: params => readOnly(db, async sql => (await sql.query(`SELECT
        (SELECT count(*)::int FROM publication_requests WHERE status='published' AND updated_at > $1::timestamptz) AS facebook,
        (SELECT count(*)::int FROM instagram_image_posts WHERE status='published' AND updated_at > $1::timestamptz) AS instagram`, [params.since])).rows),
  };
}

export function affiliateContext(db: Database, now: () => Date = () => new Date()): DepartmentContext {
  return { departmentId: "affiliate", now, read: createReadCapability("affiliate", affiliateReadViews(db)) };
}

type Figures = { totalRuns: number; errorRuns: number; drafts: number; lastDraftAt: string | null; lastRunAt: string | null; lastOutcome: string | null;
  contentApprovalsPending: number; publicationApprovalsPending: number; publishedFacebook: number; publishedInstagram: number };

async function readFigures(context: DepartmentContext): Promise<Figures> {
  const since = new Date(context.now().getTime() - WINDOW_MS).toISOString();
  const [runs] = await context.read("daily_runs", { since });
  const [open] = await context.read("open_approvals");
  const [published] = await context.read("published", { since });
  return {
    totalRuns: count(runs?.total), errorRuns: count(runs?.errors), drafts: count(runs?.drafts), lastDraftAt: iso(runs?.last_draft_at), lastRunAt: iso(runs?.last_at),
    lastOutcome: runs?.last_outcome ? String(runs.last_outcome) : null,
    contentApprovalsPending: count(open?.content_pending), publicationApprovalsPending: count(open?.publication_pending),
    publishedFacebook: count(published?.facebook), publishedInstagram: count(published?.instagram),
  };
}

function evaluate(figures: Figures, now: Date): Pick<HealthReport, "status" | "reason"> {
  if (figures.totalRuns === 0) return { status: "unknown", reason: "kein Cron-Aufruf des Tagesentwurfs in den letzten 7 Tagen protokolliert" };
  if ((DAILY_OUTCOMES.failures as readonly string[]).includes(figures.lastOutcome ?? "")) return { status: "degraded", reason: "letzter Tageslauf fehlgeschlagen" };
  if (!figures.lastDraftAt || now.getTime() - Date.parse(figures.lastDraftAt) > STALE_AFTER_MS) return { status: "degraded", reason: "seit über zwei Tagen kein Entwurf zur Freigabe" };
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
      { label: "Entwürfe zur Freigabe (7 Tage)", value: figures.drafts, source: "daily_slot_runs" },
      { label: "letzter Entwurf zur Freigabe", value: figures.lastDraftAt, source: "daily_slot_runs" },
      { label: "letztes Slot-Ergebnis", value: figures.lastOutcome, source: "daily_slot_runs" },
      { label: "offene Inhaltsfreigaben", value: figures.contentApprovalsPending, source: "content_approval_requests" },
      { label: "offene Veröffentlichungsfreigaben (Facebook)", value: figures.publicationApprovalsPending, source: "publication_requests" },
      { label: "veröffentlicht Facebook (7 Tage)", value: figures.publishedFacebook, source: "publication_requests" },
      { label: "veröffentlicht Instagram (7 Tage)", value: figures.publishedInstagram, source: "instagram_image_posts" },
    ] };
  },
  async handle(task: TaskEnvelope, context): Promise<TaskResult> {
    if (task.to !== "affiliate" || task.taskKind !== "affiliate.status_report")
      return { status: "failed", failureClass: "invalid_input", reason: `Aufgabenart ${task.taskKind} wird vom Adapter nicht ausgeführt`, usedCostCents: 0, usedModelCalls: 0 };
    try {
      const figures = await readFigures(context);
      return { status: "succeeded", output: { ...figures, windowDays: 7 }, usedCostCents: 0, usedModelCalls: 0,
        evidence: [{ claim: `${figures.drafts} Entwürfe zur Freigabe bei ${figures.totalRuns} Cron-Aufrufen in 7 Tagen`, kind: "fact", source: "daily_slot_runs" }] };
    } catch {
      return { status: "failed", failureClass: "provider_error", reason: "Nachweise nicht lesbar", usedCostCents: 0, usedModelCalls: 0 };
    }
  },
};

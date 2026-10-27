// Executive as a department of its own (operator rollout 24.10.2026): status evaluation and prioritisation, read-only.
//
// Deterministic rules over evidence that already exists – the affiliate status report of the same cycle (task ledger),
// open approvals, open decision requests and the cost ledger. The result is an ordered list of internal priorities with the
// evidence behind each one; it is stored as the task result (L2 "prioritize": an internal, reversible note). Nothing here
// sends, publishes, spends, approves or changes a switch – actions that need the operator are named as such. No model call.

import type { Database, Sql } from "../../memory/db";
import { createReadCapability, type DepartmentContext, type DepartmentModule, type ReadView, type TaskEnvelope, type TaskResult } from "../contract";

const REPORT_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const COST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function readOnly(db: Database, work: (sql: Sql) => Promise<Record<string, unknown>[]>) {
  return db.transaction(async sql => { await sql.query("SET TRANSACTION READ ONLY"); return work(sql); });
}

export function executiveReadViews(db: Database): Record<string, ReadView> {
  return {
    // The repository stores { output, evidence, usage } per task; the department's own result is the inner output.
    latest_status_report: () => readOnly(db, async sql => (await sql.query(`SELECT output->'output' AS output, updated_at FROM enterprise_tasks
      WHERE department='affiliate' AND task_kind='affiliate.status_report' AND status='succeeded'
      ORDER BY updated_at DESC LIMIT 1`)).rows),
    open_items: params => readOnly(db, async sql => (await sql.query(`SELECT
        (SELECT count(*)::int FROM enterprise_decisions WHERE status='pending' AND expires_at > $1::timestamptz) AS decisions_pending,
        (SELECT count(*)::int FROM approval_requests WHERE status='pending') AS cost_approvals_pending,
        (SELECT count(*)::int FROM topic_contents WHERE stage IN ('proposed','awaiting_publish_approval')) AS topic_pending,
        (SELECT count(*)::int FROM cost_entries WHERE occurred_at > $2::timestamptz) AS cost_entries,
        (SELECT count(*)::int FROM cost_entries WHERE occurred_at > $2::timestamptz AND amount_micros IS NULL) AS cost_unknown`,
      [params.now, params.costSince])).rows),
  };
}

export function executiveContext(db: Database, now: () => Date = () => new Date()): DepartmentContext {
  return { departmentId: "executive", now, read: createReadCapability("executive", executiveReadViews(db)) };
}

export type Priority = { rank: number; area: string; finding: string; action: string; operatorAction: boolean; source: string };

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);

// The ordering is fixed and reviewable: failures before undelivered drafts before waiting approvals before housekeeping.
export function prioritize(report: Record<string, unknown> | null, reportAt: string | null, open: Record<string, unknown>, now: Date): Priority[] {
  const items: Omit<Priority, "rank">[] = [];
  const age = reportAt ? now.getTime() - Date.parse(reportAt) : Infinity;
  if (!report || age > REPORT_MAX_AGE_MS)
    items.push({ area: "Affiliate", finding: "kein aktueller Statusbericht (älter als 36 h oder fehlt)", action: "Executive-Zyklus und Tagesentwurf prüfen", operatorAction: false, source: "enterprise_tasks" });
  if (report) {
    if (num(report.errorRuns) > 0) items.push({ area: "Affiliate", finding: `${num(report.errorRuns)} fehlgeschlagene Tagesläufe in 7 Tagen`, action: "Ursache im Laufzeitlog prüfen", operatorAction: false, source: "daily_slot_runs" });
    if (num(report.undeliveredDrafts) > 0) items.push({ area: "Affiliate", finding: `${num(report.undeliveredDrafts)} Entwürfe nicht beim Betreiber angekommen (7 Tage)`, action: "WhatsApp-Servicefenster öffnen (Nachricht senden) oder Vorlage aktivieren", operatorAction: true, source: "daily_slot_runs" });
    const approvals = num(report.contentApprovalsPending) + num(report.publicationApprovalsPending);
    if (approvals > 0) items.push({ area: "Affiliate", finding: `${approvals} Freigaben warten (Inhalt ${num(report.contentApprovalsPending)}, Veröffentlichung ${num(report.publicationApprovalsPending)})`, action: "Freigabe per WhatsApp beantworten", operatorAction: true, source: "content_approval_requests, publication_requests" });
  }
  if (num(open.topic_pending) > 0) items.push({ area: "Themen", finding: `${num(open.topic_pending)} Themenbeiträge warten auf Entscheidung`, action: "Vorschlag oder Veröffentlichung per WhatsApp beantworten", operatorAction: true, source: "topic_contents" });
  if (num(open.cost_approvals_pending) > 0) items.push({ area: "Produktion", finding: `${num(open.cost_approvals_pending)} Kostenfreigaben offen`, action: "Kostenfreigabe per WhatsApp beantworten", operatorAction: true, source: "approval_requests" });
  if (num(open.decisions_pending) > 0) items.push({ area: "Executive", finding: `${num(open.decisions_pending)} Entscheidungsvorlagen offen`, action: "Vorlage per WhatsApp beantworten", operatorAction: true, source: "enterprise_decisions" });
  if (num(open.cost_unknown) > 0) items.push({ area: "Controlling", finding: `${num(open.cost_unknown)} von ${num(open.cost_entries)} Kostenzeilen (7 Tage) ohne Preis`, action: "Preise im Preiskatalog pflegen", operatorAction: true, source: "cost_entries" });
  else if (num(open.cost_entries) === 0) items.push({ area: "Controlling", finding: "keine Kostenzeilen in 7 Tagen", action: "Kostenimport prüfen", operatorAction: false, source: "cost_entries" });
  return items.map((item, index) => ({ rank: index + 1, ...item }));
}

async function evaluate(context: DepartmentContext) {
  const now = context.now();
  const [latest] = await context.read("latest_status_report");
  const [open] = await context.read("open_items", { now: now.toISOString(), costSince: new Date(now.getTime() - COST_WINDOW_MS).toISOString() });
  const reportAt = latest?.updated_at instanceof Date ? latest.updated_at.toISOString() : latest?.updated_at ? String(latest.updated_at) : null;
  const report = latest?.output && typeof latest.output === "object" ? latest.output as Record<string, unknown> : null;
  return { reportAt, priorities: prioritize(report, reportAt, open ?? {}, now) };
}

export const executiveDepartment: DepartmentModule = {
  id: "executive",
  contractVersion: 1,
  async health(context) {
    const checkedAt = context.now().toISOString();
    try {
      const { reportAt, priorities } = await evaluate(context);
      const stale = !reportAt || context.now().getTime() - Date.parse(reportAt) > REPORT_MAX_AGE_MS;
      return { department: "executive", checkedAt, status: stale ? "degraded" : "ok", ...(stale ? { reason: "kein aktueller Statusbericht" } : {}),
        evidence: [{ label: "letzter Statusbericht", value: reportAt, source: "enterprise_tasks" }, { label: "offene Prioritäten", value: priorities.length, source: "executive.prioritize" }] };
    } catch { return { department: "executive", status: "unknown", checkedAt, evidence: [], reason: "Nachweise nicht lesbar" }; }
  },
  async handle(task: TaskEnvelope, context): Promise<TaskResult> {
    if (task.to !== "executive" || task.taskKind !== "executive.prioritize")
      return { status: "failed", failureClass: "invalid_input", reason: `Aufgabenart ${task.taskKind} wird nicht ausgeführt`, usedCostCents: 0, usedModelCalls: 0 };
    try {
      const { reportAt, priorities } = await evaluate(context);
      return { status: "succeeded", output: { priorities, statusReportAt: reportAt }, usedCostCents: 0, usedModelCalls: 0,
        evidence: [{ claim: `${priorities.length} Prioritäten aus vorhandenen Nachweisen`, kind: "fact", source: "enterprise_tasks, approvals, cost_entries" }] };
    } catch { return { status: "failed", failureClass: "provider_error", reason: "Nachweise nicht lesbar", usedCostCents: 0, usedModelCalls: 0 }; }
  },
};

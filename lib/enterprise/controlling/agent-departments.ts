// Department attribution of model calls (task E-06). A reviewed static mapping from the `agent` value in model_calls to a
// registry department instead of a new model_calls column (no schema change).
//
// Only exact agent names are mapped; nothing is derived from prefixes. An agent without an entry stays unassigned and is
// listed by name, so a new model call shows up as "nicht zugeordnet" instead of being attributed by guess. A test checks
// that every agent name the code records is mapped. No database, no network: callers pass already aggregated rows.

import { DEPARTMENT_IDS, type DepartmentId } from "../registry";

export const MODEL_AGENT_DEPARTMENTS: Readonly<Record<string, DepartmentId>> = Object.freeze({
  // lib/content/model.ts records `content_${agent}` for the editorial agents of the studio, including the topic pipeline
  // (lib/topic-pipeline: content_text, content_video), which is part of the Content Studio.
  content_orchestrator: "affiliate",
  content_trend: "affiliate",
  content_creative: "affiliate",
  content_image: "affiliate",
  content_video: "affiliate",
  content_text: "affiliate",
  content_marketing: "affiliate",
  image_quality_vision: "affiliate",
  // The WhatsApp router, chat, instructions and transcription serve the studio's operator channel today. Executive agents
  // will record their own agent names (B-08/B-09) and get their own entries.
  whatsapp_router: "affiliate",
  whatsapp_chat: "affiliate",
  whatsapp_instruction: "affiliate",
  whatsapp_transcription: "affiliate",
  whatsapp_video_revision: "affiliate",
  topic_router: "affiliate",
  // Executive kernel (B-08): the AI planner in shadow mode.
  executive_planner: "executive",
});

export function departmentForAgent(agent: unknown): DepartmentId | null {
  return typeof agent === "string" && Object.prototype.hasOwnProperty.call(MODEL_AGENT_DEPARTMENTS, agent) ? MODEL_AGENT_DEPARTMENTS[agent] : null;
}

/** One aggregated row per agent and model, as returned by modelCallSummary (lib/observability/model-calls.ts). */
export type ModelUsageRow = { agent: string; model: string; calls: number; failures: number;
  inputTokens: number | null; outputTokens: number | null; predictTimeS: number | null };

export type UsageTotals = { calls: number; failures: number; inputTokens: number; outputTokens: number; predictTimeS: number;
  /** false if at least one row lacks token or compute metrics or has invalid counts: the sums are then lower bounds. */
  usageComplete: boolean; models: string[] };

export type ModelUsageAllocation = { byDepartment: Record<DepartmentId, UsageTotals>; unassigned: UsageTotals & { agents: string[] } };

const empty = (): UsageTotals => ({ calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, predictTimeS: 0, usageComplete: true, models: [] });
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function add(totals: UsageTotals, row: ModelUsageRow) {
  const calls = count(row.calls), failures = count(row.failures);
  if (calls === null || failures === null) totals.usageComplete = false;
  totals.calls += calls ?? 0;
  totals.failures += failures ?? 0;
  const usage = [count(row.inputTokens), count(row.outputTokens), count(row.predictTimeS)];
  if (usage.includes(null)) totals.usageComplete = false;
  totals.inputTokens += usage[0] ?? 0;
  totals.outputTokens += usage[1] ?? 0;
  totals.predictTimeS += usage[2] ?? 0;
  if (!totals.models.includes(row.model)) totals.models.push(row.model);
}

// Allocates usage rows to departments. Every department appears (with zeros) so a missing department is visible as 0, not absent.
export function allocateModelUsage(rows: readonly ModelUsageRow[]): ModelUsageAllocation {
  const byDepartment = Object.fromEntries(DEPARTMENT_IDS.map(id => [id, empty()])) as Record<DepartmentId, UsageTotals>;
  const unassigned = { ...empty(), agents: [] as string[] };
  for (const row of rows) {
    const owner = departmentForAgent(row.agent);
    if (owner) add(byDepartment[owner], row);
    else {
      add(unassigned, row);
      if (!unassigned.agents.includes(String(row.agent))) unassigned.agents.push(String(row.agent));
    }
  }
  // Rounded once at the end (one decimal, like modelCallSummary) so rounding errors do not accumulate.
  for (const totals of [...Object.values(byDepartment), unassigned]) totals.predictTimeS = Math.round(totals.predictTimeS * 10) / 10;
  return { byDepartment, unassigned };
}

// Opportunity ledger (task F-02): opportunities and their versioned assessments (migration 042).
//
// The stored evaluation and economics are always computed here by the reviewed pure functions – evaluateOpportunity (F-01)
// and assessEconomics (F-04) – from the criteria the caller passes. Weights, thresholds and the payback limit come only from
// the operator-approved operator-config.ts, measured economics are not accepted at all (review #118): a caller (scout,
// executive, operator) can neither store a recommendation of its own nor steer one through its own settings. A
// recommendation is never an approval and starts nothing. No network, no model calls.

import { randomUUID } from "node:crypto";
import type { Database } from "../../memory/db";
import { assessEconomics } from "./economics";
import { ECONOMICS_LIMITS, SCORING_CONFIG } from "./operator-config";
import { evaluateOpportunity, type CriterionAssessment } from "./scoring";

export type OpportunityOrigin = "operator" | "scout" | "executive";
export type ResearchSource = { reference: string; note?: string };
export type AssessmentInput = {
  criteria: readonly CriterionAssessment[];
  research?: readonly ResearchSource[];
  usage?: { modelCalls: number; costCents: number };
  taskId?: string | null;
  createdBy: "operator" | "executive" | "department";
};
export type OpportunitySummary = {
  id: string; title: string; origin: OpportunityOrigin; status: string; updatedAt: string;
  latest: { version: number; recommendation: string; testRecommended: boolean; weightsVersion: string; createdAt: string } | null;
};

export const MAX_RESEARCH_SOURCES = 50;
export const MAX_CRITERIA_BYTES = 64 * 1024;
const MAX_REFERENCE_CHARS = 500;
const MAX_NOTE_CHARS = 500;
const ORIGINS: readonly OpportunityOrigin[] = ["operator", "scout", "executive"];
const CREATORS = ["operator", "executive", "department"];

export class OpportunityInputError extends Error {}

const iso = (value: unknown) => new Date(value as string | Date).toISOString();
const count = (value: unknown, label: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new OpportunityInputError(`${label} muss eine ganze Zahl ≥ 0 sein`);
  return value as number;
};

export async function createOpportunity(db: Database, input: { title: string; summary?: string; origin: OpportunityOrigin; sourceMessageId?: string | null }) {
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!title || title.length > 200) throw new OpportunityInputError("Titel fehlt oder ist länger als 200 Zeichen");
  if (summary.length > 2000) throw new OpportunityInputError("Beschreibung ist länger als 2000 Zeichen");
  if (!ORIGINS.includes(input.origin)) throw new OpportunityInputError("unbekannte Herkunft");
  const sourceMessageId = input.sourceMessageId ?? null;
  const inserted = await db.query(`INSERT INTO opportunities(id,title,summary,origin,source_message_id) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (source_message_id) DO NOTHING RETURNING id`, [randomUUID(), title, summary, input.origin, sourceMessageId]);
  if (inserted.rows[0]) return { id: String(inserted.rows[0].id), created: true };
  // Only a redelivered message can conflict (a NULL source never conflicts): return the opportunity it already created.
  const existing = await db.query("SELECT id FROM opportunities WHERE source_message_id=$1", [sourceMessageId]);
  return { id: String(existing.rows[0].id), created: false };
}

function researchSources(value: readonly ResearchSource[] | undefined) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_RESEARCH_SOURCES) throw new OpportunityInputError(`höchstens ${MAX_RESEARCH_SOURCES} Quellen je Bewertung`);
  return list.map(item => {
    const reference = typeof item?.reference === "string" ? item.reference.trim() : "";
    if (!reference || reference.length > MAX_REFERENCE_CHARS) throw new OpportunityInputError("Quelle ohne Angabe oder zu lang");
    const note = typeof item.note === "string" ? item.note.trim().slice(0, MAX_NOTE_CHARS) : undefined;
    return note ? { reference, note } : { reference };
  });
}

// Records the next version. The opportunity is locked so two assessments of the same idea never get the same version.
export async function recordAssessment(db: Database, opportunityId: string, input: AssessmentInput) {
  if (!CREATORS.includes(input.createdBy)) throw new OpportunityInputError("unbekannter Urheber");
  const criteria = Array.isArray(input.criteria) ? input.criteria : [];
  if (Buffer.byteLength(JSON.stringify(criteria)) > MAX_CRITERIA_BYTES) throw new OpportunityInputError("Kriterien zu umfangreich (höchstens 64 KiB)");
  const evaluation = evaluateOpportunity(criteria, SCORING_CONFIG);
  const economics = assessEconomics({ evaluation, assessments: criteria, measured: null, limits: ECONOMICS_LIMITS });
  const research = researchSources(input.research);
  const modelCalls = count(input.usage?.modelCalls ?? 0, "Modellaufrufe");
  const costCents = count(input.usage?.costCents ?? 0, "Kosten");
  // The version of the weights actually used: only a known total was computed with them.
  const weightsVersion = evaluation.total.status === "known" ? evaluation.total.weightsVersion.slice(0, 80) : "keine Gewichtung";
  return db.transaction(async sql => {
    const opportunity = (await sql.query("SELECT status FROM opportunities WHERE id=$1 FOR UPDATE", [opportunityId])).rows[0];
    if (!opportunity) throw new OpportunityInputError("Opportunity nicht gefunden");
    if (opportunity.status === "rejected" || opportunity.status === "archived") throw new OpportunityInputError("Opportunity ist abgeschlossen");
    const next = Number((await sql.query("SELECT COALESCE(max(version),0)+1 AS v FROM opportunity_assessments WHERE opportunity_id=$1", [opportunityId])).rows[0].v);
    const id = randomUUID();
    await sql.query(`INSERT INTO opportunity_assessments(id,opportunity_id,version,weights_version,criteria,evaluation,economics,recommendation,
        test_recommended,research,model_calls,cost_cents,task_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, opportunityId, next, weightsVersion, JSON.stringify(criteria), JSON.stringify(evaluation), JSON.stringify(economics),
        evaluation.recommendation.status, economics.testRecommended, JSON.stringify(research), modelCalls, costCents, input.taskId ?? null, input.createdBy]);
    await sql.query("UPDATE opportunities SET status='assessed', updated_at=now() WHERE id=$1", [opportunityId]);
    return { id, version: next, recommendation: evaluation.recommendation.status, testRecommended: economics.testRecommended, evaluation, economics };
  });
}

export async function listOpportunities(db: Database, limit = 20): Promise<OpportunitySummary[]> {
  const bounded = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 100);
  const rows = (await db.query(`SELECT o.id, o.title, o.origin, o.status, o.updated_at,
      a.version, a.recommendation, a.test_recommended, a.weights_version, a.created_at AS assessed_at
    FROM opportunities o
    LEFT JOIN LATERAL (SELECT * FROM opportunity_assessments x WHERE x.opportunity_id=o.id ORDER BY x.version DESC LIMIT 1) a ON true
    ORDER BY o.updated_at DESC, o.id LIMIT $1`, [bounded])).rows;
  return rows.map(row => ({
    id: String(row.id), title: String(row.title), origin: row.origin as OpportunityOrigin, status: String(row.status), updatedAt: iso(row.updated_at),
    latest: row.version == null ? null : { version: Number(row.version), recommendation: String(row.recommendation), testRecommended: row.test_recommended === true,
      weightsVersion: String(row.weights_version), createdAt: iso(row.assessed_at) },
  }));
}

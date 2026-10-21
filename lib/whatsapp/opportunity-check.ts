// WhatsApp trigger „Geschäftsidee prüfen: …“ (task F-05). The operator names an idea; the Opportunity Scout researches it
// (F-03, bounded: 3 searches, 1 model call) and stores a versioned assessment (F-02, computed by F-01/F-04). The answer is a
// recommendation to the operator – never an approval and never an order: nothing is started, bought or published.
//
// Only the exact command from the configured approver number is handled; each message counts once (whatsapp_events and the
// opportunity's source message) and at most OPPORTUNITY_DAILY_LIMIT checks run per Berlin day (default 3, at most 10).
// The research runs after the acknowledgement (defer), so the webhook answers Meta at once. Used by the webhook only with
// OPPORTUNITY_SCOUT_ENABLED=true; without that switch nothing here runs and nothing costs.

import type { Database } from "../memory/db";
import { claimResearch, createOperatorOpportunity, recordAssessment, releaseResearch } from "../enterprise/opportunity/ledger";
import { researchOpportunity, MAX_SEARCHES, type ResearchModel, type Search } from "../enterprise/opportunity/research";
import { CRITERIA, CRITERION_IDS, type OpportunityEvaluation } from "../enterprise/opportunity/scoring";

const COMMAND = /^gesch(?:ä|ae)ftsidee\s+pr(?:ü|ue)fen\s*[:\-–]\s*([\s\S]+)$/i;
const DEFAULT_DAILY_LIMIT = 3;

export type OpportunityCheckMessage = { id: string; from: string; body: string; replyToMessageId?: string | null; payload?: unknown };
export type OpportunityCheckDeps = {
  database: () => Database;
  send: (text: string) => Promise<string>;
  // Runs the research after the webhook has answered (next/server `after` in production).
  defer: (work: () => Promise<void>) => void;
  now?: () => Date;
  search?: Search;
  model?: ResearchModel;
};

const digits = (value: string | undefined) => (value || "").replace(/\D/g, "");

export function parseOpportunityCommand(body: string): { title: string; summary: string } | null {
  const match = body.trim().match(COMMAND);
  if (!match) return null;
  const [first, ...rest] = match[1].trim().split(/\r?\n/);
  const title = first.replace(/\s+/g, " ").trim();
  if (title.length < 3) return null;
  return { title: title.slice(0, 200), summary: rest.join("\n").trim().slice(0, 2000) };
}

export function dailyLimit(value = process.env.OPPORTUNITY_DAILY_LIMIT) {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed >= 1 && parsed <= 10 ? parsed : DEFAULT_DAILY_LIMIT;
}

// Short result for WhatsApp: every criterion with its state, the total and what is missing. No invented totals.
export function formatOpportunityResult(title: string, evaluation: OpportunityEvaluation, sources: number, testRecommended: boolean) {
  const lines = [`Geschäftsidee „${title}“ – Bewertung (Vorlage, kein Auftrag)`, ""];
  for (const id of CRITERION_IDS) {
    const state = evaluation.criteria.find(item => item.criterion === id);
    const label = CRITERIA[id].label;
    if (!state || state.state === "missing") lines.push(`– ${label}: keine belastbare Angabe`);
    else if (state.state === "invalid") lines.push(`– ${label}: verworfen (${state.reason})`);
    else lines.push(`– ${label}: ${state.score === null ? "nicht bewertet" : `${state.score}/5`} (Konfidenz ${Math.round(state.confidence * 100)} %)`);
  }
  lines.push("", evaluation.total.status === "known"
    ? `Gesamt: ${evaluation.total.value.toFixed(1)}/5 (Gewichtung ${evaluation.total.weightsVersion})`
    : `Gesamt: unbekannt – ${evaluation.total.reason}`);
  lines.push(`Gesamtkonfidenz: ${Math.round(evaluation.confidence * 100)} % · Quellen: ${sources}`);
  lines.push(`Empfehlung: ${testRecommended ? "Test empfohlen" : evaluation.recommendation.status === "not_recommended" ? "nicht empfohlen" : "keine Empfehlung möglich"}`);
  if (evaluation.recommendation.reasons.length) lines.push(`Gründe: ${evaluation.recommendation.reasons.slice(0, 3).join("; ")}`);
  lines.push("", "Es wurde nichts gestartet, gekauft oder veröffentlicht. Weiter geht es nur mit deiner ausdrücklichen Entscheidung.");
  return lines.join("\n").slice(0, 4000);
}

async function runResearch(db: Database, opportunityId: string, deps: OpportunityCheckDeps) {
  const claimed = await claimResearch(db, opportunityId);
  if (!claimed) return;
  try {
    const result = await researchOpportunity(claimed, { enabled: true, search: deps.search, model: deps.model });
    if (result.status !== "researched") {
      await releaseResearch(db, opportunityId);
      await deps.send(`Geschäftsidee „${claimed.title}“: Recherche nicht möglich (${result.status === "disabled" ? "abgeschaltet" : result.reason}). Nichts bewertet, nichts gestartet.`);
      return;
    }
    // Weights and limits come only from the operator config (Q-07, still open): without them the total stays unknown and
    // nothing is recommended; the single criteria are still shown.
    const stored = await recordAssessment(db, opportunityId, { criteria: result.criteria, research: result.research,
      usage: { modelCalls: result.usage.modelCalls, costCents: 0 }, createdBy: "operator" });
    await deps.send(formatOpportunityResult(claimed.title, stored.evaluation, result.research.length, stored.testRecommended));
  } catch {
    await releaseResearch(db, opportunityId).catch(() => undefined);
    console.error(JSON.stringify({ event: "opportunity_check_failed" }));
    await deps.send(`Geschäftsidee „${claimed.title}“: Prüfung fehlgeschlagen. Nichts bewertet, nichts gestartet.`).catch(() => undefined);
  }
}

export async function handleOpportunityCheck(message: OpportunityCheckMessage, deps: OpportunityCheckDeps): Promise<boolean> {
  const command = parseOpportunityCommand(message.body);
  if (!command) return false;
  const approver = digits(process.env.WHATSAPP_APPROVER_WA_ID);
  if (!approver || digits(message.from) !== approver) return false;
  const db = deps.database();
  const claimed = await db.query(
    "INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",
    [message.id, message.from, message.replyToMessageId ?? null, message.body, JSON.stringify(message.payload ?? {})]);
  if (!claimed.rows.length) return true;
  const created = await createOperatorOpportunity(db, { ...command, sourceMessageId: message.id, dailyLimit: dailyLimit(),
    asOf: (deps.now ?? (() => new Date()))() });
  if (created.status === "duplicate") return true;
  if (created.status === "limit") {
    await deps.send(`Tageslimit für Geschäftsideen erreicht (${created.limit} pro Tag). „${command.title}“ wurde nicht geprüft, nichts gestartet.`);
    return true;
  }
  await deps.send(`Geschäftsidee angenommen: „${command.title}“. Recherche läuft (höchstens ${MAX_SEARCHES} Websuchen, 1 Modellaufruf). Das Ergebnis kommt als eigene Nachricht – als Vorlage, nicht als Auftrag.`);
  deps.defer(() => runResearch(db, created.id, deps));
  return true;
}

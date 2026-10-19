// Opportunity scoring grid (task F-01, target architecture 02 §6): pure functions only.
//
// No database, network, model calls, clock or mutation of inputs. Every criterion assessment states its kind
// (fact / assumption / forecast), a confidence in [0, 1] and its sources; a fact without a source is rejected. Weights and
// thresholds are an operator decision (open question Q-07) and are passed in as a versioned configuration – this module
// ships no default weights. Without valid weights the total is unknown; missing or invalid criteria lower the confidence
// and block the recommendation instead of being estimated. "recommend_test" is only a recommendation to the operator,
// never an approval.

export type CriterionId =
  | "marketPotential" | "targetAudience" | "competition" | "entryBarriers" | "investmentNeed" | "runningCosts"
  | "revenueProfitPotential" | "scalability" | "payback" | "technicalFeasibility" | "automationLevel" | "legalRisks"
  | "thirdPartyDependency" | "trendDuration";
export type EvidenceKind = "fact" | "assumption" | "forecast";
export type AssessmentValue =
  | { type: "number"; amount: number; unit: string }
  | { type: "range"; low: number; high: number; unit: string }
  | { type: "scale"; level: number } // raw 1–5 as observed (e.g. 5 = strong competition); not the favourability score
  | { type: "text"; text: string }
  | { type: "list"; items: string[] };
export type Source = { reference: string; note?: string };
export type CriterionAssessment = {
  criterion: CriterionId;
  kind: EvidenceKind;
  confidence: number;
  sources: Source[];
  value: AssessmentValue;
  // Favourability 1–5, higher is always better for the business; null = not scored (blocks a total if weighted).
  score: number | null;
  rationale?: string;
};
// Operator configuration (Q-07). weights: every criterion, finite and >= 0, sum > 0. Thresholds refer to the total (1–5)
// and the overall confidence (0–1).
export type ScoringConfig = {
  version: string;
  weights: Record<CriterionId, number>;
  minimumTotalScore?: number | null;
  minimumConfidence?: number | null;
};

export type CriterionState = {
  criterion: CriterionId;
  label: string;
  state: "assessed" | "missing" | "invalid";
  reason: string | null;
  score: number | null;
  confidence: number;
};
export type ScoreResult = { status: "known"; value: number; weightsVersion: string } | { status: "unknown"; reason: string };
export type Recommendation = { status: "recommend_test" | "not_recommended" | "blocked"; reasons: string[] };
export type OpportunityEvaluation = {
  criteria: CriterionState[];
  missingCriteria: CriterionId[];
  invalidCriteria: CriterionId[];
  confidence: number;
  total: ScoreResult;
  recommendation: Recommendation;
};

type ValueType = AssessmentValue["type"];
type CriterionRule = { label: string; values: readonly ValueType[]; kinds?: readonly EvidenceKind[] };

// Grid from 02 §6. `kinds` restricts the evidence kind where the architecture demands it.
export const CRITERIA: Readonly<Record<CriterionId, CriterionRule>> = {
  marketPotential: { label: "Marktpotenzial", values: ["number", "range", "text"] },
  targetAudience: { label: "Zielgruppe", values: ["text"] },
  competition: { label: "Wettbewerb", values: ["scale"] },
  entryBarriers: { label: "Eintrittsbarrieren", values: ["scale"] },
  investmentNeed: { label: "Investitionsbedarf", values: ["number", "range"] },
  runningCosts: { label: "Laufende Kosten", values: ["number", "range"] },
  revenueProfitPotential: { label: "Umsatz-/Gewinnpotenzial", values: ["range"], kinds: ["forecast"] },
  scalability: { label: "Skalierbarkeit", values: ["scale"] },
  payback: { label: "Amortisationsdauer", values: ["number", "range"], kinds: ["assumption", "forecast"] },
  technicalFeasibility: { label: "Technische Umsetzbarkeit", values: ["scale"] },
  automationLevel: { label: "Automatisierungsgrad", values: ["number"] },
  legalRisks: { label: "Rechtliche Risiken", values: ["list"] },
  thirdPartyDependency: { label: "Abhängigkeit von Drittanbietern", values: ["list"] },
  trendDuration: { label: "Voraussichtliche Trenddauer", values: ["text", "range"], kinds: ["assumption", "forecast"] },
};
export const CRITERION_IDS = Object.keys(CRITERIA) as CriterionId[];

const KINDS: readonly EvidenceKind[] = ["fact", "assumption", "forecast"];
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isScale = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
const inUnitInterval = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function invalidValue(criterion: CriterionId, value: unknown): string | null {
  if (!isRecord(value)) return "Wert fehlt";
  const type = value.type as ValueType;
  if (!CRITERIA[criterion].values.includes(type)) return `Werttyp ${String(type)} nicht zulässig (erlaubt: ${CRITERIA[criterion].values.join(", ")})`;
  switch (type) {
    case "number":
      if (typeof value.amount !== "number" || !Number.isFinite(value.amount)) return "Zahl ist nicht endlich";
      if (!isText(value.unit)) return "Einheit fehlt";
      if (criterion === "automationLevel" && (value.unit !== "%" || value.amount < 0 || value.amount > 100)) return "Automatisierungsgrad nur in % von 0 bis 100";
      return null;
    case "range":
      if (typeof value.low !== "number" || typeof value.high !== "number" || !Number.isFinite(value.low) || !Number.isFinite(value.high)) return "Spanne ist nicht endlich";
      if (value.low > value.high) return "Spanne: Untergrenze größer als Obergrenze";
      return isText(value.unit) ? null : "Einheit fehlt";
    case "scale":
      return isScale(value.level) ? null : "Skala nur ganzzahlig 1–5";
    case "text":
      return isText(value.text) ? null : "Text fehlt";
    case "list":
      return Array.isArray(value.items) && value.items.every(isText) ? null : "Liste enthält leere oder ungültige Einträge";
  }
  return "unbekannter Werttyp";
}

// Reason why an assessment is unusable, or null.
function invalidAssessment(input: Record<string, unknown>, criterion: CriterionId): string | null {
  const rule = CRITERIA[criterion];
  const kind = input.kind as EvidenceKind;
  if (!KINDS.includes(kind)) return "unbekannte Art (erlaubt: fact, assumption, forecast)";
  if (rule.kinds && !rule.kinds.includes(kind)) return `Art ${kind} nicht zulässig (erlaubt: ${rule.kinds.join(", ")})`;
  if (!inUnitInterval(input.confidence)) return "Konfidenz muss zwischen 0 und 1 liegen";
  if (!Array.isArray(input.sources) || !input.sources.every(source => isRecord(source) && isText(source.reference))) return "Quellen ungültig";
  if (kind === "fact" && input.sources.length === 0) return "Fakt ohne Quelle";
  if (kind === "forecast" && !isText(input.rationale)) return "Prognose ohne offengelegte Formel/Annahmen";
  if (input.score !== null && !isScale(input.score)) return "Bewertung nur ganzzahlig 1–5 oder null";
  const valueProblem = invalidValue(criterion, input.value);
  return valueProblem ? `Wert: ${valueProblem}` : null;
}

function invalidConfig(config: ScoringConfig | null | undefined): string | null {
  if (!isRecord(config)) return "Gewichte fehlen (Betreiberentscheidung Q-07)";
  if (!isText(config.version)) return "Gewichte: Version fehlt";
  if (!isRecord(config.weights)) return "Gewichte fehlen (Betreiberentscheidung Q-07)";
  const extra = Object.keys(config.weights).filter(key => !Object.hasOwn(CRITERIA, key));
  if (extra.length) return `Gewichte: unbekannte Kriterien (${extra.join(", ")})`;
  for (const id of CRITERION_IDS) {
    const weight = config.weights[id];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) return `Gewicht fehlt oder ungültig: ${CRITERIA[id].label}`;
  }
  return CRITERION_IDS.some(id => config.weights[id] > 0) ? null : "Gewichte: Summe ist 0";
}

// Evaluates one opportunity. Total = Σ weight·score / Σ weight over all criteria (weights normalised, scale 1–5); it is
// unknown when the configuration is invalid or a criterion with weight > 0 has no score. Confidence = mean confidence over
// all 14 criteria, missing or invalid criteria count as 0.
export function evaluateOpportunity(assessments: readonly CriterionAssessment[] | null | undefined, config: ScoringConfig | null | undefined): OpportunityEvaluation {
  const list: unknown[] = Array.isArray(assessments) ? assessments : [];
  const byCriterion = new Map<CriterionId, { entry: Record<string, unknown> | null; reason: string | null }>();
  const blocked: string[] = [];
  if (!Array.isArray(assessments)) blocked.push("Bewertungsliste fehlt");
  for (const entry of list) {
    const criterion = isRecord(entry) ? (entry.criterion as CriterionId) : undefined;
    if (!criterion || !Object.hasOwn(CRITERIA, criterion)) { blocked.push(`unbekanntes Kriterium: ${String(criterion)}`); continue; }
    if (byCriterion.has(criterion)) { byCriterion.set(criterion, { entry: null, reason: "mehrfach bewertet" }); continue; }
    const record = entry as Record<string, unknown>;
    const reason = invalidAssessment(record, criterion);
    byCriterion.set(criterion, reason ? { entry: null, reason } : { entry: record, reason: null });
  }
  // Payback is derived from investment and profit range (02 §6): only meaningful when both inputs are usable.
  const payback = byCriterion.get("payback");
  if (payback?.entry && !(byCriterion.get("investmentNeed")?.entry && byCriterion.get("revenueProfitPotential")?.entry)) {
    byCriterion.set("payback", { entry: null, reason: "Amortisation ohne gültigen Investitionsbedarf und Gewinnspanne" });
  }

  const criteria: CriterionState[] = CRITERION_IDS.map(id => {
    const found = byCriterion.get(id);
    if (!found) return { criterion: id, label: CRITERIA[id].label, state: "missing", reason: "nicht bewertet", score: null, confidence: 0 };
    if (!found.entry) return { criterion: id, label: CRITERIA[id].label, state: "invalid", reason: found.reason, score: null, confidence: 0 };
    return { criterion: id, label: CRITERIA[id].label, state: "assessed", reason: null,
      score: found.entry.score as number | null, confidence: found.entry.confidence as number };
  });
  const missingCriteria = criteria.filter(item => item.state === "missing").map(item => item.criterion);
  const invalidCriteria = criteria.filter(item => item.state === "invalid").map(item => item.criterion);
  const confidence = criteria.reduce((sum, item) => sum + item.confidence, 0) / criteria.length;

  const configProblem = invalidConfig(config);
  let total: ScoreResult;
  if (configProblem) total = { status: "unknown", reason: configProblem };
  else {
    const weights = (config as ScoringConfig).weights;
    const unscored = criteria.filter(item => weights[item.criterion] > 0 && item.score === null);
    if (unscored.length) total = { status: "unknown", reason: `ohne Bewertung: ${unscored.map(item => item.label).join(", ")}` };
    else {
      const weightSum = CRITERION_IDS.reduce((sum, id) => sum + weights[id], 0);
      const weighted = criteria.reduce((sum, item) => sum + (weights[item.criterion] > 0 ? weights[item.criterion] * (item.score as number) : 0), 0);
      const value = weighted / weightSum;
      total = Number.isFinite(value) ? { status: "known", value, weightsVersion: (config as ScoringConfig).version.trim() }
        : { status: "unknown", reason: "Gesamtwert nicht endlich" };
    }
  }

  if (missingCriteria.length) blocked.push(`fehlende Kriterien: ${missingCriteria.map(id => CRITERIA[id].label).join(", ")}`);
  for (const item of criteria) if (item.state === "invalid") blocked.push(`${item.label}: ${item.reason}`);
  if (total.status === "unknown") blocked.push(`Gesamtwert unbekannt: ${total.reason}`);
  const minimumTotal = isRecord(config) ? config.minimumTotalScore : undefined;
  const minimumConfidence = isRecord(config) ? config.minimumConfidence : undefined;
  const validTotal = typeof minimumTotal === "number" && Number.isFinite(minimumTotal) && minimumTotal >= 1 && minimumTotal <= 5;
  if (!validTotal) blocked.push("Mindestgesamtwert fehlt oder ungültig (Betreiberentscheidung Q-07)");
  if (!inUnitInterval(minimumConfidence)) blocked.push("Mindestkonfidenz fehlt oder ungültig (Betreiberentscheidung Q-07)");
  else if (confidence < minimumConfidence) blocked.push(`Konfidenz ${confidence.toFixed(2)} unter Mindestwert ${minimumConfidence}`);

  let recommendation: Recommendation;
  if (blocked.length) recommendation = { status: "blocked", reasons: blocked };
  else if ((total as { value: number }).value < (minimumTotal as number)) recommendation = { status: "not_recommended", reasons: [`Gesamtwert unter Mindestwert ${minimumTotal}`] };
  else recommendation = { status: "recommend_test", reasons: [] };
  return { criteria, missingCriteria, invalidCriteria, confidence, total, recommendation };
}

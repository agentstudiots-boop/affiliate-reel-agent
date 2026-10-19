// Economic assessment of an opportunity (task F-04, target architecture 02 §6–7): pure functions only.
//
// Joins an F-01 grid evaluation with the E-05 key figures. Three kinds of numbers stay strictly apart:
// * measured – from a real test phase (revenue, direct costs, investment): contribution margin, simple ROI and simple
//   payback via E-05; anything estimated in it is reported, never mixed into ROI or payback;
// * forecast – from the grid (investment need, revenue/profit range): a payback range, always a range with its formula;
// * scoring – the F-01 recommendation as it is.
// Missing or inconsistent inputs yield "unknown" with a reason – nothing is estimated here. The verdict compares a payback
// with the operator's maximum (a decision of the operator, Q-07); without that limit there is no verdict. A verdict or a
// "test recommended" is never an approval. No database, network, model calls or clock; inputs are not changed.

import { contributionMargin, simplePayback, simpleRoi, type ContributionMargin, type MetricResult, type MoneyInput } from "../controlling/metrics";
import type { CriterionAssessment, OpportunityEvaluation, Recommendation, ScoreResult } from "./scoring";

export type MoneyRange = { lowCents: number; highCents: number; currency: string };
// high = null: in the unfavourable case (lowest profit <= 0) the investment is never paid back.
export type PaybackRange = { lowMonths: number; highMonths: number | null };

export type MeasuredInput = {
  periodMonths: number; // length of the measured test phase, whole months
  revenue: MoneyInput;
  directCosts: readonly MoneyInput[] | null;
  investment: MoneyInput;
};
export type EconomicsLimits = { version: string; maxPaybackMonths?: number | null };

export type MeasuredEconomics = {
  periodMonths: number;
  contribution: MetricResult<ContributionMargin>;
  roiPercent: MetricResult<number>;
  paybackMonths: MetricResult<number>;
};
export type ForecastEconomics = {
  investment: MetricResult<MoneyRange>;
  monthlyProfit: MetricResult<MoneyRange>;
  paybackMonths: MetricResult<PaybackRange>;
  formula: string;
};
export type Verdict = {
  status: "insufficient_data" | "no_operator_limit" | "within_limit" | "outside_limit";
  basis: "measured" | "forecast" | null;
  limitsVersion: string | null;
  reasons: string[];
};
export type EconomicsAssessment = {
  scoring: { recommendation: Recommendation["status"]; total: ScoreResult; confidence: number };
  measured: MeasuredEconomics | null;
  forecast: ForecastEconomics;
  verdict: Verdict;
  // Only a recommendation to the operator: grid recommends a test AND the verdict is within the operator's limit.
  testRecommended: boolean;
};

export const FORECAST_FORMULA = "Amortisation (Monate) = Investition / monatlicher Gewinn; Spanne: niedrigste Investition / höchster Gewinn bis höchste Investition / niedrigster Gewinn";

const unknown = (reason: string): { status: "unknown"; reason: string } => ({ status: "unknown", reason });
const known = <T>(value: T): { status: "known"; value: T } => ({ status: "known", value });
const CURRENCY = /^[A-Z]{3}$/;

// Currency units (e.g. 12.5 EUR) to whole cents; null unless exactly representable in cents and a safe integer.
function toCents(amount: number): number | null {
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && Math.abs(amount * 100 - cents) < 1e-6 ? cents + 0 : null;
}

// Usable assessment of a criterion: assessed by the grid (F-01 validated it) and present in the input list.
function assessed(evaluation: OpportunityEvaluation, assessments: readonly CriterionAssessment[], id: "investmentNeed" | "revenueProfitPotential") {
  const state = evaluation.criteria.find(item => item.criterion === id);
  if (!state || state.state !== "assessed") return unknown(`${state?.label ?? id}: ${state?.reason ?? "nicht bewertet"}`);
  const entry = assessments.find(item => item?.criterion === id);
  return entry ? known(entry) : unknown(`${state.label}: Bewertung fehlt in der Eingabe`);
}

// Investment need as a cent range: a number is a range of one point; the unit must be the currency code itself.
function investmentRange(entry: CriterionAssessment): MetricResult<MoneyRange> {
  const value = entry.value;
  const unit = "unit" in value ? value.unit.trim() : "";
  if (!CURRENCY.test(unit)) return unknown(`Investitionsbedarf: Einheit muss ein Währungscode sein (z. B. EUR), erhalten: ${unit || "keine"}`);
  const [low, high] = value.type === "number" ? [value.amount, value.amount] : value.type === "range" ? [value.low, value.high] : [NaN, NaN];
  const lowCents = toCents(low), highCents = toCents(high);
  if (lowCents === null || highCents === null) return unknown("Investitionsbedarf: Betrag nicht in Cent darstellbar");
  if (lowCents < 0) return unknown("Investitionsbedarf: negativer Betrag");
  return known({ lowCents, highCents, currency: unit });
}

// Monthly profit range; the unit must be "<currency>/Monat". A forecast is always a range (enforced by F-01).
function profitRange(entry: CriterionAssessment): MetricResult<MoneyRange> {
  const value = entry.value;
  if (value.type !== "range") return unknown("Umsatz-/Gewinnpotenzial: nur als Spanne zulässig");
  const match = /^([A-Z]{3})\/Monat$/.exec(value.unit.trim());
  if (!match) return unknown(`Umsatz-/Gewinnpotenzial: Einheit muss <Währung>/Monat sein, erhalten: ${value.unit}`);
  const lowCents = toCents(value.low), highCents = toCents(value.high);
  if (lowCents === null || highCents === null) return unknown("Umsatz-/Gewinnpotenzial: Betrag nicht in Cent darstellbar");
  return known({ lowCents, highCents, currency: match[1] });
}

// Forecast payback range from the grid. Uses the E-05 formula on forecast numbers by passing them as "measured" inputs
// of a pure division – the result is labelled forecast and never mixed with measured figures.
function forecastPayback(investment: MetricResult<MoneyRange>, profit: MetricResult<MoneyRange>): MetricResult<PaybackRange> {
  if (investment.status === "unknown") return unknown(investment.reason);
  if (profit.status === "unknown") return unknown(profit.reason);
  if (investment.value.currency !== profit.value.currency)
    return unknown(`unterschiedliche Währungen (${investment.value.currency}, ${profit.value.currency}) – keine Umrechnung`);
  if (profit.value.highCents <= 0) return unknown("Gewinnspanne nicht positiv: keine Amortisation absehbar");
  const division = (investmentCents: number, profitCents: number) =>
    simplePayback({ amountCents: investmentCents, currency: profit.value.currency, kind: "measured" }, { amountCents: profitCents, currency: profit.value.currency, kind: "measured" });
  const low = division(investment.value.lowCents, profit.value.highCents);
  if (low.status === "unknown") return unknown(low.reason);
  if (profit.value.lowCents <= 0) return known({ lowMonths: low.value, highMonths: null });
  const high = division(investment.value.highCents, profit.value.lowCents);
  return high.status === "unknown" ? unknown(high.reason) : known({ lowMonths: low.value, highMonths: high.value });
}

// Measured figures of a test phase via E-05. ROI and payback only from a purely measured contribution margin; the monthly
// inflow is never rounded: payback = investment · months / contribution (same quotient as investment / monthly inflow).
function measuredEconomics(input: MeasuredInput): MeasuredEconomics {
  const periodMonths = input.periodMonths;
  const contribution = contributionMargin(input.revenue, input.directCosts);
  if (!Number.isSafeInteger(periodMonths) || periodMonths < 1) {
    const reason = "Messzeitraum muss eine ganze Zahl von Monaten ≥ 1 sein";
    return { periodMonths, contribution, roiPercent: unknown(reason), paybackMonths: unknown(reason) };
  }
  if (contribution.status === "unknown")
    return { periodMonths, contribution, roiPercent: unknown(contribution.reason), paybackMonths: unknown(contribution.reason) };
  if (contribution.value.includesEstimates) {
    const reason = "Deckungsbeitrag enthält geschätzte Kosten – ROI und Amortisation nur aus gemessenen Werten";
    return { periodMonths, contribution, roiPercent: unknown(reason), paybackMonths: unknown(reason) };
  }
  const netReturn: MoneyInput = { amountCents: contribution.value.contributionCents, currency: contribution.value.currency, kind: "measured" };
  const roiPercent = simpleRoi(netReturn, input.investment);
  const scaled = typeof input.investment?.amountCents === "number" ? input.investment.amountCents * periodMonths : null;
  const paybackMonths = scaled !== null && !Number.isSafeInteger(scaled) ? unknown("Investition × Monate außerhalb des sicheren Zahlenbereichs")
    : simplePayback({ ...input.investment, amountCents: scaled }, netReturn);
  return { periodMonths, contribution, roiPercent, paybackMonths };
}

function verdictFor(measured: MeasuredEconomics | null, forecast: ForecastEconomics, limits: EconomicsLimits | null | undefined): Verdict {
  // Measured figures win over the forecast; the forecast is judged by its unfavourable end.
  const measuredPayback = measured?.paybackMonths.status === "known" ? measured.paybackMonths.value : null;
  const forecastPaybackRange = forecast.paybackMonths.status === "known" ? forecast.paybackMonths.value : null;
  const basis = measuredPayback !== null ? "measured" : forecastPaybackRange ? "forecast" : null;
  if (!basis) {
    const reasons = [measured ? `gemessen: ${(measured.paybackMonths as { reason: string }).reason}` : "keine Messwerte aus einer Testphase",
      `Prognose: ${(forecast.paybackMonths as { reason: string }).reason ?? "unbekannt"}`];
    return { status: "insufficient_data", basis: null, limitsVersion: null, reasons };
  }
  const max = limits?.maxPaybackMonths;
  const version = typeof limits?.version === "string" && limits.version.trim() ? limits.version.trim() : null;
  if (!version || typeof max !== "number" || !Number.isFinite(max) || max <= 0)
    return { status: "no_operator_limit", basis, limitsVersion: version, reasons: ["maximale Amortisationsdauer nicht festgelegt (Betreiberentscheidung Q-07)"] };
  const months = basis === "measured" ? measuredPayback : forecastPaybackRange!.highMonths;
  if (months === null) return { status: "outside_limit", basis, limitsVersion: version, reasons: ["im ungünstigen Fall keine Amortisation (niedrigster Gewinn ≤ 0)"] };
  const label = basis === "measured" ? "gemessene" : "prognostizierte (ungünstiger Fall)";
  return months <= max
    ? { status: "within_limit", basis, limitsVersion: version, reasons: [] }
    : { status: "outside_limit", basis, limitsVersion: version, reasons: [`${label} Amortisation über ${max} Monaten`] };
}

export function assessEconomics(input: {
  evaluation: OpportunityEvaluation;
  assessments: readonly CriterionAssessment[];
  measured?: MeasuredInput | null;
  limits?: EconomicsLimits | null;
}): EconomicsAssessment {
  const { evaluation } = input;
  const assessments = Array.isArray(input.assessments) ? input.assessments : [];
  const investmentEntry = assessed(evaluation, assessments, "investmentNeed");
  const profitEntry = assessed(evaluation, assessments, "revenueProfitPotential");
  const investment = investmentEntry.status === "known" ? investmentRange(investmentEntry.value) : investmentEntry;
  const monthlyProfit = profitEntry.status === "known" ? profitRange(profitEntry.value) : profitEntry;
  const forecast: ForecastEconomics = { investment, monthlyProfit, paybackMonths: forecastPayback(investment, monthlyProfit), formula: FORECAST_FORMULA };
  const measured = input.measured ? measuredEconomics(input.measured) : null;
  const verdict = verdictFor(measured, forecast, input.limits);
  return {
    scoring: { recommendation: evaluation.recommendation.status, total: evaluation.total, confidence: evaluation.confidence },
    measured, forecast, verdict,
    testRecommended: evaluation.recommendation.status === "recommend_test" && verdict.status === "within_limit",
  };
}

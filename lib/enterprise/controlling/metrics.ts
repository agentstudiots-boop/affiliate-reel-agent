// Controlling key figures (task E-05): pure functions for contribution margin, simple ROI and simple payback.
//
// No database, network, model calls, clock or mutation of inputs. Every amount carries its kind (measured / estimated /
// forecast) and a missing or invalid value yields { status: "unknown", reason } – never a silent zero. Money stays in
// integer cents of one currency; there is no currency conversion and no rounding (display rounding belongs to the caller).
// A contribution margin covers only the direct costs passed in; it is not the company's profit.

export type ValueKind = "measured" | "estimated" | "forecast";
export type MoneyInput = { amountCents: number | null; currency: string; kind: ValueKind };
export type MetricResult<T> = { status: "known"; value: T } | { status: "unknown"; reason: string };

export type ContributionMargin = {
  currency: string;
  measuredRevenueCents: number;
  measuredDirectCostsCents: number;
  estimatedDirectCostsCents: number;
  contributionCents: number;
  includesEstimates: boolean;
};

const KINDS: readonly ValueKind[] = ["measured", "estimated", "forecast"];
const unknown = (reason: string): { status: "unknown"; reason: string } => ({ status: "unknown", reason });

// Reason why `input` is not a usable amount, or null. Negative amounts are a domain decision of each function.
function invalidMoney(input: unknown, label: string, allowNegative: boolean): string | null {
  if (!input || typeof input !== "object") return `${label}: Angabe fehlt`;
  const { amountCents, currency, kind } = input as Partial<MoneyInput>;
  if (amountCents === null || amountCents === undefined) return `${label}: Betrag fehlt`;
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) return `${label}: Betrag ist keine endliche Zahl`;
  if (!Number.isInteger(amountCents)) return `${label}: Betrag enthält Bruchteile von Cent`;
  if (!Number.isSafeInteger(amountCents)) return `${label}: Betrag außerhalb des sicheren Zahlenbereichs`;
  if (!allowNegative && amountCents < 0) return `${label}: negativer Betrag nicht zulässig`;
  if (typeof currency !== "string" || !currency.trim()) return `${label}: Währung fehlt`;
  if (!KINDS.includes(kind as ValueKind)) return `${label}: unbekannte Werteart`;
  return null;
}

// Same currency for all inputs; no conversion.
function mixedCurrency(inputs: readonly MoneyInput[]): string | null {
  const currencies = new Set(inputs.map(input => input.currency.trim()));
  return currencies.size > 1 ? `unterschiedliche Währungen (${[...currencies].join(", ")}) – keine Umrechnung` : null;
}

function safeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

// Revenue (measured) minus direct costs (measured or estimated, reported separately). An empty cost list means confirmed
// zero costs; a missing list is unknown. Forecasts are never mixed into a margin.
export function contributionMargin(revenue: MoneyInput, directCosts: readonly MoneyInput[] | null | undefined): MetricResult<ContributionMargin> {
  const revenueProblem = invalidMoney(revenue, "Erlös", false);
  if (revenueProblem) return unknown(revenueProblem);
  if (revenue.kind !== "measured") return unknown(`Erlös: nur gemessene Werte zulässig, erhalten: ${revenue.kind}`);
  if (!Array.isArray(directCosts)) return unknown("Kostenliste fehlt (leere Liste bedeutet bestätigte Nullkosten)");
  for (const [index, cost] of directCosts.entries()) {
    const problem = invalidMoney(cost, `Kosten ${index + 1}`, false);
    if (problem) return unknown(problem);
    if (cost.kind === "forecast") return unknown(`Kosten ${index + 1}: Prognosen sind im Deckungsbeitrag nicht zulässig`);
  }
  const currency = mixedCurrency([revenue, ...directCosts]);
  if (currency) return unknown(currency);
  const measured = safeSum(directCosts.filter(cost => cost.kind === "measured").map(cost => cost.amountCents as number));
  const estimated = safeSum(directCosts.filter(cost => cost.kind === "estimated").map(cost => cost.amountCents as number));
  if (measured === null || estimated === null) return unknown("Kostensumme außerhalb des sicheren Zahlenbereichs");
  const contribution = (revenue.amountCents as number) - measured - estimated;
  if (!Number.isSafeInteger(contribution)) return unknown("Deckungsbeitrag außerhalb des sicheren Zahlenbereichs");
  return { status: "known", value: {
    currency: revenue.currency.trim(),
    measuredRevenueCents: revenue.amountCents as number,
    measuredDirectCostsCents: measured,
    estimatedDirectCostsCents: estimated,
    contributionCents: contribution,
    includesEstimates: directCosts.some(cost => cost.kind === "estimated"),
  } };
}

// Simple period ROI in percent: netReturn / investment * 100. netReturn is the net gain after its associated costs (may be
// negative); the investment is not subtracted again. Not annualised – both values must cover the same period (caller's duty).
export function simpleRoi(netReturn: MoneyInput, investment: MoneyInput): MetricResult<number> {
  const problem = invalidMoney(netReturn, "Nettoertrag", true) ?? invalidMoney(investment, "Investition", false);
  if (problem) return unknown(problem);
  if (netReturn.kind !== "measured" || investment.kind !== "measured") return unknown("ROI: nur gemessene Werte zulässig");
  const currency = mixedCurrency([netReturn, investment]);
  if (currency) return unknown(currency);
  if ((investment.amountCents as number) <= 0) return unknown("ROI: Investition muss größer als 0 sein");
  const roi = ((netReturn.amountCents as number) / (investment.amountCents as number)) * 100;
  return Number.isFinite(roi) ? { status: "known", value: roi } : unknown("ROI: Ergebnis nicht endlich");
}

// Simple static payback in months: investment / monthly net inflow. No interest, no return forecast. A non-positive
// inflow never pays back (unknown, also for a zero investment).
export function simplePayback(investment: MoneyInput, monthlyNetInflow: MoneyInput): MetricResult<number> {
  const problem = invalidMoney(investment, "Investition", false) ?? invalidMoney(monthlyNetInflow, "Monatlicher Nettozufluss", true);
  if (problem) return unknown(problem);
  if (investment.kind !== "measured" || monthlyNetInflow.kind !== "measured") return unknown("Amortisation: nur gemessene Werte zulässig");
  const currency = mixedCurrency([investment, monthlyNetInflow]);
  if (currency) return unknown(currency);
  if ((monthlyNetInflow.amountCents as number) <= 0) return unknown("Amortisation: monatlicher Nettozufluss muss größer als 0 sein");
  const months = (investment.amountCents as number) / (monthlyNetInflow.amountCents as number);
  return Number.isFinite(months) ? { status: "known", value: months } : unknown("Amortisation: Ergebnis nicht endlich");
}

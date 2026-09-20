import RunwayML from "@runwayml/sdk";

export const RUNWAY_MODEL = "gen4.5" as const;
export const RUNWAY_DURATION_SECONDS = 10;
export const RUNWAY_RATIO = "720:1280" as const;
// Konservative Vorab-Reserve; die API liefert nach dem Start die echten Maximal-Credits.
export const RUNWAY_ESTIMATED_CREDITS = 150;

export function getRunwayClient() {
  if (!process.env.RUNWAYML_API_SECRET) throw new Error("RUNWAYML_API_SECRET fehlt in Vercel.");
  return new RunwayML({ apiKey: process.env.RUNWAYML_API_SECRET });
}

export function monthlyBudgetCredits() {
  const configured = Number(process.env.RUNWAY_MONTHLY_BUDGET_CREDITS ?? "1800");
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 1800;
}

export function currentMonthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { startDate: start.toISOString().slice(0, 10), beforeDate: end.toISOString().slice(0, 10) };
}

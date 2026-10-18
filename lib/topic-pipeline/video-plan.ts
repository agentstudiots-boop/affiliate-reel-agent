import type { ContentFormat } from "../formats/catalog";
import type { Database } from "../memory/db";
import { RUNWAY_DURATION_SECONDS, RUNWAY_ESTIMATED_CREDITS, RUNWAY_RATIO } from "../runway";
import { providerAvailability } from "../visual/availability";
import type { RenderContext } from "../visual/renderers";

// Which provider would render a daily topic video and what it would cost. Pure planning: no provider call, no cost.
// A paid render additionally needs the operator's separate cost approval of exactly this content (orchestrator).
//   TOPIC_VIDEO_MAX_USD             hard ceiling per video (default 5)
//   TOPIC_VIDEO_MONTHLY_BUDGET_USD  ceiling of all cost-approved topic videos per calendar month (default 30)
//   HEYGEN_COST_PER_SECOND_USD      HeyGen estimate (default 0.05 = Avatar IV per developer docs)
// Runway: WAN 3, 30 s, 300 credits ≈ 3 USD (same constants as the live product reel path). Estimates, not invoices.
type Env = Record<string, string | undefined>;

export type VideoPlan = {
  format: Extract<ContentFormat, "STANDARD_VIDEO" | "AVATAR_VIDEO"> | null;
  provider: string;
  seconds: number;
  estimateUsd: number | null;
  basis: string;
  resolution: string;
  blockers: string[];
  notes: string[];
  options: string[];
};

const num = (value: string | undefined, fallback: number) => Number(value) > 0 ? Number(value) : fallback;
export const maxCostPerVideo = (env: Env = process.env) => num(env.TOPIC_VIDEO_MAX_USD, 5);
export const monthlyVideoBudget = (env: Env = process.env) => num(env.TOPIC_VIDEO_MONTHLY_BUDGET_USD, 30);
const runwayUsd = RUNWAY_ESTIMATED_CREDITS / 100;
const heygenUsd = (seconds: number, env: Env) => Math.round(seconds * num(env.HEYGEN_COST_PER_SECOND_USD, 0.05) * 100) / 100;

// Sum of estimates of topic videos whose costs were approved in the current calendar month (Europe/Berlin is close
// enough to UTC for a monthly budget; the stored estimate is what the operator approved).
export async function approvedVideoSpendThisMonth(db: Database, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const row = (await db.query(`SELECT COALESCE(sum((video->>'estimateUsd')::numeric),0)::float AS usd FROM topic_contents
    WHERE video->>'costApprovedAt' IS NOT NULL AND substring(video->>'costApprovedAt',1,7)=$1`, [month])).rows[0];
  return Number(row?.usd ?? 0);
}

export async function planTopicVideo(render: RenderContext, seconds: number, input: { env?: Env; spentThisMonth?: number; now?: Date } = {}): Promise<VideoPlan> {
  const env = input.env ?? process.env;
  const availability = await providerAvailability(render, input.now ?? new Date());
  const options = [
    `HeyGen Avatar (Mia, deutsche Stimme): ca. ${heygenUsd(seconds, env).toFixed(2)} USD für ${seconds} s – ${availability.avatarVideo.available ? "verfügbar" : `nicht verfügbar (${availability.avatarVideo.reason ?? "–"})`}`,
    `Runway WAN 3 (Erzählstimme vom Modell, ${RUNWAY_DURATION_SECONDS} s, ${RUNWAY_RATIO.replace(":", "×")}): ca. ${runwayUsd.toFixed(2)} USD (${RUNWAY_ESTIMATED_CREDITS} Credits) – ${availability.standardVideo.available ? "verfügbar" : `nicht verfügbar (${availability.standardVideo.reason ?? "–"})`}`,
  ];
  let plan: VideoPlan;
  if (availability.avatarVideo.available) {
    plan = { format: "AVATAR_VIDEO", provider: "HeyGen Avatar (Mia)", seconds, estimateUsd: heygenUsd(seconds, env),
      basis: `${num(env.HEYGEN_COST_PER_SECOND_USD, 0.05)} USD/Sekunde (Schätzung; maßgeblich ist der Preis bei HeyGen)`, resolution: "720×1280 (API v2)", blockers: [], notes: [], options };
  } else if (availability.standardVideo.available) {
    plan = { format: "STANDARD_VIDEO", provider: "Runway WAN 3", seconds: RUNWAY_DURATION_SECONDS, estimateUsd: runwayUsd,
      basis: `${RUNWAY_ESTIMATED_CREDITS} Credits laut Runway-Preisliste (Schätzung vor Steuern; EUR unbekannt)`, resolution: RUNWAY_RATIO.replace(":", "×"),
      blockers: [], notes: [`Runway liefert ${RUNWAY_RATIO.replace(":", "×")} statt 1080×1920 und immer ${RUNWAY_DURATION_SECONDS} s.`], options };
  } else {
    plan = { format: null, provider: "kein Videoanbieter aktiv", seconds, estimateUsd: null, basis: "–", resolution: "–",
      blockers: ["Kein Videoanbieter freigeschaltet: Runway braucht TOPIC_STANDARD_VIDEO_PROVIDER=runway und TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT, HeyGen braucht HEYGEN_ENABLED=true samt Avatar, Stimme und Monatslimit."],
      notes: [], options };
  }
  if (plan.estimateUsd !== null && plan.estimateUsd > maxCostPerVideo(env)) plan.blockers.push(`Geschätzte Kosten ${plan.estimateUsd.toFixed(2)} USD über dem Höchstbetrag je Video (${maxCostPerVideo(env).toFixed(2)} USD, TOPIC_VIDEO_MAX_USD).`);
  if (plan.estimateUsd !== null && input.spentThisMonth !== undefined && input.spentThisMonth + plan.estimateUsd > monthlyVideoBudget(env))
    plan.blockers.push(`Monatsbudget für Themenvideos erreicht (${input.spentThisMonth.toFixed(2)} + ${plan.estimateUsd.toFixed(2)} > ${monthlyVideoBudget(env).toFixed(2)} USD, TOPIC_VIDEO_MONTHLY_BUDGET_USD).`);
  // Runway's monthly limit (TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT) is enforced atomically by the video job itself.
  if (plan.format === "AVATAR_VIDEO" && availability.avatarVideo.quotaRemaining === 0) plan.blockers.push("Monatliches HeyGen-Renderlimit erreicht (HEYGEN_MONTHLY_VIDEO_LIMIT).");
  return plan;
}

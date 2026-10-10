import { sameConcept } from "../content/strategy";
import type { CandidateFromTrend, EvidenceItem, TrendOpportunity } from "../content/trend";
import type { Sql } from "../memory/db";
import { emitEvent } from "../observability/events";
import { canonicalConcept, chanceFromTrendCandidate, chanceFromTrendTopic, chanceIdFor, type ContentChance } from "./chance";
import { loadLedger, openRoute, recordChances } from "./repository";
import { routeChance } from "./routing";

// Affiliate pipeline ⇄ Trendsetter. The productive affiliate path is unchanged unless the operator switches this on:
//   TRENDSETTER_AFFILIATE unset/"off" – nothing is stored, nothing is filtered (today's behaviour)
//   "record" – the trend agent's chances (product and topic approaches) are stored as shared research results only
//   "route"  – additionally Jarvis routes every product chance: only chances routed to the affiliate pipeline reach the
//              product scout's Amazon lookup; duplicates and time locks across both pipelines apply.
export type TrendsetterAffiliateMode = "off" | "record" | "route";
export function trendsetterAffiliateMode(env: Record<string, string | undefined> = process.env): TrendsetterAffiliateMode {
  const value = env.TRENDSETTER_AFFILIATE?.trim();
  return value === "record" || value === "route" ? value : "off";
}

export type AffiliateRouting = { mode: TrendsetterAffiliateMode; allowed: Set<string> | null; held: { name: string; reason: string }[]; stored: number };

export async function affiliateTrendsetter(db: Sql, input: { candidates: CandidateFromTrend[]; topics: TrendOpportunity[]; evidence: EvidenceItem[]; now: Date;
  mode: TrendsetterAffiliateMode }): Promise<AffiliateRouting> {
  if (input.mode === "off") return { mode: "off", allowed: null, held: [], stored: 0 };
  const chances: ContentChance[] = [
    ...input.candidates.map(candidate => chanceFromTrendCandidate(candidate, input.now)),
    ...input.topics.map(topic => chanceFromTrendTopic(topic, input.now, input.evidence)),
  ];
  const stored = await recordChances(db, chances, input.now);
  if (input.mode === "record") return { mode: "record", allowed: null, held: [], stored: stored.length };
  const ledger = await loadLedger(db);
  const allowed = new Set<string>();
  const held: AffiliateRouting["held"] = [];
  for (const candidate of input.candidates) {
    const id = chanceIdFor(canonicalConcept(candidate.chance.concept));
    const chance = stored.find(item => item.chance_id === id) ?? stored.find(item => sameConcept(item.concept_key, canonicalConcept(candidate.chance.concept)));
    if (!chance) { held.push({ name: candidate.name, reason: "Trendsetter: Chance nicht gespeichert" }); continue; }
    const route = routeChance(chance, ledger, input.now, ["affiliate"]);
    if (!route.pipelines.includes("affiliate")) { held.push({ name: candidate.name, reason: `Jarvis/Trendsetter: ${route.locks[0] ?? route.reasons.at(-1) ?? route.decision}` }); continue; }
    // Opened before the (paid) Amazon lookup: a repeated or overlapping run does not process the same chance again.
    if (!(await openRoute(db, route, "affiliate", "consumed", candidate.name.slice(0, 120)))) { held.push({ name: candidate.name, reason: "Jarvis/Trendsetter: wird bereits verarbeitet" }); continue; }
    allowed.add(candidate.name);
    emitEvent("trendsetter_routed", { chanceId: chance.chance_id, decision: route.decision, priority: route.priority, pipeline: "affiliate" });
  }
  return { mode: "route", allowed, held, stored: stored.length };
}

import { sameConcept } from "../content/strategy";
import { jaccard, tokens } from "../topics/lexicon";
import type { ContentChance, PipelineTarget } from "./chance";

// Jarvis' central decision about a content chance. Pure and deterministic: the same chances and the same ledger always
// give the same routing. Every decision carries its reasons, so the priority is traceable.
//   affiliate – the product scout searches a matching product only now, for this chance
//   topic     – the topic pipeline develops the content without a mandatory product
//   both      – only with two clearly different content approaches and enough added value
//   hold      – a time lock or duplicate currently blocks it (it can come back later)
//   reject    – too weak, expired or without a usable approach

export type RouteStatus = "routed" | "consumed" | "published" | "rejected" | "expired";
export type LedgerEntry = { chance_id: string; concept_key: string; pipeline: PipelineTarget; status: RouteStatus; at: string };
export type JarvisDecision = "affiliate" | "topic" | "both" | "hold" | "reject";
export type JarvisRoute = { chance_id: string; decision: JarvisDecision; pipelines: PipelineTarget[]; priority: number; reasons: string[]; locks: string[] };

// Time locks (days). Same concept in the same pipeline, a recent rejection, and the same concept in the other pipeline.
export const LOCK_DAYS = { affiliate: 21, topic: 14, rejected: 14, crossPipeline: 7 } as const;
export const MIN_SUITABILITY = 50;
export const MIN_SUITABILITY_BOTH = 70;
// "Both pipelines" needs two different approaches: their wording may overlap at most this much.
export const MAX_ANGLE_OVERLAP = 0.5;

const ageDays = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / 86_400_000;
const LABEL: Record<PipelineTarget, string> = { affiliate: "Affiliate-Pipeline", topic: "Themen-Pipeline" };
const other = (pipeline: PipelineTarget): PipelineTarget => pipeline === "affiliate" ? "topic" : "affiliate";

export function locksFor(chance: Pick<ContentChance, "chance_id" | "concept_key">, ledger: LedgerEntry[], now: Date) {
  const locks: Record<PipelineTarget, string | null> = { affiliate: null, topic: null };
  const crossRecent: Record<PipelineTarget, boolean> = { affiliate: false, topic: false };
  // "routed" = Jarvis already offered this very chance to that pipeline (decision "both"): an invitation, not a lock.
  const invited: Record<PipelineTarget, boolean> = { affiliate: false, topic: false };
  for (const entry of ledger) {
    if (entry.status === "expired") continue;
    if (entry.chance_id !== chance.chance_id && !sameConcept(entry.concept_key, chance.concept_key)) continue;
    if (entry.status === "routed") { if (entry.chance_id === chance.chance_id) invited[entry.pipeline] = true; continue; }
    const age = ageDays(entry.at, now);
    if (entry.status === "rejected") {
      if (age <= LOCK_DAYS.rejected) locks[entry.pipeline] ??= `In der ${LABEL[entry.pipeline]} vor ${Math.floor(age)} Tag(en) abgelehnt`;
      continue;
    }
    if (age <= LOCK_DAYS[entry.pipeline]) locks[entry.pipeline] ??= `Bereits in der ${LABEL[entry.pipeline]} (${entry.status}) vor ${Math.floor(age)} Tag(en)`;
    if (age <= LOCK_DAYS.crossPipeline) crossRecent[other(entry.pipeline)] = true;
  }
  return { locks, crossRecent, invited };
}

export const distinctAngles = (a: string | null, b: string | null) => !!a && !!b && jaccard(tokens(a), tokens(b)) < MAX_ANGLE_OVERLAP;

export function routeChance(chance: ContentChance, ledger: LedgerEntry[], now: Date, wanted?: PipelineTarget[]): JarvisRoute {
  const reasons: string[] = [];
  const base = { chance_id: chance.chance_id, pipelines: [] as PipelineTarget[], locks: [] as string[] };
  // Priority: suitability plus documented bonuses and penalties.
  let priority = chance.suitability;
  reasons.push(`Eignung ${chance.suitability}`);
  if (chance.scores.timeliness.score >= 75) { priority += 5; reasons.push("+5 hohe Aktualität"); }
  if (chance.origins.length > 1) { priority += 8; reasons.push("+8 von beiden Recherchewegen gefunden"); }
  if (chance.sources.filter(source => source.url).length >= 2) { priority += 3; reasons.push("+3 mehrere Quellen"); }
  if (Date.parse(chance.valid_until) < now.getTime()) return { ...base, decision: "reject", priority: 0, reasons: [...reasons, "Chance abgelaufen"] };
  if (chance.suitability < MIN_SUITABILITY) return { ...base, decision: "reject", priority, reasons: [...reasons, `Eignung unter ${MIN_SUITABILITY}`] };
  if (chance.recommendation === "none") return { ...base, decision: "reject", priority, reasons: [...reasons, ...chance.recommendation_reasons, "Kein verwertbarer Ansatz"] };

  let pipelines: PipelineTarget[] = chance.recommendation === "both" ? ["affiliate", "topic"] : [chance.recommendation];
  if (wanted) pipelines = pipelines.filter(item => wanted.includes(item));
  const { locks, crossRecent, invited } = locksFor(chance, ledger, now);
  const locked: string[] = [];
  for (const pipeline of [...pipelines]) {
    const lock = locks[pipeline] ?? (crossRecent[pipeline] && !invited[pipeline] ? `Gleiches Konzept in den letzten ${LOCK_DAYS.crossPipeline} Tagen in der ${LABEL[other(pipeline)]}` : null);
    if (lock) { locked.push(lock); pipelines = pipelines.filter(item => item !== pipeline); }
  }
  if (!pipelines.length) return { ...base, decision: locked.length ? "hold" : "reject", priority, reasons: [...reasons, ...(locked.length ? [] : ["Für diese Pipeline nicht vorgesehen"])], locks: locked };

  if (pipelines.length === 2) {
    if (!distinctAngles(chance.affiliate_angle, chance.topic_angle)) {
      pipelines = ["topic"];
      reasons.push("Beide Pipelines nur mit unterschiedlichem Ansatz – Ansätze zu ähnlich, daher nur Themen-Pipeline (Vertrauen vor Verkauf)");
    } else if (chance.suitability < MIN_SUITABILITY_BOTH) {
      pipelines = ["topic"];
      reasons.push(`Beide Pipelines erst ab Eignung ${MIN_SUITABILITY_BOTH} (zusätzlicher Nutzwert nicht ausreichend belegt) – daher nur Themen-Pipeline`);
    } else reasons.push("Zwei unterschiedliche Ansätze mit zusätzlichem Nutzwert: Themenbeitrag und Produktbeitrag");
  }
  const decision: JarvisDecision = pipelines.length === 2 ? "both" : pipelines[0];
  reasons.push(...chance.recommendation_reasons);
  return { ...base, decision, pipelines, priority, reasons, locks: locked };
}

// Traceable order: priority, then suitability, then chance_id (stable).
export function prioritize(chances: ContentChance[], ledger: LedgerEntry[], now: Date, wanted?: PipelineTarget[]) {
  return chances.map(chance => ({ chance, route: routeChance(chance, ledger, now, wanted) }))
    .sort((a, b) => b.route.priority - a.route.priority || b.chance.suitability - a.chance.suitability || a.chance.chance_id.localeCompare(b.chance.chance_id));
}

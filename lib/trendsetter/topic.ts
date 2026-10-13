import type { SelectionHistory } from "../content/strategy";
import type { Sql } from "../memory/db";
import { emitEvent } from "../observability/events";
import { applyRevision, topicGate } from "../topics/gate";
import { evaluateHistory, type TopicHistoryEntry } from "../topics/history";
import type { RawSignal, TopicCandidate } from "../topics/schema";
import { buildCandidate } from "../topics/scout";
import type { TopicSelection } from "../topics/discovery";
import { chanceFromTopicCandidate, type ContentChance } from "./chance";
import { loadLedger, openChances, openRoute, recordChances } from "./repository";
import { prioritize, type JarvisRoute } from "./routing";

// Topic pipeline ⇄ Trendsetter. The topic scout's accepted candidates and the still valid shared chances of the trend
// agent (recommended for topics) are compared in one list; Jarvis routes and prioritizes them. Only a chance Jarvis
// routes to the topic pipeline becomes a proposal, and its route is opened before anything is sent (no double work).

export type TopicPick = { candidate: TopicCandidate; cluster: { title: string; signals: RawSignal[] } | null; chance: ContentChance; route: JarvisRoute };
export type TopicJarvisResult = { pick: TopicPick | null; considered: { chance_id: string; title: string; decision: string; priority: number; reasons: string[] }[] };

// A shared chance from the trend agent becomes a topic candidate through the topic scout's own scoring and Jarvis' topic
// gate (same rules as every other topic). Its research hits are Tavily results, the same source the topic scout uses.
export function clusterFromChance(chance: ContentChance, now: Date): { title: string; signals: RawSignal[] } | null {
  const signals: RawSignal[] = chance.sources.filter(source => source.url).slice(0, 6).map(source => ({ source: "tavily_news", kind: "news", title: (source.title || chance.title).slice(0, 300),
    snippet: "", url: source.url, publisher: source.publisher, publisherUrl: null, publishedAt: null, eventDate: null, fetchedAt: now.toISOString(), strength: 0.5, tags: [] }));
  return signals.length ? { title: chance.title, signals } : null;
}

function sharedCandidate(chance: ContentChance, now: Date, history: TopicHistoryEntry[], productHistory?: SelectionHistory) {
  const cluster = clusterFromChance(chance, now);
  if (!cluster) return null;
  const built = buildCandidate(cluster, now);
  if ("error" in built) return null;
  if (evaluateHistory(built, history, now, productHistory).blocked) return null;
  const verdict = topicGate(built, { now, history, productHistory });
  if (!["accept", "revise"].includes(verdict.decision)) return null;
  return { candidate: applyRevision(built, verdict), cluster };
}

export async function jarvisSelectTopic(db: Sql, input: { selection: TopicSelection; now: Date; exclude?: string[]; history: TopicHistoryEntry[]; productHistory?: SelectionHistory;
  contentIdFor: () => string }): Promise<TopicJarvisResult & { contentId: string | null }> {
  const { selection, now } = input;
  const accepted = [selection.selected, ...selection.alternatives].filter((item): item is TopicCandidate => !!item && !input.exclude?.includes(item.topic_id));
  const byChance = new Map<string, { candidate: TopicCandidate; cluster: TopicPick["cluster"] }>();
  const chances: ContentChance[] = [];
  for (const candidate of accepted) {
    const chance = chanceFromTopicCandidate(candidate);
    if (byChance.has(chance.chance_id)) continue;
    byChance.set(chance.chance_id, { candidate, cluster: selection.scout?.clusters[candidate.topic_id] ?? null });
    chances.push(chance);
  }
  // Shared research results: valid chances of the trend agent with a topic approach.
  for (const shared of await openChances(db, now, ["topic", "both"]).catch(() => [] as ContentChance[])) {
    if (byChance.has(shared.chance_id) || !shared.origins.includes("trend_agent")) continue;
    const converted = sharedCandidate(shared, now, input.history, input.productHistory);
    if (!converted || input.exclude?.includes(converted.candidate.topic_id)) continue;
    byChance.set(shared.chance_id, converted);
    chances.push(shared);
  }
  const stored = await recordChances(db, chances, now);
  const ledger = await loadLedger(db);
  const ranked = prioritize(stored, ledger, now, ["topic"]);
  const considered = ranked.map(({ chance, route }) => ({ chance_id: chance.chance_id, title: chance.title.slice(0, 80), decision: route.decision, priority: route.priority,
    reasons: [...route.reasons, ...route.locks].slice(0, 6) }));
  for (const { chance, route } of ranked) {
    if (!route.pipelines.includes("topic")) continue;
    const entry = byChance.get(chance.chance_id);
    if (!entry) continue;
    const contentId = input.contentIdFor();
    if (!(await openRoute(db, route, "topic", "consumed", contentId))) continue; // already being processed
    // "both": the product approach is offered to the affiliate pipeline as an open route (it decides and searches the product itself).
    if (route.pipelines.includes("affiliate")) await openRoute(db, route, "affiliate", "routed", null);
    emitEvent("trendsetter_routed", { chanceId: chance.chance_id, decision: route.decision, priority: route.priority, contentId });
    return { pick: { candidate: entry.candidate, cluster: entry.cluster, chance, route }, considered, contentId };
  }
  emitEvent("trendsetter_routed", { chanceId: null, decision: "none", considered: considered.length });
  return { pick: null, considered, contentId: null };
}

import { sameConcept, type SelectionHistory } from "../content/strategy";
import { jaccard, tokens } from "./lexicon";
import type { TopicCandidate } from "./schema";

// Topic history and cooldown. Shares the concept similarity of the product trend scout (sameConcept) and also
// reads its product selection history, so a topic does not repeat a concept that was just posted as a product.

export type TopicHistoryStatus = "proposed" | "approved" | "published" | "rejected" | "discarded";
export type TopicHistoryEntry = {
  topic_id: string; concept_key: string; title: string; hook: string; audience_problem: string;
  status: TopicHistoryStatus; at: string;
};

export const COOLDOWN_DAYS = { published: 30, approved: 21, rejected: 14, discarded: 7, proposed: 7, similarHook: 21, sameProblem: 10 } as const;
const MAX_PROPOSALS_WITHOUT_APPROVAL = 2;

export type HistoryVerdict = { blocked: boolean; hookRepeated: boolean; reasons: string[]; penalty: number };

const ageDays = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / 86_400_000;
export const similarTitle = (a: string, b: string) => jaccard(tokens(a), tokens(b)) >= 0.5;
export const similarHook = (a: string, b: string) => jaccard(tokens(a), tokens(b)) >= 0.6;

export function evaluateHistory(candidate: Pick<TopicCandidate, "topic_id" | "concept_key" | "title" | "hook" | "audience_problem">,
  entries: TopicHistoryEntry[], now: Date, products?: SelectionHistory): HistoryVerdict {
  const reasons: string[] = [];
  let blocked = false, hookRepeated = false, penalty = 0;
  const window = (entry: TopicHistoryEntry) => ageDays(entry.at, now) <= COOLDOWN_DAYS[entry.status];
  const same = (entry: TopicHistoryEntry) => entry.topic_id === candidate.topic_id || sameConcept(entry.concept_key, candidate.concept_key) || similarTitle(entry.title, candidate.title);
  for (const entry of entries) {
    if (entry.topic_id === candidate.topic_id && entry.status === "proposed") continue; // counted below
    if (!same(entry) || !window(entry)) continue;
    if (entry.status === "published" || entry.status === "approved") { blocked = true; reasons.push(`Ähnliches Thema bereits ${entry.status === "published" ? "veröffentlicht" : "freigegeben"} (${entry.title.slice(0, 60)})`); }
    else if (entry.status === "rejected") { blocked = true; reasons.push(`Ähnliches Thema kürzlich abgelehnt (${entry.title.slice(0, 60)})`); }
    else if (entry.status === "discarded") { penalty += 15; reasons.push("Ähnliches Thema kürzlich von Jarvis verworfen"); }
  }
  const proposals = entries.filter(entry => entry.topic_id === candidate.topic_id && entry.status === "proposed" && ageDays(entry.at, now) <= COOLDOWN_DAYS.proposed).length;
  const approvedSince = entries.some(entry => entry.topic_id === candidate.topic_id && ["approved", "published"].includes(entry.status));
  if (proposals >= MAX_PROPOSALS_WITHOUT_APPROVAL && !approvedSince) { blocked = true; reasons.push(`Bereits ${proposals}× vorgeschlagen ohne Freigabe`); }
  if (entries.some(entry => ageDays(entry.at, now) <= COOLDOWN_DAYS.similarHook && entry.status !== "discarded" && similarHook(entry.hook, candidate.hook))) {
    hookRepeated = true; reasons.push("Sehr ähnlicher Hook wurde kürzlich verwendet");
  }
  if (entries.some(entry => ageDays(entry.at, now) <= COOLDOWN_DAYS.sameProblem && ["published", "approved"].includes(entry.status)
    && jaccard(tokens(entry.audience_problem), tokens(candidate.audience_problem)) >= 0.6)) { penalty += 15; reasons.push("Gleiche Problemstellung kürzlich behandelt"); }
  if (products) {
    const concept = candidate.concept_key;
    if (products.rejected.some(item => sameConcept(item.concept, concept))) { blocked = true; reasons.push("Konzept wurde kürzlich als Produktbeitrag abgelehnt"); }
    else if (products.recent.some(item => sameConcept(item.concept, concept))) { penalty += 10; reasons.push("Konzept kürzlich als Produktbeitrag verwendet"); }
  }
  return { blocked, hookRepeated, reasons, penalty };
}

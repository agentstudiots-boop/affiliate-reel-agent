import { emitEvent } from "../observability/events";
import type { SelectionHistory } from "../content/strategy";
import { applyRevision, combineTopicVerdicts, logGate, topicGate, type ModelTopicOpinion, type TopicGateVerdict } from "./gate";
import type { TopicHistoryEntry } from "./history";
import { buildCandidate, runTopicScout, type ScoutOptions } from "./scout";
import type { ScoutResult, TopicCandidate } from "./schema";

// Jarvis step after the scout: gate every candidate, ask for at most two text variants where Jarvis requests one,
// select the strongest accepted topic. Pure apart from the injected scout; never throws.

export const MAX_TOPIC_VARIANTS = 2;

export type TopicSelection = {
  scout: ScoutResult | null;
  candidates: TopicCandidate[];       // after revisions / variants
  verdicts: TopicGateVerdict[];
  selected: TopicCandidate | null;
  alternatives: TopicCandidate[];     // further accepted topics (for "Neues Thema")
  failure: string | null;
};

export function gateCandidates(scout: ScoutResult, context: { now: Date; history?: TopicHistoryEntry[]; productHistory?: SelectionHistory;
  modelOpinions?: Record<string, ModelTopicOpinion | null> }) {
  const candidates: TopicCandidate[] = [];
  const verdicts: TopicGateVerdict[] = [];
  for (const original of scout.candidates) {
    let candidate = original;
    let verdict = combineTopicVerdicts(topicGate(candidate, context), context.modelOpinions?.[candidate.topic_id]);
    for (let variant = 1; verdict.decision === "request_variant" && variant <= MAX_TOPIC_VARIANTS; variant++) {
      const cluster = scout.clusters[candidate.topic_id];
      const next = cluster ? buildCandidate(cluster, context.now, variant) : null;
      if (!next || "error" in next) break;
      candidate = next;
      verdict = combineTopicVerdicts(topicGate(candidate, context), context.modelOpinions?.[candidate.topic_id]);
    }
    // A variant request that could not be satisfied is a rejection: no weak topic goes to the operator.
    if (verdict.decision === "request_variant") verdict = { ...verdict, decision: "reject", reasons: [...verdict.reasons, `Keine bessere Variante nach ${MAX_TOPIC_VARIANTS} Versuchen`] };
    candidate = applyRevision(candidate, verdict);
    logGate(scout.runId, verdict);
    candidates.push(candidate);
    verdicts.push(verdict);
  }
  const accepted = candidates.filter((_, index) => ["accept", "revise"].includes(verdicts[index].decision))
    .sort((a, b) => b.relevance_score - a.relevance_score || a.risk_score - b.risk_score);
  return { candidates, verdicts, accepted };
}

export async function discoverTopic(options: ScoutOptions & { scout?: (options: ScoutOptions) => Promise<ScoutResult>;
  modelOpinions?: Record<string, ModelTopicOpinion | null>; exclude?: string[] }): Promise<TopicSelection> {
  let scout: ScoutResult;
  try { scout = await (options.scout ?? runTopicScout)(options); }
  catch (error) {
    // The scout is isolated: its failure ends only the topic run, never the product pipeline.
    const failure = error instanceof Error ? error.name : "unknown";
    emitEvent("topic_pipeline_failed", { stage: "scout", failure }, "error");
    return { scout: null, candidates: [], verdicts: [], selected: null, alternatives: [], failure: `scout_failed:${failure}` };
  }
  const gated = gateCandidates(scout, { now: options.now, history: options.history, productHistory: options.productHistory, modelOpinions: options.modelOpinions });
  const usable = gated.accepted.filter(candidate => !options.exclude?.includes(candidate.topic_id));
  const selected = usable[0] ?? null;
  if (selected) emitEvent("topic_candidate_selected", { runId: scout.runId, topicId: selected.topic_id, trendType: selected.trend_type, relevance: selected.relevance_score });
  return { scout, candidates: gated.candidates, verdicts: gated.verdicts, selected, alternatives: usable.slice(1, 4), failure: selected ? null : "no_accepted_topic" };
}

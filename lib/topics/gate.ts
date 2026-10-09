import { z } from "zod";
import { UNSUPPORTED_CLAIM_PATTERN } from "../content/trend";
import { emitEvent } from "../observability/events";
import type { SelectionHistory } from "../content/strategy";
import { evaluateHistory, type TopicHistoryEntry } from "./history";
import { hits } from "./lexicon";
import type { TopicCandidate, TrendType } from "./schema";

// Jarvis topic quality gate. Jarvis stays the control instance: it accepts, revises, requests a new variant or
// rejects. The deterministic rules are authoritative; an optional model opinion can only make the verdict stricter.

export const GATE_DECISIONS = ["accept", "revise", "request_variant", "reject"] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];
export const GATE_CHECKS = ["brand_fit", "facts", "freshness", "risk", "repetition", "quality", "utility", "virality", "tone", "account_fit", "gossip", "unsupported_claims"] as const;
export type GateCheck = (typeof GATE_CHECKS)[number];

export type TopicGateVerdict = {
  topic_id: string;
  decision: GateDecision;
  reasons: string[];
  checks: Record<GateCheck, { passed: boolean; note: string }>;
  revised?: { hook?: string; angle?: string; core_message?: string };
  source: "rules" | "rules+model";
};

export const GATE_POLICY = { minBrandFit: 45, rejectBrandFit: 35, minRelevance: 50, maxRisk: 55, cautionRisk: 40, minNewsFreshness: 45, minHookLength: 25 } as const;

// Types whose content would state that something happened: they need a resilient source.
const FACTUAL: TrendType[] = ["BREAKING_NEWS", "ENTERTAINMENT", "CURIOSITY", "SOCIAL_HYPE", "SEARCH_TREND"];
const SENSATIONAL = /!{2,}|\b[A-ZÄÖÜ]{5,}\b/;

function cleanTone(text: string) {
  return text.replace(/!{2,}/g, "!").replace(/\b(schock|unfassbar|irre|wahnsinn|krass|hammer|sensation|horror)\w*\b[:!]?\s*/gi, "").replace(/\b([A-ZÄÖÜ]{5,})\b/g, word => word[0] + word.slice(1).toLowerCase()).replace(/\s{2,}/g, " ").trim();
}

export function topicGate(candidate: TopicCandidate, context: { now: Date; history?: TopicHistoryEntry[]; productHistory?: SelectionHistory }): TopicGateVerdict {
  const reasons: string[] = [];
  const checks = {} as TopicGateVerdict["checks"];
  const set = (name: GateCheck, passed: boolean, note: string) => { checks[name] = { passed, note }; if (!passed) reasons.push(note); };
  let reject = false, variant = false, revise = false;
  const revised: NonNullable<TopicGateVerdict["revised"]> = {};
  const hasNews = candidate.source_signals.some(signal => signal.kind === "news");
  const factual = FACTUAL.includes(candidate.trend_type) || (hasNews && candidate.fact_status !== "not_applicable");

  // Brand / account fit
  const brandOk = candidate.brand_fit_score >= GATE_POLICY.minBrandFit;
  set("brand_fit", brandOk, brandOk ? `Markenfit ${candidate.brand_fit_score}` : `Schlechter Markenfit (${candidate.brand_fit_score})`);
  if (candidate.brand_fit_score < GATE_POLICY.rejectBrandFit) reject = true;
  else if (!brandOk && candidate.relevance_score < GATE_POLICY.minRelevance + 10) reject = true;

  // Facts
  let factsOk = true, factsNote = candidate.fact_status === "not_applicable" ? "Keine externe Tatsachenbehauptung (Kalender/kuratiert)" : `Quellenlage: ${candidate.fact_status}`;
  if (factual && candidate.fact_status === "unverified") { factsOk = false; factsNote = "Fakt ohne ausreichende Quelle: keine belastbare Meldung"; }
  else if (candidate.sensitive && factual && candidate.fact_status !== "multi_source") { factsOk = false; factsNote = "Sensibles Thema nur aus einer Quelle belegt"; }
  set("facts", factsOk, factsNote);
  if (!factsOk) reject = true;

  // Freshness (only matters for news-driven topics)
  const freshnessOk = !hasNews || candidate.scores.freshness.score >= GATE_POLICY.minNewsFreshness;
  set("freshness", freshnessOk, freshnessOk ? `Aktualität ${candidate.scores.freshness.score}` : `Altes Thema (${candidate.scores.freshness.factors[0] ?? "veraltet"})`);
  if (!freshnessOk) reject = true;

  // Risk
  const riskOk = candidate.risk_score < GATE_POLICY.maxRisk;
  set("risk", riskOk, riskOk ? (candidate.risk_score >= GATE_POLICY.cautionRisk ? `Risiko ${candidate.risk_score}: vorsichtige Tonalität` : `Risiko ${candidate.risk_score}`) : `Zu riskant (${candidate.risk_score}): ${candidate.scores.risk.factors.filter(Boolean)[0] ?? "Risikothema"}`);
  if (!riskOk) reject = true;

  // Gossip / account fit
  set("gossip", !candidate.gossip, candidate.gossip ? "Promi-Klatsch/Sensationsniveau passt nicht zu „Alltäglich leichter“" : "Kein Klatsch");
  if (candidate.gossip) reject = true;
  const accountOk = !["BREAKING_NEWS", "SEARCH_TREND"].includes(candidate.trend_type) || candidate.scores.utility.score >= 30;
  set("account_fit", accountOk, accountOk ? "Passt zum Alltagsfokus des Accounts" : "Reine Nachricht ohne Alltagsbezug passt nicht zum Account");
  if (!accountOk) reject = true;

  // Repetition
  const history = evaluateHistory(candidate, context.history ?? [], context.now, context.productHistory);
  set("repetition", !history.blocked && !history.hookRepeated, history.reasons[0] ?? "Keine Wiederholung");
  if (history.blocked) reject = true;
  else if (history.hookRepeated) variant = true;

  // Quality: relevance after history penalties, hook quality
  const effective = candidate.relevance_score - history.penalty;
  const hookOk = candidate.hook.length >= GATE_POLICY.minHookLength && candidate.hook.trim().toLowerCase() !== candidate.title.trim().toLowerCase();
  const qualityOk = effective >= GATE_POLICY.minRelevance && hookOk;
  set("quality", qualityOk, !hookOk ? "Hook zu kurz oder nur der Titel" : qualityOk ? `Relevanz ${effective}` : `Zu schwach (Relevanz ${effective})`);
  if (effective < GATE_POLICY.minRelevance - 5) reject = true;
  else if (!qualityOk) variant = true;

  // Value: either useful or likely to spread
  const utilityOk = candidate.scores.utility.score >= 30;
  const viralityOk = candidate.virality_score >= 40;
  set("utility", utilityOk || viralityOk, utilityOk ? `Nutzwert ${candidate.scores.utility.score}` : "Geringer Nutzwert");
  set("virality", viralityOk || utilityOk, viralityOk ? `Viralität ${candidate.virality_score}` : "Geringes Viralitätspotenzial");
  if (!utilityOk && !viralityOk) reject = true;

  // Tone: sensational wording is rewritten, not passed through
  const sensational = hits(`${candidate.hook} ${candidate.angle}`, "sensational").length > 0 || SENSATIONAL.test(candidate.hook);
  if (sensational) { revise = true; revised.hook = cleanTone(candidate.hook); }
  set("tone", !sensational, sensational ? "Reißerische Tonalität wird entschärft" : "Sachliche Tonalität");

  // Unsupported claims in our own texts (prices, tests, guarantees, healing promises)
  const claimFields = { hook: candidate.hook, angle: candidate.angle, core_message: candidate.core_message } as const;
  const claimed = (Object.keys(claimFields) as (keyof typeof claimFields)[]).filter(key => UNSUPPORTED_CLAIM_PATTERN.test(claimFields[key]));
  if (claimed.length) {
    if (UNSUPPORTED_CLAIM_PATTERN.test(candidate.title)) reject = true; else variant = true;
  }
  set("unsupported_claims", !claimed.length, claimed.length ? `Unbelegte Aussage in ${claimed.join(", ")}` : "Keine unbelegten Aussagen");

  const decision: GateDecision = reject ? "reject" : variant ? "request_variant" : revise ? "revise" : "accept";
  const verdict: TopicGateVerdict = { topic_id: candidate.topic_id, decision, reasons: reasons.slice(0, 10), checks, ...(revise && !reject ? { revised } : {}), source: "rules" };
  return verdict;
}

export const modelTopicOpinionSchema = z.object({ decision: z.enum(GATE_DECISIONS), reasons: z.array(z.string().max(200)).max(5) }).strict();
export type ModelTopicOpinion = z.infer<typeof modelTopicOpinionSchema>;
const SEVERITY: Record<GateDecision, number> = { accept: 0, revise: 1, request_variant: 2, reject: 3 };

// The model may be stricter, never more lenient: a rule-based reject can never become an accept.
export function combineTopicVerdicts(rules: TopicGateVerdict, model: ModelTopicOpinion | null | undefined): TopicGateVerdict {
  if (!model) return rules;
  const parsed = modelTopicOpinionSchema.safeParse(model);
  if (!parsed.success) return rules;
  if (SEVERITY[parsed.data.decision] <= SEVERITY[rules.decision]) return { ...rules, source: "rules+model" };
  return { ...rules, decision: parsed.data.decision, reasons: [...rules.reasons, ...parsed.data.reasons.map(reason => `Jarvis-Zweitmeinung: ${reason}`)].slice(0, 10), source: "rules+model" };
}

export function applyRevision(candidate: TopicCandidate, verdict: TopicGateVerdict): TopicCandidate {
  if (verdict.decision !== "revise" || !verdict.revised) return candidate;
  const hook = verdict.revised.hook && verdict.revised.hook.length >= 10 ? verdict.revised.hook : candidate.hook;
  return { ...candidate, hook, angle: verdict.revised.angle ?? candidate.angle, core_message: verdict.revised.core_message ?? candidate.core_message };
}

export function logGate(runId: string, verdict: TopicGateVerdict) {
  emitEvent("jarvis_topic_gate_completed", { runId, topicId: verdict.topic_id, decision: verdict.decision, reasons: verdict.reasons.slice(0, 3), source: verdict.source });
  if (verdict.decision === "reject") emitEvent("topic_candidate_rejected", { runId, topicId: verdict.topic_id, stage: "jarvis_gate", reason: verdict.reasons[0] });
}

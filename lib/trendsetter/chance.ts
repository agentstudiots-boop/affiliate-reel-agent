import { createHash } from "node:crypto";
import type { CandidateFromTrend, TrendOpportunity } from "../content/trend";
import { sameConcept } from "../content/strategy";
import { conceptKey } from "../topics/scout";
import type { TopicCandidate, TrendType } from "../topics/schema";

// Trendsetter: one shared format for every content chance, whichever research path found it.
// It does not research itself. The two existing research paths stay the sources and keep their own logic:
//   • trend_agent  – Tavily research + editorial model (lib/content/trend-scout.ts), today feeding the affiliate pipeline
//   • topic_scout  – news/trend/calendar/evergreen signals with rule-based scoring (lib/topics/scout.ts)
// Here their results become comparable chances (ID, sources, timestamps, five scores, recommendation). Jarvis decides
// the routing (./routing.ts); the product scout stays a separate specialist that only runs for affiliate routes.

export type PipelineTarget = "affiliate" | "topic";
export type Recommendation = "affiliate" | "topic" | "both" | "none";
export type ChanceOrigin = "topic_scout" | "trend_agent";
export type ChanceScore = { score: number; factors: string[] };
export const SCORE_DIMENSIONS = ["timeliness", "relevance", "audience_interest", "trust_potential", "reach_potential"] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];
export type ChanceScores = Record<ScoreDimension, ChanceScore>;
export type ChanceSource = { title: string; url: string | null; publisher: string | null; kind: string };

export type ContentChance = {
  chance_id: string;
  concept_key: string;
  title: string;
  hook: string;
  origins: ChanceOrigin[];
  origin_refs: { origin: ChanceOrigin; ref: string }[];
  sources: ChanceSource[];
  detected_at: string;
  valid_until: string;
  scores: ChanceScores;
  suitability: number;
  recommendation: Recommendation;
  recommendation_reasons: string[];
  affiliate_angle: string | null;   // product in everyday use (needs a product idea)
  topic_angle: string | null;       // knowledge, tip or story without a mandatory product
  product_idea: string | null;
  sensitive: boolean;
};

// Weights of the suitability score. Reach and trust are the brand's two goals; trust is never traded for reach.
export const SUITABILITY_WEIGHTS: Record<ScoreDimension, number> = { timeliness: 0.2, relevance: 0.25, audience_interest: 0.2, trust_potential: 0.2, reach_potential: 0.15 };
export const MIN_TRUST_FOR_TOPIC = 50;

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const score = (value: number, ...factors: string[]): ChanceScore => ({ score: clamp(value), factors: factors.filter(Boolean).slice(0, 6) });

// The same concept gets the same chance_id from both research paths, so results are shared instead of duplicated.
export const canonicalConcept = (raw: string) => conceptKey(raw.replace(/[-_]+/g, " "));
export const chanceIdFor = (canonical: string) => `cc_${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;

export function suitabilityOf(scores: ChanceScores) {
  return clamp(SCORE_DIMENSIONS.reduce((sum, key) => sum + scores[key].score * SUITABILITY_WEIGHTS[key], 0));
}

const DAY = 86_400_000;
const SHORT_LIVED: TrendType[] = ["BREAKING_NEWS", "SOCIAL_HYPE", "SEARCH_TREND", "ENTERTAINMENT"];
const MEDIUM_LIVED: TrendType[] = ["EVENT", "SEASONAL"];
export function validityDays(trendType: TrendType | null, seasonal: boolean) {
  if (trendType && SHORT_LIVED.includes(trendType)) return 3;
  if ((trendType && MEDIUM_LIVED.includes(trendType)) || seasonal) return 14;
  return 30;
}

function recommend(chance: Pick<ContentChance, "affiliate_angle" | "topic_angle" | "product_idea" | "sensitive" | "scores">): { recommendation: Recommendation; reasons: string[] } {
  const reasons: string[] = [];
  const affiliate = !!chance.product_idea && !!chance.affiliate_angle && !chance.sensitive;
  const topic = !!chance.topic_angle && chance.scores.trust_potential.score >= MIN_TRUST_FOR_TOPIC;
  if (chance.sensitive && chance.product_idea) reasons.push("Sensibles Thema: kein Produktbezug");
  if (!!chance.topic_angle && !topic) reasons.push(`Vertrauenspotenzial unter ${MIN_TRUST_FOR_TOPIC}: kein Themenbeitrag`);
  if (affiliate) reasons.push("Produktidee mit Anwendungsansatz vorhanden");
  if (topic) reasons.push("Eigenständiger Themenansatz ohne Produktpflicht vorhanden");
  const recommendation: Recommendation = affiliate && topic ? "both" : affiliate ? "affiliate" : topic ? "topic" : "none";
  return { recommendation, reasons };
}

function finish(base: Omit<ContentChance, "suitability" | "recommendation" | "recommendation_reasons">): ContentChance {
  const { recommendation, reasons } = recommend(base);
  return { ...base, suitability: suitabilityOf(base.scores), recommendation, recommendation_reasons: reasons };
}

// ---- adapter: topic scout candidate → chance ----
export function chanceFromTopicCandidate(candidate: TopicCandidate): ContentChance {
  const s = candidate.scores;
  const canonical = canonicalConcept(candidate.concept_key);
  const trustBase = 100 - candidate.risk_score;
  const trust = trustBase * 0.6 + (s.source_quality?.score ?? 50) * 0.4
    + (candidate.fact_status === "multi_source" ? 10 : candidate.fact_status === "unverified" ? -15 : 0)
    - (candidate.sensitive ? 20 : 0) - (candidate.gossip ? 30 : 0);
  const audience = ((s.utility?.score ?? 0) + (s.interaction?.score ?? 0) + candidate.brand_fit_score) / 3;
  const detected = Date.parse(candidate.detected_at);
  return finish({
    chance_id: chanceIdFor(canonical), concept_key: canonical, title: candidate.title, hook: candidate.hook,
    origins: ["topic_scout"], origin_refs: [{ origin: "topic_scout", ref: candidate.topic_id }],
    sources: candidate.source_signals.slice(0, 8).map(signal => ({ title: signal.title.slice(0, 200), url: signal.url, publisher: signal.publisher, kind: signal.kind })),
    detected_at: candidate.detected_at, valid_until: new Date(detected + validityDays(candidate.trend_type, false) * DAY).toISOString(),
    scores: {
      timeliness: score(s.freshness?.score ?? 50, `Aktualität laut Themen-Scout (${candidate.trend_type})`),
      relevance: score(candidate.relevance_score, "Relevanz laut Themen-Scout"),
      audience_interest: score(audience, `Nutzwert ${s.utility?.score ?? 0}`, `Interaktion ${s.interaction?.score ?? 0}`, `Markenpassung ${candidate.brand_fit_score}`),
      trust_potential: score(trust, `Risiko ${candidate.risk_score}`, `Faktenlage: ${candidate.fact_status}`, candidate.sensitive ? "sensibel" : "", candidate.gossip ? "Klatsch" : ""),
      reach_potential: score(candidate.virality_score, "Viralität laut Themen-Scout"),
    },
    // The topic scout only names a product CATEGORY; a concrete product idea comes from the trend agent or the operator.
    affiliate_angle: null, topic_angle: candidate.angle || candidate.core_message || null, product_idea: null,
    sensitive: candidate.sensitive || candidate.gossip,
  });
}

const LEVEL: Record<string, number> = { high: 80, medium: 60, low: 40 };

// ---- adapter: trend agent product opportunity (already through Jarvis' intake) → chance ----
export function chanceFromTrendCandidate(candidate: CandidateFromTrend, now: Date): ContentChance {
  const canonical = canonicalConcept(candidate.chance.concept);
  const c = candidate.chance;
  const audience = 30 + 14 * [c.broadAppeal, c.fun, c.wow, c.gift, c.impulse, c.demonstrable].filter(Boolean).length;
  const cited = candidate.agent.evidence.length;
  const seasonal = candidate.kind === "Saisontrend";
  return finish({
    chance_id: chanceIdFor(canonical), concept_key: canonical, title: candidate.agent.title || candidate.name, hook: c.hook,
    origins: ["trend_agent"], origin_refs: [{ origin: "trend_agent", ref: candidate.agent.title.slice(0, 120) }],
    sources: candidate.agent.evidence.map(item => ({ title: item.title, url: item.url, publisher: null, kind: "research" })),
    detected_at: now.toISOString(), valid_until: new Date(now.getTime() + validityDays(null, seasonal) * DAY).toISOString(),
    scores: {
      timeliness: score(seasonal ? 80 : 45, seasonal ? `Saisonal: ${candidate.season}` : "ganzjährig"),
      relevance: score((candidate.confidence + (100 - (candidate.priority - 1) * 12)) / 2, `Agent-Sicherheit ${candidate.confidence}`, `Priorität ${candidate.priority}`),
      audience_interest: score(audience, c.broadAppeal ? "breite Zielgruppe" : "", c.demonstrable ? "vorführbar" : "", c.fun ? "unterhaltsam" : ""),
      trust_potential: score((cited ? 70 : 45) + (c.demonstrable ? 10 : 0), cited ? `${cited} Recherchequelle(n)` : "keine belegte Quelle", c.demonstrable ? "Nutzen zeigbar" : ""),
      reach_potential: score(LEVEL[candidate.agent.novelty] ?? 50, `Neuheit: ${candidate.agent.novelty}`),
    },
    affiliate_angle: c.hook, topic_angle: null, product_idea: candidate.name, sensitive: false,
  });
}

// ---- adapter: trend agent topic opportunity (kind "topic_opportunity") → chance ----
export function chanceFromTrendTopic(topic: TrendOpportunity, now: Date, evidence: { url: string; title: string }[]): ContentChance {
  const canonical = canonicalConcept(topic.concept);
  const known = new Map(evidence.map(item => [item.url, item]));
  const cited = [...new Set(topic.evidenceUrls)].map(url => known.get(url)).filter((item): item is { url: string; title: string } => !!item).slice(0, 4);
  const s = topic.signals;
  const seasonal = topic.timing.relevance === "high";
  return finish({
    chance_id: chanceIdFor(canonical), concept_key: canonical, title: topic.title, hook: topic.hook,
    origins: ["trend_agent"], origin_refs: [{ origin: "trend_agent", ref: topic.title.slice(0, 120) }],
    sources: cited.map(item => ({ title: item.title.slice(0, 200), url: item.url, publisher: null, kind: "research" })),
    detected_at: now.toISOString(), valid_until: new Date(now.getTime() + validityDays(null, seasonal) * DAY).toISOString(),
    scores: {
      timeliness: score(seasonal ? 80 : topic.timing.relevance === "low" ? 55 : 40, topic.timing.season ?? "ohne Saisonbezug"),
      relevance: score((topic.confidence + (100 - (topic.priority - 1) * 12)) / 2, `Agent-Sicherheit ${Math.round(topic.confidence)}`),
      audience_interest: score(30 + 14 * [s.broadAppeal, s.fun, s.wow, s.gift, s.aesthetic].filter(Boolean).length, topic.targetNeed.slice(0, 80)),
      trust_potential: score(cited.length ? 70 : 45, cited.length ? `${cited.length} Recherchequelle(n)` : "keine belegte Quelle"),
      reach_potential: score(LEVEL[topic.novelty] ?? 50, `Neuheit: ${topic.novelty}`),
    },
    affiliate_angle: null, topic_angle: topic.contentChance, product_idea: null, sensitive: false,
  });
}

// Same concept from several research paths → one chance with merged sources, both angles and the stronger scores.
// Independent confirmation by two research paths raises the trust potential slightly (documented, +5).
export function mergeChances(chances: ContentChance[]): ContentChance[] {
  const merged: ContentChance[] = [];
  for (const chance of chances) {
    const existing = merged.find(item => item.chance_id === chance.chance_id || sameConcept(item.concept_key, chance.concept_key));
    if (!existing) { merged.push(chance); continue; }
    const origins = [...new Set([...existing.origins, ...chance.origins])];
    const sources = [...existing.sources, ...chance.sources].filter((item, index, all) => all.findIndex(other => (other.url ?? other.title) === (item.url ?? item.title)) === index).slice(0, 12);
    const scores = Object.fromEntries(SCORE_DIMENSIONS.map(key => {
      const a = existing.scores[key], b = chance.scores[key];
      const best = a.score >= b.score ? a : b;
      return [key, key === "trust_potential" && origins.length > existing.origins.length ? score(best.score + 5, ...best.factors, "von zwei Recherchewegen bestätigt") : best];
    })) as ChanceScores;
    const next = finish({
      ...existing, origins, sources, scores,
      origin_refs: [...existing.origin_refs, ...chance.origin_refs].filter((item, index, all) => all.findIndex(other => other.origin === item.origin && other.ref === item.ref) === index).slice(0, 8),
      detected_at: existing.detected_at < chance.detected_at ? existing.detected_at : chance.detected_at,
      valid_until: existing.valid_until > chance.valid_until ? existing.valid_until : chance.valid_until,
      affiliate_angle: existing.affiliate_angle ?? chance.affiliate_angle, topic_angle: existing.topic_angle ?? chance.topic_angle,
      product_idea: existing.product_idea ?? chance.product_idea, sensitive: existing.sensitive || chance.sensitive,
    });
    merged[merged.indexOf(existing)] = next;
  }
  return merged;
}

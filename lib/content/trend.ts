import { evidenceItemSchema, trendOpportunitySchema, trendReportSchema, type EvidenceItem, type TrendBrief, type TrendOpportunity, type TrendReport } from "./schema";
import { functionalGroup, sameConcept, type AgentProvenance, type ChanceAssessment, type ContentChance } from "./strategy";

// Interface between Jarvis (orchestrator) and the trend/strategy agent.
// The agent returns structured opportunities; Jarvis never interprets free text.
// `product_opportunity` feeds today's pipeline; `topic_opportunity` is accepted and stored for later
// (topic-based posts) but not produced yet.

// Research and editorial chances must never carry product facts, prices or promises.
const FORBIDDEN = /\d[\d.,]*\s?(?:€|eur\b|euro)|€\s?\d|\b\d{1,3}\s?%\s?(?:rabatt|reduziert|günstiger|sparen)|rabatt|gutschein|angebot des tages|testsieger|stiftung warentest|garantiert|garantie|heilt|heilung|schmerzfrei|ohne nebenwirkungen|klinisch|bewiesen|nie wieder|ich habe .{0,30}getestet|wir haben .{0,30}getestet|amazon'?s choice|bestseller/i;
const URLISH = /https?:\/\/|www\.|\bB0[A-Z0-9]{8}\b|amazon\./i;

export type DroppedOpportunity = { title: string; reason: string };
export type CandidateFromTrend = {
  name: string; searchQuery: string; kind: "Saisontrend" | "Dauerläufer"; category: string; season: string;
  whyNow: string; reelIdea: string; targetGroup: string; benefitsToVerify: string[]; confidence: number;
  chance: ContentChance; priority: number; agent: AgentProvenance; extraPenalties: ChanceAssessment["penalties"];
};

const slug = (value: string) => value.toLocaleLowerCase("de-DE").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// Jarvis-side intake: validate, sanitise, cross-check the agent's own claims, de-duplicate.
export function intakeTrendReport(raw: unknown, evidence: EvidenceItem[]) {
  const dropped: DroppedOpportunity[] = [];
  const parsed = trendReportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_schema" as const, candidates: [], topics: [], dropped, noGoodCandidate: false, rejectedIdeas: [] as TrendReport["rejectedIdeas"] };
  const report = parsed.data;
  const known = new Map(evidence.map(item => [item.url, item]));
  const candidates: CandidateFromTrend[] = [];
  const topics: TrendOpportunity[] = [];
  const concepts: string[] = [];
  for (const item of [...report.opportunities].sort((a, b) => a.priority - b.priority)) {
    const drop = (reason: string) => dropped.push({ title: item.title.slice(0, 80), reason });
    const text = [item.title, item.productIdea ?? "", item.contentChance, item.hook, item.rationale, item.targetNeed, item.shareReason, item.trustRationale, item.reachRationale].join(" ");
    if (FORBIDDEN.test(text)) { drop("unbelegte Preis-, Test-, Garantie- oder Heilaussage"); continue; }
    if (URLISH.test(`${item.title} ${item.productIdea ?? ""}`)) { drop("Link oder ASIN statt Produktidee"); continue; }
    const concept = slug(item.concept);
    if (concept.length < 2) { drop("Content-Konzept fehlt"); continue; }
    if (concepts.some(existing => sameConcept(existing, concept))) { drop("Doppelt: sehr ähnliches Content-Konzept in derselben Antwort"); continue; }
    if (item.kind === "topic_opportunity") { topics.push(item); concepts.push(concept); continue; }
    const idea = item.productIdea?.trim();
    if (!idea || idea.length < 3 || !/^[\p{L}\p{N}][\p{L}\p{N}\s.,+&\-/]*$/u.test(idea)) { drop("Produktidee fehlt oder ist nicht als Suchbegriff geeignet"); continue; }
    // The agent's own superlatives are cross-checked against its levels: claims it cannot back with potential do not count.
    const s = item.signals;
    const chance: ContentChance = {
      type: item.chanceType, hook: item.hook.trim(), concept, group: functionalGroup(idea) ?? (item.group ? slug(item.group).slice(0, 40) || undefined : undefined),
      demonstrable: s.demonstrable && item.visualPotential !== "low", beforeAfter: s.beforeAfter && s.demonstrable && item.visualPotential !== "low",
      wow: s.wow, fun: s.fun && item.entertainmentPotential !== "low", impulse: s.impulse, gift: s.gift,
      aesthetic: s.aesthetic && item.visualPotential !== "low", broadAppeal: s.broadAppeal, seasonalFit: item.timing.relevance === "high",
    };
    const cited = [...new Set(item.evidenceUrls)].map(url => known.get(url)).filter((entry): entry is EvidenceItem => !!entry).slice(0, 4);
    const extraPenalties: ChanceAssessment["penalties"] = cited.length ? [] : [{ reason: "Keine Recherchequelle belegt die Chance", points: -10 }];
    const agent: AgentProvenance = { source: "trend_agent", kind: item.kind, title: item.title, rationale: item.rationale, targetNeed: item.targetNeed,
      shareReason: item.shareReason, trustRationale: item.trustRationale, reachRationale: item.reachRationale, novelty: item.novelty,
      formatSuggestion: item.formatSuggestion, confidence: Math.round(item.confidence), priority: item.priority,
      evidence: cited.map(entry => ({ title: entry.title.slice(0, 200), url: entry.url })) };
    concepts.push(concept);
    candidates.push({ name: idea, searchQuery: idea, kind: item.timing.relevance === "high" ? "Saisontrend" : "Dauerläufer", category: "Content-Chance",
      season: item.timing.season ?? "Ganzjährig", whyNow: item.timing.relevance === "high" && item.timing.season ? `${item.timing.season}: ${item.rationale}`.slice(0, 600) : item.rationale,
      reelIdea: item.hook, targetGroup: item.targetNeed, benefitsToVerify: ["Produktmerkmale und Lieferumfang laut Amazon-Seite", "Herstellerangaben zu Material und Maßen"],
      confidence: Math.round(item.confidence), chance, priority: item.priority, agent, extraPenalties });
  }
  return { ok: true as const, candidates, topics, dropped, noGoodCandidate: report.noGoodCandidate || !candidates.length, rejectedIdeas: report.rejectedIdeas, summary: report.summary };
}

export { evidenceItemSchema, trendOpportunitySchema, trendReportSchema };
export type { EvidenceItem, TrendBrief, TrendOpportunity, TrendReport };

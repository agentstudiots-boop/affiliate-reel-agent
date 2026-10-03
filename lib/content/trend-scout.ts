import type { Generator } from "./agent";
import { trendAgent } from "./agents/trend";
import { intakeTrendReport, type CandidateFromTrend, type DroppedOpportunity, type EvidenceItem, type TrendBrief, type TrendOpportunity } from "./trend";
import type { SelectionHistory } from "./strategy";

// Jarvis-side orchestration of the trend/strategy specialist: research (tools live here, not in the agent),
// one bounded model call, validation. Any failure degrades to the static seed ideas; it never throws.

export type ResearchQuery = { direction: string; query: string; timeRange?: "month" | "year" };
export type ResearchFn = (query: ResearchQuery) => Promise<{ title: string; url: string; content: string }[]>;

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export function seasonContext(now: Date) {
  const month = now.getUTCMonth() + 1;
  const season = month <= 2 || month === 12 ? "Winter" : month <= 5 ? "Frühling" : month <= 8 ? "Sommer" : "Herbst";
  const occasion = month === 9 || month === 10 ? "Halloween und Herbst" : month === 11 ? "Advent, Black Friday und Weihnachtsgeschenke" : month === 12 ? "Weihnachten und Jahreswechsel"
    : month === 1 || month === 2 ? "Winter und Valentinstag" : month === 3 || month === 4 ? "Frühling und Ostern" : month === 5 || month === 6 ? "Frühsommer, Muttertag und Urlaub" : "Sommer, Grillzeit und Urlaub";
  return { season, occasion, monthName: MONTHS[month - 1] };
}

export function researchQueries(now: Date): ResearchQuery[] {
  const { occasion, monthName } = seasonContext(now);
  return [
    { direction: "problemloeser", query: "clevere Alltagshelfer Haushalt Küche Ordnung Reinigung Problemlöser Vorher Nachher Gadget Deutschland", timeRange: "month" },
    { direction: "fun_social", query: "ungewöhnliche lustige Gadgets Partyspiele Geschenkideen die Leute teilen Trend Deutschland", timeRange: "month" },
    { direction: "deko_lifestyle", query: `Deko Lifestyle Wohnaccessoires Kerzen Beleuchtung Trends ${monthName}`, timeRange: "month" },
    { direction: "saison", query: `${occasion} Produkte Ideen Trend Deutschland ${monthName}`, timeRange: "month" },
  ];
}

// Explicit contract result for Jarvis: success | no_candidate | unavailable | research_unavailable | timeout | rate_limited | invalid_response | failed
export type DiscoveryOutcome = "success" | "no_candidate" | "unavailable" | "research_unavailable" | "timeout" | "rate_limited" | "invalid_response" | "failed";
const OUTCOME_OF: Record<string, DiscoveryOutcome> = { agent_unavailable: "unavailable", research_unavailable: "research_unavailable", timeout: "timeout",
  rate_limited: "rate_limited", invalid_response: "invalid_response", agent_error: "failed" };

export type DiscoveryResult = {
  source: "trend_agent" | "seed_fallback";
  outcome: DiscoveryOutcome;
  candidates: CandidateFromTrend[];
  topics: TrendOpportunity[];
  noGoodCandidate: boolean;
  summary: string;
  failure?: string;
  evidenceCount: number;
  queries: { ok: number; failed: number };
  dropped: DroppedOpportunity[];
  rejectedIdeas: { idea: string; reason: string }[];
  durationMs: number;
};

const failureKind = (error: unknown) => {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/trend_agent_requires_model|Replicate-Zugang/.test(message)) return "agent_unavailable";
  if (/ZodError|SyntaxError|schema|JSON/i.test(message)) return "invalid_response";
  if (/HTTP 429|Zugriffslimit/.test(message)) return "rate_limited";
  if (/timeout|abort|unterbrochen/i.test(message)) return "timeout";
  return "agent_error";
};

export async function discoverOpportunities(input: {
  now: Date; slot: string; history: SelectionHistory;
  seedIdeas: { name: string; hook: string | null }[];
  research: ResearchFn;
  generate: Generator | null;   // null: no model available → seed fallback
  maxOpportunities?: number;
  deadlineMs?: number;          // hard ceiling for the whole discovery so it can never exhaust the cron invocation
}): Promise<DiscoveryResult> {
  const started = Date.now();
  const base = { outcome: "failed" as DiscoveryOutcome, candidates: [], topics: [], noGoodCandidate: false, summary: "", evidenceCount: 0, queries: { ok: 0, failed: 0 }, dropped: [], rejectedIdeas: [] };
  const fallback = (failure: string, extra: Partial<DiscoveryResult> = {}): DiscoveryResult =>
    ({ ...base, source: "seed_fallback", failure, outcome: OUTCOME_OF[failure] ?? "failed", durationMs: Date.now() - started, ...extra });
  if (!input.generate) return fallback("agent_unavailable");

  // 1. Research. Individual failures are tolerated; no evidence at all means no dynamic discovery.
  const deadline = <T,>(work: Promise<T>) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout: discovery deadline")), input.deadlineMs ?? 100_000);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const settled = await Promise.allSettled(researchQueries(input.now).map(async query => ({ query, results: await deadline(input.research(query)) })));
  const evidence: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    for (const result of item.value.results) {
      if (!result.url || seen.has(result.url) || evidence.length >= 24) continue;
      let url: string;
      try { url = new URL(result.url).toString(); } catch { continue; }
      if (!/^https:/.test(url)) continue;
      seen.add(result.url);
      evidence.push({ title: String(result.title || "").slice(0, 200), url: result.url, snippet: String(result.content || "").replace(/\s+/g, " ").slice(0, 280), direction: item.value.query.direction });
    }
  }
  const queries = { ok: settled.filter(item => item.status === "fulfilled").length, failed: settled.filter(item => item.status === "rejected").length };
  if (!evidence.length) return fallback("research_unavailable", { queries });

  // 2. One bounded specialist call.
  const { season } = seasonContext(input.now);
  const brief: TrendBrief = {
    today: input.now.toISOString().slice(0, 10), season, slot: input.slot, evidence,
    history: { rejected: input.history.rejected.slice(0, 12).map(item => ({ name: item.name ?? null, concept: item.concept })),
      recent: input.history.recent.slice(0, 20).map(item => ({ name: item.name ?? null, concept: item.concept })) },
    seedIdeas: input.seedIdeas.slice(0, 24), maxOpportunities: input.maxOpportunities ?? 4,
  };
  let raw: unknown;
  try { raw = await deadline(trendAgent(brief, input.generate)); }
  catch (error) { return fallback(failureKind(error), { queries, evidenceCount: evidence.length }); }

  // 3. Jarvis-side intake: structure, claims, duplicates. Unusable output degrades to the seeds.
  const intake = intakeTrendReport(raw, evidence);
  if (!intake.ok) return fallback("invalid_response", { queries, evidenceCount: evidence.length });
  return { source: "trend_agent", outcome: intake.noGoodCandidate ? "no_candidate" : "success", candidates: intake.candidates, topics: intake.topics, noGoodCandidate: intake.noGoodCandidate, summary: intake.summary ?? "",
    evidenceCount: evidence.length, queries, dropped: intake.dropped, rejectedIdeas: intake.rejectedIdeas, durationMs: Date.now() - started };
}

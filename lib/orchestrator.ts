import { findAmazonProduct, resolveAmazonProduct } from "@/lib/product-resolver";
import { reviewProduct } from "@/lib/agents/product-reviewer";
import { scoutProducts, seedIdeas } from "@/lib/agents/product-scout";
import { writeReelConcept } from "@/lib/agents/script-writer";
import type { Product } from "@/lib/types";
import { getDatabase } from "@/lib/memory/db";
import { blockedProductFamilies, productFamily, productOnCooldown } from "@/lib/daily/product-lock";
import { createHash } from "node:crypto";
import { tavilySearch } from "@/lib/tavily";
import { assessContentChance } from "@/lib/content/strategy";
import { loadSelectionHistory } from "@/lib/content/selection-history";
import { discoverOpportunities, type DiscoveryResult, type ResearchFn } from "@/lib/content/trend-scout";
import { createGenerator } from "@/lib/content/model";
import type { Generator } from "@/lib/content/agent";

const MAX_PRODUCT_LOOKUPS = 5; // Existing five lookups per general scout run.

function rotate<T>(items: T[], key: string) {
  if (!items.length) return items;
  const start = createHash("sha256").update(key).digest().readUInt32BE(0) % items.length;
  return [...items.slice(start), ...items.slice(0,start)];
}

function webSources(sources: Awaited<ReturnType<typeof scoutProducts>>["sources"]) {
  return sources
    .filter((source) => source.sourceType === "url")
    .map((source) => ({ title: source.title, url: source.url }));
}

// `quality` applies the content-chance gate (scheduled slots only). Operator-requested searches are never filtered.
export type TrendDeps = { research?: ResearchFn; generate?: Generator | null };
const defaultResearch: ResearchFn = ({ query, timeRange }) => tavilySearch({ query, timeRange, maxResults: 6 });
// The trend agent needs the editorial model; without a token the static seed ideas are used.
// The model timeout starts with the model call, not with the research that precedes it.
const defaultGenerate = (): Generator | null => process.env.REPLICATE_API_TOKEN?.trim()
  ? ((agent, instruction, input, schema, reference) => createGenerator({ mode: "ai", signal: AbortSignal.timeout(75_000) })(agent, instruction, input, schema, reference)) as Generator : null;

export async function runProductScout(productSearch?: string, selectionKey?: string, options: { quality?: boolean; trend?: TrendDeps } = {}) {
  const db = getDatabase();
  const automatic = !!options.quality && !productSearch;
  const history = automatic ? await loadSelectionHistory(db) : null;
  // Jarvis assigns the discovery job to the trend/strategy agent first; on any failure it falls back to the seed ideas.
  let discovery: DiscoveryResult | null = null;
  if (automatic && history) {
    const now = new Date();
    discovery = await discoverOpportunities({ now, slot: selectionKey || "", history,
      seedIdeas: seedIdeas(now).filter(seed => seed.chance).map(seed => ({ name: seed.name, hook: seed.chance?.hook ?? null })),
      research: options.trend?.research ?? defaultResearch,
      generate: options.trend && "generate" in options.trend ? options.trend.generate ?? null : defaultGenerate() });
    console.info(JSON.stringify({ event: "trend_discovery", slot: selectionKey, source: discovery.source, outcome: discovery.outcome, failure: discovery.failure, evidence: discovery.evidenceCount,
      queries: discovery.queries, proposed: discovery.candidates.length, topics: discovery.topics.length, noGoodCandidate: discovery.noGoodCandidate,
      dropped: discovery.dropped.slice(0, 6), ms: discovery.durationMs }));
  }
  const agentRun = discovery?.source === "trend_agent" ? discovery : null;
  const result = agentRun
    ? { output: { summary: agentRun.summary || "Trend-Agent", researchedAt: new Date().toISOString(), candidates: [] as Awaited<ReturnType<typeof scoutProducts>>["output"]["candidates"] }, sources: [] as Awaited<ReturnType<typeof scoutProducts>>["sources"] }
    : await scoutProducts(productSearch);
  const blockedFamilies = await blockedProductFamilies(db);
  const key = selectionKey || new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  let pool = productSearch ? result.output.candidates : [
    ...rotate(result.output.candidates.filter(candidate=>candidate.kind==="Saisontrend"),key+":seasonal"),
    ...rotate(result.output.candidates.filter(candidate=>candidate.kind==="Dauerläufer"),key+":evergreen"),
    ...result.output.candidates.filter(candidate=>candidate.kind==="Aktueller Trend"),
  ];
  // Content chance first: weak, interchangeable or recently rejected ideas never reach the (paid) Amazon lookups.
  const qualityRejected: { name: string; score: number; reason: string }[] = [];
  if (automatic && history && agentRun) {
    // Agent proposals: Jarvis re-checks them against history (rejections, repeats, concepts) before any Amazon lookup.
    const assessed = agentRun.candidates.map(candidate => ({ candidate, assessment: assessContentChance(candidate.name, candidate.chance, history, candidate.extraPenalties) }));
    for (const item of assessed.filter(entry => !entry.assessment.passed))
      qualityRejected.push({ name: item.candidate.name, score: item.assessment.score, reason: item.assessment.reasons.at(-1) || "" });
    for (const item of agentRun.dropped) qualityRejected.push({ name: item.title, score: 0, reason: item.reason });
    for (const item of agentRun.rejectedIdeas) qualityRejected.push({ name: item.idea, score: 0, reason: item.reason });
    pool = assessed.filter(item => item.assessment.passed).sort((a, b) => a.candidate.priority - b.candidate.priority)
      .map(item => ({ ...item.candidate, searchQuery: item.candidate.searchQuery, assessment: item.assessment })) as unknown as typeof pool;
    if (!pool.length && !qualityRejected.length) qualityRejected.push({ name: "Trend-Agent", score: 0, reason: "Keine Content-Chance stark genug" });
  } else if (automatic && history) {
    const assessed = pool.map((candidate, index) => ({ candidate, index, assessment: assessContentChance(candidate.name, candidate.chance, history) }));
    for (const item of assessed.filter(entry => !entry.assessment.passed))
      qualityRejected.push({ name: item.candidate.name, score: item.assessment.score, reason: item.assessment.reasons.at(-1) || "" });
    pool = assessed.filter(item => item.assessment.passed)
      .sort((a, b) => b.assessment.score - a.assessment.score || a.index - b.index)
      .map(item => ({ ...item.candidate, assessment: item.assessment })) as typeof pool;
    console.info(JSON.stringify({ event: "scout_quality_gate", passed: pool.length, rejected: qualityRejected.length,
      top: pool.slice(0, 3).map(item => item.name), rejectedSample: qualityRejected.slice(0, 6) }));
  }
  const selected: typeof pool = [];
  const seenFamilies = new Set<string>();
  const prefiltered = [] as typeof pool;
  for (const candidate of pool) {
    const family = productFamily(candidate.name);
    if (family && blockedFamilies.has(family)) { prefiltered.push(candidate); continue; }
    if (family && seenFamilies.has(family)) continue;
    selected.push(candidate);
    if (family) seenFamilies.add(family);
    if (selected.length === MAX_PRODUCT_LOOKUPS) break;
  }
  const resolved = await Promise.all(selected.map(async candidate => {
    try {
      const resolvedProduct = await findAmazonProduct(candidate.name, candidate.searchQuery, candidate.targetGroup);
      return { ...candidate, name: resolvedProduct.name, resolvedProduct,
        amazonUrl: resolvedProduct.sourceUrl, affiliateUrl: resolvedProduct.affiliateUrl };
    } catch (error) { return { ...candidate, resolvedProduct: undefined, amazonUrl: "", affiliateUrl: "",
      resolutionError: error instanceof Error && error.message === "amazon_verification_blocked" ? "amazon_verification_blocked" : "product_unresolved" }; }
  }));
  const checked = await Promise.all(resolved.map(async candidate => ({candidate,
    blocked: candidate.resolvedProduct ? await productOnCooldown(db,candidate.resolvedProduct) : false,
  })));
  const blocked = [...prefiltered, ...checked.filter(item=>item.blocked).map(item=>item.candidate)];
  return {
    ...result.output,
    candidates: checked.filter(item => !item.blocked).map(item => item.candidate),
    cooldownBlocked: blocked.length,
    qualityBlocked: qualityRejected.length,
    trend: discovery ? { source: discovery.source, outcome: discovery.outcome, failure: discovery.failure ?? null, evidence: discovery.evidenceCount, queries: discovery.queries,
      proposed: discovery.candidates.length, topicOpportunities: discovery.topics.map(topic => ({ title: topic.title, hook: topic.hook, concept: topic.concept })).slice(0, 4) } : null,
    qualityRejected: qualityRejected.slice(0, 12),
    cooldownBlockedSeasonal: blocked.filter(candidate=>candidate.kind === "Saisontrend").length,
    cooldownBlockedAutomatic: blocked.filter(candidate=>candidate.kind !== "Aktueller Trend").length,
    sources: webSources(result.sources),
  };
}

export async function runProductReview(candidate: Parameters<typeof reviewProduct>[0]) {
  const result = await reviewProduct(candidate);
  return { ...result.output, sources: webSources(result.sources) };
}

export async function runScriptWriter(product: Product) {
  const reviewedProduct = await resolveAmazonProduct(product);
  const concept = writeReelConcept(reviewedProduct);
  return { concept, affiliateUrl: reviewedProduct.affiliateUrl };
}

// Central public entry point; specialists remain isolated behind the content coordinator.
export { runContentJob } from "@/lib/content/orchestrator";

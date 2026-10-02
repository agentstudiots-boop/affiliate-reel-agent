import { findAmazonProduct, resolveAmazonProduct } from "@/lib/product-resolver";
import { reviewProduct } from "@/lib/agents/product-reviewer";
import { scoutProducts } from "@/lib/agents/product-scout";
import { writeReelConcept } from "@/lib/agents/script-writer";
import type { Product } from "@/lib/types";
import { getDatabase } from "@/lib/memory/db";
import { blockedProductFamilies, productFamily, productOnCooldown } from "@/lib/daily/product-lock";
import { createHash } from "node:crypto";
import { assessContentChance } from "@/lib/content/strategy";
import { loadSelectionHistory } from "@/lib/content/selection-history";

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
export async function runProductScout(productSearch?: string, selectionKey?: string, options: { quality?: boolean } = {}) {
  const result = await scoutProducts(productSearch);
  const db = getDatabase();
  const blockedFamilies = await blockedProductFamilies(db);
  const key = selectionKey || new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  let pool = productSearch ? result.output.candidates : [
    ...rotate(result.output.candidates.filter(candidate=>candidate.kind==="Saisontrend"),key+":seasonal"),
    ...rotate(result.output.candidates.filter(candidate=>candidate.kind==="Dauerläufer"),key+":evergreen"),
    ...result.output.candidates.filter(candidate=>candidate.kind==="Aktueller Trend"),
  ];
  // Content chance first: weak, interchangeable or recently rejected ideas never reach the (paid) Amazon lookups.
  const qualityRejected: { name: string; score: number; reason: string }[] = [];
  if (options.quality && !productSearch) {
    const history = await loadSelectionHistory(db);
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

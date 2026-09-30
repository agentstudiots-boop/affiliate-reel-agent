import { findAmazonProduct, resolveAmazonProduct } from "@/lib/product-resolver";
import { reviewProduct } from "@/lib/agents/product-reviewer";
import { scoutProducts } from "@/lib/agents/product-scout";
import { writeReelConcept } from "@/lib/agents/script-writer";
import type { Product } from "@/lib/types";
import { getDatabase } from "@/lib/memory/db";
import { blockedProductFamilies, productFamily, productOnCooldown } from "@/lib/daily/product-lock";
import { createHash } from "node:crypto";

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

export async function runProductScout(productSearch?: string, selectionKey?: string) {
  const result = await scoutProducts(productSearch);
  const db = getDatabase();
  const blockedFamilies = await blockedProductFamilies(db);
  const key = selectionKey || new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const pool = productSearch ? result.output.candidates : [
    ...rotate(result.output.candidates.filter(candidate=>candidate.kind==="Saisontrend"),key+":seasonal"),
    ...rotate(result.output.candidates.filter(candidate=>candidate.kind==="Dauerläufer"),key+":evergreen"),
    ...result.output.candidates.filter(candidate=>candidate.kind==="Aktueller Trend"),
  ];
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

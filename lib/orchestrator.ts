import { findAmazonProduct, resolveAmazonProduct } from "@/lib/product-resolver";
import { reviewProduct } from "@/lib/agents/product-reviewer";
import { scoutProducts } from "@/lib/agents/product-scout";
import { writeReelConcept } from "@/lib/agents/script-writer";
import type { Product } from "@/lib/types";
import { getDatabase } from "@/lib/memory/db";
import { productOnCooldown } from "@/lib/daily/product-lock";

function webSources(sources: Awaited<ReturnType<typeof scoutProducts>>["sources"]) {
  return sources
    .filter((source) => source.sourceType === "url")
    .map((source) => ({ title: source.title, url: source.url }));
}

export async function runProductScout(productSearch?: string) {
  const result = await scoutProducts(productSearch);
  const resolved = await Promise.all(result.output.candidates.map(async candidate => {
    try {
      const resolvedProduct = await findAmazonProduct(candidate.name, candidate.searchQuery, candidate.targetGroup);
      return { ...candidate, name: resolvedProduct.name, resolvedProduct,
        amazonUrl: resolvedProduct.sourceUrl, affiliateUrl: resolvedProduct.affiliateUrl };
    } catch (error) { return { ...candidate, resolvedProduct: undefined, amazonUrl: "", affiliateUrl: "",
      resolutionError: error instanceof Error && error.message === "amazon_verification_blocked" ? "amazon_verification_blocked" : "product_unresolved" }; }
  }));
  const db = getDatabase();
  const checked = await Promise.all(resolved.map(async candidate => ({candidate,
    blocked: candidate.resolvedProduct ? await productOnCooldown(db,candidate.resolvedProduct) : false,
  })));
  return {
    ...result.output,
    candidates: checked.filter(item => !item.blocked).map(item => item.candidate),
    cooldownBlocked: checked.filter(item => item.blocked).length,
    cooldownBlockedSeasonal: checked.filter(item => item.blocked && item.candidate.kind === "Saisontrend").length,
    cooldownBlockedAutomatic: checked.filter(item => item.blocked && item.candidate.kind !== "Aktueller Trend").length,
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

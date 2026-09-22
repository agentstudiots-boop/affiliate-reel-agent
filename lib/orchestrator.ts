import { amazonSearchUrls, createAmazonAffiliateUrl } from "@/lib/amazon";
import { reviewProduct } from "@/lib/agents/product-reviewer";
import { scoutProducts } from "@/lib/agents/product-scout";
import { writeReelConcept } from "@/lib/agents/script-writer";
import type { Product } from "@/lib/types";

function webSources(sources: Awaited<ReturnType<typeof scoutProducts>>["sources"]) {
  return sources
    .filter((source) => source.sourceType === "url")
    .map((source) => ({ title: source.title, url: source.url }));
}

export async function runProductScout() {
  const result = await scoutProducts();
  return {
    ...result.output,
    candidates: result.output.candidates.map((candidate) => ({
      ...candidate,
      ...amazonSearchUrls(candidate.searchQuery),
    })),
    sources: webSources(result.sources),
  };
}

export async function runProductReview(candidate: Parameters<typeof reviewProduct>[0]) {
  const result = await reviewProduct(candidate);
  return { ...result.output, sources: webSources(result.sources) };
}

export async function runScriptWriter(product: Product) {
  const reviewedProduct = {
    ...product,
    affiliateUrl: createAmazonAffiliateUrl(product.affiliateUrl || product.sourceUrl),
  };
  const concept = writeReelConcept(reviewedProduct);
  return { concept, affiliateUrl: reviewedProduct.affiliateUrl };
}

// Central public entry point; specialists remain isolated behind the content coordinator.
export { runContentJob } from "@/lib/content/orchestrator";

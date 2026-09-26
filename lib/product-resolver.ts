import { amazonProduct, bindAmazonProduct, PRODUCT_UNRESOLVED } from "./amazon";
import { tavilySearch } from "./tavily";
import type { Product } from "./types";

// Exact Amazon result URL + its indexed title establish identity only, never features/prices.
// Evidence is generated on the server; client timestamps and names are not trusted.
export async function resolveAmazonProduct(product: Product, search = tavilySearch): Promise<Product> {
  const source = amazonProduct(product.sourceUrl);
  if (!source) throw new Error(PRODUCT_UNRESOLVED);
  bindAmazonProduct(product); // Reject a supplied link to a different ASIN before any search.
  let results: Awaited<ReturnType<typeof tavilySearch>>;
  try { results = await search({ query: `site:amazon.de "${source.asin}"`, maxResults: 5 }); }
  catch { throw new Error(PRODUCT_UNRESOLVED); }
  const result = results.find(item => amazonProduct(item.url)?.asin === source.asin
    && item.title.trim().length > 5 && !/captcha|robot|^Amazon\.de\s*[:|-]?\s*$/i.test(item.title.trim()));
  if (!result) throw new Error(PRODUCT_UNRESOLVED);
  const name = result.title.replace(/\s*[:|–-]\s*Amazon\.de(?:\s*:.*)?$/i, "").trim().slice(0,160);
  if (name.length < 5) throw new Error(PRODUCT_UNRESOLVED);
  // Reject a different product family supplied in the briefing; never silently redirect A to B.
  const words = product.name.toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]{4,}/gu) || [];
  if (!words.length || !words.every(word => name.toLocaleLowerCase("de-DE").includes(word))) throw new Error(PRODUCT_UNRESOLVED);
  return bindAmazonProduct({ ...product, name, productVerifiedName: name,
    productVerifiedAt: new Date().toISOString(), asin: source.asin, productUrl: source.productUrl });
}

export async function findAmazonProduct(categoryName: string, query: string, targetGroup: string, search = tavilySearch) {
  const results = await search({ query: `site:amazon.de ${query}`, maxResults: 5 });
  // A scout seed is a category idea, not yet an identified product. Bind its actual result title.
  const categoryWords = categoryName.toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]{4,}/gu) || [];
  const found = results.find(item => amazonProduct(item.url) && categoryWords.some(word => item.title.toLocaleLowerCase("de-DE").includes(word)));
  if (!found) throw new Error(PRODUCT_UNRESOLVED);
  const name = found.title.replace(/\s*[:|–-]\s*Amazon\.de(?:\s*:.*)?$/i, "").trim().slice(0,160);
  return resolveAmazonProduct({ name, sourceUrl: found.url, affiliateUrl: "", price: "", targetGroup,
    benefits: "Eignung und Eigenschaften am konkreten Modell prüfen.", notes: "Produktidentität anhand des indexierten Amazon-Produkttitels zugeordnet; keine Eigenschaften oder Preise verifiziert." }, async () => results);
}

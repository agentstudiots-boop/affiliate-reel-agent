import { cleanAmazonTitle } from "../product-resolver";

// Product description for the landing page. Built ONLY from stored, verified product data:
// the Amazon page title that was matched to the ASIN and confirmed facts with a source.
// Never from the Facebook caption, the creative idea or any social copy; nothing is added or reworded.
export type ProductDescription = { type: string; features: string[]; facts: { claim: string; source: string }[] };

// Promotional adjectives in marketplace titles are not evidence; they are not repeated as features.
const PROMO = /\b(?:perfekt\w*|ideal\w*|best\w*|beste[rsmn]?|top|premium|hochwertig\w*|beliebt\w*|neu\b|bestseller|testsieger|geschenk\w*|must.?have|einzigartig\w*|revolution\w*)\b/i;

export function describeProduct(input: { name: unknown; verifiedName?: unknown; verifiedFacts?: unknown }): ProductDescription {
  const title = cleanAmazonTitle(String(input.verifiedName || input.name || ""));
  const parts = title.split(/\s*[,|–—]\s*|\s+-\s+/).map(part => part.replace(/\s*…$/, "").trim()).filter(Boolean);
  const type = (parts[0] || title).slice(0, 100).trim();
  // The stored title is capped; a possibly cut-off last segment is never shown as a feature.
  const usable = title.length >= 150 ? parts.slice(1, -1) : parts.slice(1);
  const features = usable.filter(part => part.length >= 3 && part.length <= 70 && !PROMO.test(part)).slice(0, 4);
  const facts = Array.isArray(input.verifiedFacts) ? input.verifiedFacts.flatMap(fact => {
    const claim = (fact as { claim?: unknown })?.claim, source = (fact as { source?: unknown })?.source;
    try { return typeof claim === "string" && typeof source === "string" && new URL(source).protocol === "https:" ? [{ claim: claim.slice(0, 200), source }] : []; }
    catch { return []; }
  }).slice(0, 4) : [];
  return { type, features, facts };
}

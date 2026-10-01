import type { Opportunity } from "./schema";

// Hard rule: a content piece may only claim functions, properties and uses that the concrete
// product data of THIS article supports. Verified data today is the Amazon title (plus
// operator-supplied verifiedFacts); everything else is an unsupported claim, not a fact.
type Rule = { id: string; label: string; claim: RegExp; support: RegExp };
const RULES: Rule[] = [
  { id: "dough_work", label: "Teig ausrollen/kneten", claim: /ausroll|ausgerollt|knet(?:en|et|ung)|nudelholz|fondant|teig\s*(?:matte|unterlage)/i,
    support: /ausroll|nudelholz|fondant|teig(?:matte|unterlage|platte)|knetmatte|arbeits(?:matte|unterlage|fläche)/i },
  { id: "dishwasher", label: "spülmaschinengeeignet", claim: /spülmaschine|geschirrspüler/i, support: /spülmaschine|geschirrspüler/i },
  { id: "microwave", label: "mikrowellengeeignet", claim: /mikrowelle/i, support: /mikrowelle/i },
  { id: "freezer", label: "gefriergeeignet", claim: /gefrier|tiefkühl|einfrieren/i, support: /gefrier|tiefkühl|einfrier|vakuumier|vacuum/i },
  { id: "grill", label: "für den Grill", claim: /\bgrill/i, support: /\bgrill/i },
  { id: "airfryer", label: "für Heißluftfritteuse", claim: /heißluft|air\s?fryer/i, support: /heißluft|air\s?fryer/i },
  { id: "food_safe", label: "lebensmittelecht/BPA-frei", claim: /lebensmittelecht|bpa[- ]?frei|food[- ]?grade|\blfgb\b|\bfda\b/i, support: /lebensmittelecht|bpa|food[- ]?grade|lfgb|fda/i },
  { id: "nonstick", label: "Antihaft", claim: /antihaft|non[- ]?stick|nicht\s+anhaft|nichts\s+(?:bleibt\s+)?kleben/i, support: /antihaft|non[- ]?stick/i },
  { id: "heat", label: "Hitzebeständigkeit", claim: /hitzebest\w*|backofenfest|ofenfest|bis\s+(?:zu\s+)?\d+\s?°/i, support: /hitzebest|backofen|\bofen|°\s?c|\bgrad\b/i },
  { id: "reusable", label: "wiederverwendbar", claim: /wiederverwendbar|mehrfach\s+verwend/i, support: /wiederverwend|mehrweg|mehrfach/i },
  { id: "easy_clean", label: "leicht zu reinigen", claim: /leicht(?:er)?\s+(?:zu\s+)?reinig|einfach(?:er)?\s+(?:zu\s+)?reinig|abwisch/i, support: /reinig|abwisch|spülmaschine/i },
  { id: "crisp", label: "knuspriges Backen", claim: /knusprig/i, support: /knusprig/i },
];
const UNIT_NUMBER = /\b\d+(?:[.,]\d+)?\s?(?:cm|mm|ml|liter|watt|°\s?c|grad|stück|led|kg)\b/gi;
const norm = (value: string) => value.toLocaleLowerCase("de-DE").replace(/\s+/g, "");

export function contentText(content: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, key = "") => {
    if (typeof value === "string") { if (!/url|link|image|asset|sha|hash/i.test(key)) parts.push(value); }
    else if (Array.isArray(value)) value.forEach(item => walk(item, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(content);
  return parts.join("\n");
}

export function productEvidence(product: Opportunity["product"], facts: Opportunity["verifiedFacts"] = []) {
  return [product.name, product.productVerifiedName, ...facts.map(fact => fact.claim)].filter(Boolean).join("\n");
}

export type UnsupportedClaim = { id: string; label: string };
export function unsupportedClaims(text: string, evidence: string): UnsupportedClaim[] {
  const found: UnsupportedClaim[] = [];
  for (const rule of RULES) if (rule.claim.test(text) && !rule.support.test(evidence)) found.push({ id: rule.id, label: rule.label });
  const evidenceNorm = norm(evidence);
  for (const match of text.match(UNIT_NUMBER) || []) {
    if (!evidenceNorm.includes(norm(match).replace(",", "."))&&!evidenceNorm.includes(norm(match))) found.push({ id: `number:${norm(match)}`, label: `Angabe „${match.trim()}“` });
  }
  return [...new Map(found.map(claim => [claim.id, claim])).values()];
}

export const PRODUCT_DATA_UNCERTAIN = "product_data_uncertain";
export function unsupportedProductClaims(opportunity: Opportunity, content: unknown) {
  return unsupportedClaims(contentText(content), productEvidence(opportunity.product, opportunity.verifiedFacts));
}
export function unsupportedClaimMessage(claims: UnsupportedClaim[]) {
  return `Nicht durch die Produktdaten belegt: ${claims.map(claim => claim.label).join(", ")}.`;
}

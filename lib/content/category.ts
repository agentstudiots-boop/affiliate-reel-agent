import type { Opportunity } from "./schema";

export function isPumpkinCarvingProduct(name: string) {
  return /(?:kürbis|kuerbis|pumpkin).{0,40}(?:schnitz|carving)|(?:schnitz|carving).{0,40}(?:kürbis|kuerbis|pumpkin)/i.test(name);
}

export function classifyOpportunity(opportunity: Opportunity): Opportunity {
  return isPumpkinCarvingProduct(opportunity.product.name)
    ? { ...opportunity, category: "home_living" }
    : opportunity;
}

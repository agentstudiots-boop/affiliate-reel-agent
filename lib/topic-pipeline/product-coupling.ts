import { hits } from "../topics/lexicon";
import type { TopicCandidate } from "../topics/schema";

// Optional product coupling for topic posts. NOT hard-wired:
//  - default: topic post without product and without affiliate link
//  - only on the operator's explicit WhatsApp request ("Such mir dazu ein passendes Produkt") does the orchestrator
//    ask the existing product trend scout (through the ProductSuggester interface) for 1–3 candidates with a reason
//  - candidates go to the operator for selection; no link without the operator's explicit choice
//  - sensitive topics (disasters, accidents, scandals, celebrity gossip, high risk) never get product suggestions
// Neither the scout nor the orchestrator ever selects a product or a link on its own.

export const MAX_PRODUCT_SUGGESTIONS = 3;
export type ProductSuggestion = { name: string; reason: string; category: string | null; searchQuery: string };
// The existing product trend scout behind an interface; wired in the app layer, mocked in tests.
export type ProductSuggester = (topic: Pick<TopicCandidate, "title" | "audience_problem" | "possible_product_category" | "trend_type" | "angle">, wish: string | null) => Promise<ProductSuggestion[]>;

export type ProductState =
  | { status: "none" }
  | { status: "suggested"; suggestions: ProductSuggestion[]; requestedBy: string; suggestedAt: string }
  | { status: "selected"; suggestion: ProductSuggestion; selectedBy: string; product: { name: string; asin: string; affiliateUrl: string; sourceUrl: string } }
  | { status: "declined"; by: string };

const DISASTER = /katastroph|unglück|ungluck|unfall|absturz|explosion|brand\b|feuer|flut|hochwasser|überschwemm|erdbeben|sturmflut|tsunami|lawine|einsturz|tote\b|todesopfer|verletzte|anschlag|amok|krieg|terror|skandal|affäre|affaere|missbrauch|ermittlung/i;

// Deterministic, conservative: any sign of sensitivity disables product coupling entirely.
export function productCouplingBlocked(candidate: TopicCandidate): string | null {
  const text = [candidate.title, candidate.audience_problem, ...candidate.source_signals.map(signal => signal.title)].join(" ");
  if (candidate.gossip) return "Promi-/Klatschthema";
  if (DISASTER.test(text) || hits(text, "highRisk").length) return "sensibles Thema (Katastrophe, Unfall, Skandal oder Gewalt)";
  if (candidate.sensitive || candidate.risk_score >= 40) return "sensibles Thema (erhöhtes Risiko)";
  if (candidate.product_optional === false) return "Thema ohne Produktbezug";
  return null;
}

// Deterministic shortcut: the literal command "Produktvorschläge". Free requests ("such mir dazu ein passendes Produkt")
// are understood by the semantic router (intent request_products), not by a pattern.
export const productListCommand = (body: string) => /^produktvorschl(ä|ae)ge[.!?]*$/i.test(body.trim());

// Selection reply to the suggestion message: "Produkt 2". Anything else is not a selection.
export function productSelection(body: string): number | "none" | null {
  const text = body.trim().toLocaleLowerCase("de-DE").replace(/[.!?]+$/, "");
  if (/^(kein(e|en)? produkt|ohne produkt|keins)$/.test(text)) return "none";
  const match = text.match(/^(?:nimm\s+)?produkt\s*([1-3])$/);
  return match ? Number(match[1]) : null;
}

export async function suggestProducts(candidate: TopicCandidate, suggester: ProductSuggester, wish: string | null): Promise<{ ok: true; suggestions: ProductSuggestion[] } | { ok: false; reason: string }> {
  const blocked = productCouplingBlocked(candidate);
  if (blocked) return { ok: false, reason: blocked };
  let suggestions: ProductSuggestion[];
  try { suggestions = await suggester(candidate, wish); }
  catch { return { ok: false, reason: "Produkt-Trendscout nicht erreichbar" }; }
  const clean = suggestions.filter(item => item.name.trim().length >= 3 && !/https?:\/\/|www\.|\bB0[A-Z0-9]{8}\b/i.test(`${item.name} ${item.reason}`))
    .slice(0, MAX_PRODUCT_SUGGESTIONS);
  return clean.length ? { ok: true, suggestions: clean } : { ok: false, reason: "kein passender Produktkandidat gefunden" };
}

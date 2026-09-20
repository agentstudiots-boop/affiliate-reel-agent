import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { productReviewSchema, trendCandidateSchema } from "@/lib/schema";
import { tavilyContext, tavilySearch, tavilySources } from "@/lib/tavily";
import type { z } from "zod";

type Candidate = z.infer<typeof trendCandidateSchema>;

export async function reviewProduct(candidate: Candidate) {
  const searchResults = await tavilySearch({
    query: `${candidate.name} Deutschland Eigenschaften Erfahrungen Nachteile Hersteller`,
    timeRange: "year",
    maxResults: 8,
  });

  const result = await generateText({
    model: google("gemini-3.5-flash-lite"),
    maxRetries: 0,
    output: Output.object({ schema: productReviewSchema }),
    prompt: `Du bist die unabhängige Produkt-Prüfabteilung. Prüfe diesen Kandidaten anhand aktueller, seriöser Webquellen:
${JSON.stringify(candidate, null, 2)}

Nutze ausschließlich diese Tavily-Suchergebnisse als Webgrundlage:
${tavilyContext(searchResults)}

Regeln:
- Trenne belegbare Eigenschaften von Werbeaussagen.
- Erfinde keine Preise, Tests, Verkaufszahlen, Bestseller-Ränge oder Nutzererfahrungen.
- verifiedBenefits enthält nur vorsichtig formulierbare, überprüfbare Nutzenargumente.
- cautions nennt Behauptungen, die vor einem Reel auf der konkreten Produktseite geprüft werden müssen.
- confidence ist die Sicherheit der Recherche, keine Kauf- oder Verkaufsgarantie.
- approvalRecommendation ist nur true, wenn mindestens zwei sinnvolle, belegbare Nutzenargumente vorliegen.
- Gib keine medizinische, rechtliche oder finanzielle Empfehlung.`,
  });

  return { output: result.output, sources: tavilySources(searchResults) };
}

import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { productReviewSchema, trendCandidateSchema } from "@/lib/schema";
import type { z } from "zod";

type Candidate = z.infer<typeof trendCandidateSchema>;

export async function reviewProduct(candidate: Candidate) {
  const now = new Date();
  const recentStart = new Date(now);
  recentStart.setMonth(recentStart.getMonth() - 6);

  return generateText({
    model: google("gemini-3.5-flash-lite"),
    tools: {
      google_search: google.tools.googleSearch({
        searchTypes: { webSearch: {} },
        timeRangeFilter: {
          startTime: recentStart.toISOString(),
          endTime: now.toISOString(),
        },
      }),
    },
    output: Output.object({ schema: productReviewSchema }),
    prompt: `Du bist die unabhängige Produkt-Prüfabteilung. Prüfe diesen Kandidaten anhand aktueller, seriöser Webquellen:
${JSON.stringify(candidate, null, 2)}

Regeln:
- Trenne belegbare Eigenschaften von Werbeaussagen.
- Erfinde keine Preise, Tests, Verkaufszahlen, Bestseller-Ränge oder Nutzererfahrungen.
- verifiedBenefits enthält nur vorsichtig formulierbare, überprüfbare Nutzenargumente.
- cautions nennt Behauptungen, die vor einem Reel auf der konkreten Produktseite geprüft werden müssen.
- confidence ist die Sicherheit der Recherche, keine Kauf- oder Verkaufsgarantie.
- approvalRecommendation ist nur true, wenn mindestens zwei sinnvolle, belegbare Nutzenargumente vorliegen.
- Gib keine medizinische, rechtliche oder finanzielle Empfehlung.`,
  });
}

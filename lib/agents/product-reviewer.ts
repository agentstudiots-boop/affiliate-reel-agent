import { trendCandidateSchema } from "@/lib/schema";
import { tavilySearch, tavilySources } from "@/lib/tavily";
import type { z } from "zod";

type Candidate = z.infer<typeof trendCandidateSchema>;

export async function reviewProduct(candidate: Candidate) {
  const searchResults = await tavilySearch({ query: `${candidate.name} Deutschland Eigenschaften Erfahrungen Nachteile Hersteller`, timeRange: "year", maxResults: 8 });
  const hasEvidence = searchResults.length >= 2;
  return {
    output: {
      normalizedName: candidate.name,
      evidenceSummary: hasEvidence ? `Für den Kandidaten wurden ${searchResults.length} aktuelle Webquellen gefunden. Die konkrete Amazon-Produktseite muss vor Veröffentlichung trotzdem manuell geprüft werden.` : "Es wurden zu wenige belastbare Webquellen gefunden. Der Kandidat sollte nicht automatisch freigegeben werden.",
      verifiedBenefits: candidate.benefitsToVerify.map((item) => `Möglicher Vorteil – vor Veröffentlichung prüfen: ${item}`),
      cautions: ["Keine eigene Produkterfahrung oder Testergebnisse behaupten.", "Preis, Lieferzeit, Material und konkrete Eigenschaften auf der Produktseite prüfen.", "Werbung und Affiliate-Link deutlich kennzeichnen."],
      targetGroup: candidate.targetGroup,
      reelAngle: candidate.reelIdea,
      confidence: hasEvidence ? 55 : 25,
      approvalRecommendation: hasEvidence,
    },
    sources: tavilySources(searchResults),
  };
}

import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { trendReportSchema } from "@/lib/schema";

export async function scoutProducts() {
  const now = new Date();
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - 45);
  const toWholeSecondIso = (date: Date) =>
    date.toISOString().replace(/\.\d{3}Z$/, "Z");

  return generateText({
    model: google("gemini-3.5-flash-lite"),
    tools: {
      google_search: google.tools.googleSearch({
        searchTypes: { webSearch: {} },
        timeRangeFilter: {
          startTime: toWholeSecondIso(recentStart),
          endTime: toWholeSecondIso(now),
        },
      }),
    },
    output: Output.object({ schema: trendReportSchema }),
    prompt: `Du bist die Produkt-Scout-Abteilung für Amazon-Affiliate-Reels in Deutschland.
Heute ist ${now.toISOString().slice(0, 10)}. Recherchiere aktuelle Konsum- und Produktsignale der letzten 45 Tage und berücksichtige die nächsten 90 Tage im Saisonkalender (z. B. Valentinstag, Ostern, Sommer, Schulanfang, Halloween, Black Friday, Advent und Weihnachten, aber nur wenn zeitlich relevant).

Liefere 5 konkrete Produktideen:
- 2 Dauerläufer mit ganzjährigem, praktischem Nutzen,
- 2 zeitlich passende Saisonprodukte,
- 1 aktuell auffälliger Trend.

Keine Verkaufszahlen, Bestseller-Ränge, Preise, Rabatte oder Eigenschaften erfinden. Bevorzuge visuell demonstrierbare Produkte mit niedriger bis mittlerer Kaufhürde. Keine Waffen, Glücksspiel-, Erotik-, Tabak- oder riskanten Gesundheitsprodukte. Der confidence-Wert bewertet nur die Stärke der gefundenen Signale, nicht eine Verkaufsgarantie. searchQuery ist eine präzise deutsche Amazon-Suchphrase. Vorschläge bleiben Kandidaten für Prüfung und Freigabe.`,
  });
}

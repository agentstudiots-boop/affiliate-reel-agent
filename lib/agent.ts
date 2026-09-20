import { google } from "@ai-sdk/google";
import { Output, ToolLoopAgent } from "ai";
import { reelConceptSchema } from "@/lib/schema";

export const reelAgent = new ToolLoopAgent({
  model: google("gemini-3.8-flash"),
  instructions: `Du bist ein deutschsprachiger Affiliate-Reel-Redakteur.
Erstelle ein ehrliches, konkretes Reel-Konzept für genau ein Produkt.
Keine erfundenen Tests, Bewertungen, Rabatte, Lieferzeiten oder Eigenschaften.
Kennzeichne Werbung und Affiliate-Link klar. Formuliere keine unzulässigen
Gesundheitsversprechen. Ziel sind 20 bis 35 Sekunden, ein natürlicher Ton und
eine klare Handlungsaufforderung. Gib vor der Veröffentlichung praktische
Prüfpunkte aus.`,
  output: Output.object({ schema: reelConceptSchema }),
});

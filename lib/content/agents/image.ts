import { imageSchema } from "../schema";
import type { Brief, Generator } from "../agent";

export function imageAgent(brief: Brief, generate: Generator) {
  return generate("image", "Erstelle ein Einzelbild oder 3–7 zusammenhängende Carousel-Slides passend zum freigegebenen Konzept. Je Slide: Überschrift, knapper Text, konkrete Bildgestaltung, Bildprompt und Alt-Text. Keine gefälschten Produktfotos oder Typografie im generierten Bild verlangen; Schrift im Layout ergänzen. Keine Bilder erzeugen.", brief, imageSchema, () => {
    const { idea, opportunity } = brief;
    const vacuum = /vakuumier|vakuum.?versiegl/i.test(opportunity.product.name);
    const items = vacuum ? [
      [idea.hook, "Einen Einkauf in passende Mahlzeiten-Portionen aufteilen.", "Saubere Küchenarbeitsfläche mit einzeln vorbereiteten Portionen."],
      ["Portionieren und verschließen", "Zum Gerät und Lebensmittel passende Beutel verwenden.", "Hände führen einen gefüllten Beutel korrekt in einen neutralen Vakuumierer."],
      ["Beschriften und passend lagern", "Je nach Lebensmittel kühlen oder einfrieren. Vakuumieren ersetzt keine Kühlung und Hygiene.", "Beschriftete Portionen werden in ein Gefrierfach gelegt; Beschriftung später im Layout."],
      ["Sous-vide ist ein weiterer Anwendungsfall", "Zum Garen braucht es geeignete Beutel und ein separates temperiertes Wasserbad.", "Vakuumierer und separater Sous-vide-Garer in klar getrennten Bildbereichen."],
    ] : [[idea.hook, idea.situation, `Alltagssituation: ${idea.useCase}`], ["Die Anwendung verstehen", idea.benefit, `Konkreter Anwendungsschritt für ${opportunity.product.name}; keine unbestätigten Funktionen zeigen.`], ["Vor dem Kauf prüfen", "Eignung, Zubehör und Voraussetzungen am konkreten Modell vergleichen.", "Neutrale Übersicht der Kaufkriterien, Platz für redaktionell gesetzte Schrift."]];
    return { format: "image" as const, layout: "carousel" as const, title: idea.title, hook: idea.hook, useCase: idea.useCase,
      productIntegration: idea.benefit, slides: items.map(([headline, copy, visual]) => ({ headline, copy, visual, alt: visual,
        prompt: `Redaktionelle Social-Media-Illustration im Hochformat 4:5. ${visual} Ruhiges Tageslicht, klare Handlung, Platz für Überschrift. Keine Logos, keine eingebrannte Schrift, kein Anspruch auf exaktes Produktmodell.` })),
      caption: `Werbung | ${idea.benefit} ${opportunity.product.name}: Eignung, Lieferumfang und Hinweise beim konkreten Modell prüfen. Bei einem Kauf über den Affiliate-Link kann eine Provision anfallen.`,
      cta: new URL(opportunity.product.sourceUrl).pathname === "/s" ? "Passende Produkte in der verlinkten Auswahl vergleichen." : "Produktdetails über den gekennzeichneten Link prüfen.",
      disclosure: "Werbung | Affiliate-Link" as const, checks: ["Modellbezogene Aussagen und Bilddarstellung prüfen.", "Illustrationen als solche erkennbar halten; Kennzeichnung und Schrift im Layout ergänzen."],
    };
  });
}

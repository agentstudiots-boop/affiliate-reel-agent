import { imageSchema } from "../schema";
import type { Brief, Generator } from "../agent";

function shorten(value: string, max: number) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  return boundary > max * 0.45 ? slice.slice(0, boundary + 1) : slice.replace(/\\s+\\S*$/, "").trim() + "…";
}

function reviseReferenceImage(brief: Brief) {
  if (brief.previous?.format !== "image" || !brief.changeRequest) throw new Error("Vorheriger Bild-Plan und Änderungsauftrag fehlen.");
  const request = brief.changeRequest.toLocaleLowerCase("de-DE");
  const next = structuredClone(brief.previous);
  let applied = false;

  if (/kürzer|kompakter|weniger text|text reduzieren|text kürzen/.test(request)) {
    next.caption = shorten(next.caption, 520);
    next.slides = next.slides.map(slide => ({ ...slide, copy: shorten(slide.copy, 150), headline: shorten(slide.headline, 72) }));
    applied = true;
  }
  if (/weniger werblich|nicht so werblich|sachlicher|neutraler/.test(request)) {
    next.caption = `Werbung | ${brief.opportunity.product.name} als Produktidee für ${brief.idea.useCase}. Eignung, Lieferumfang und Herstellerangaben am konkreten Modell prüfen. Bei einem Kauf über den Affiliate-Link kann eine Provision anfallen.`;
    next.cta = new URL(brief.opportunity.product.sourceUrl).pathname === "/s"
      ? "Bei Interesse kannst du die verlinkte Auswahl sachlich vergleichen."
      : "Bei Interesse kannst du die Angaben zum verlinkten Produkt prüfen.";
    applied = true;
  }
  if (/(hook|überschrift|titel).{0,30}kürzer|kürzere.{0,20}(hook|überschrift|titel)/.test(request)) {
    next.hook = shorten(next.hook, 72);
    next.title = shorten(next.title, 72);
    if (next.slides[0]) next.slides[0].headline = shorten(next.slides[0].headline, 64);
    applied = true;
  }
  if (/((carousel|folien).{0,30}(kürzer|weniger))|weniger folien/.test(request) && next.slides.length > 3) {
    next.slides = [next.slides[0], next.slides[1], next.slides.at(-1)!];
    next.layout = "carousel";
    applied = true;
  }
  if (/cta.{0,30}(ändern|neutral|sachlich|weniger werblich)|(ändern|neutral|sachlich).{0,30}cta/.test(request)) {
    next.cta = new URL(brief.opportunity.product.sourceUrl).pathname === "/s"
      ? "Bei Interesse kannst du die verlinkte Auswahl vergleichen."
      : "Bei Interesse kannst du die Produktangaben im Link prüfen.";
    applied = true;
  }
  if (!applied) throw new Error("Änderungswunsch im Referenzmodus nicht eindeutig umsetzbar. Bitte z. B. „kürzer“, „weniger werblich“, „weniger Folien“, „Hook kürzer“ oder „CTA sachlicher“ schreiben.");
  return imageSchema.parse(next);
}

export function imageAgent(brief: Brief, generate: Generator) {
  return generate("image", "Erstelle ein Einzelbild oder 3–7 zusammenhängende Carousel-Slides passend zum freigegebenen Konzept. Je Slide: Überschrift, knapper Text, konkrete Bildgestaltung, Bildprompt und Alt-Text. Keine gefälschten Produktfotos oder Typografie im generierten Bild verlangen; Schrift im Layout ergänzen. Keine Bilder erzeugen.", brief, imageSchema, () => {
    if (brief.changeRequest) return reviseReferenceImage(brief);
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

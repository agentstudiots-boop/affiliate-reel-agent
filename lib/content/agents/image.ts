import { imageSchema } from "../schema";
import type { Brief, Generator } from "../agent";

function shorten(value: string, max: number) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  return boundary > max * 0.45 ? slice.slice(0, boundary + 1) : slice.replace(/\s+\S*$/, "").trim() + "…";
}

function visualConcept(brief: Brief) {
  const inspiration = brief.inspiration;
  return {
    kind: "carousel_guide" as const,
    mainIdea: inspiration.visualDirections[0] || `Eigenständige Alltagsszene für ${brief.idea.useCase}`,
    productRelation: `Die Produktkategorie ${inspiration.categoryLabel} wird in einer konkreten Nutzungssituation und anhand redaktioneller Kaufkriterien eingeordnet.`,
    everydaySituation: inspiration.useCases[0] || brief.idea.situation,
    sourceKind: inspiration.sourceKind,
    representation: inspiration.representation,
    originality: "original_editorial" as const,
    visualWeight: "image_led" as const,
  };
}

function readerCaption(brief: Brief, subdued = false) {
  const { inspiration } = brief;
  const linkTarget = inspiration.editorialMode === "category" ? "in der verlinkten Auswahl" : "auf der verlinkten Produktseite";
  if (/kuscheldecke|wohndecke|fleecedecke/i.test(inspiration.categoryLabel)) {
    if (subdued) return `Werbung | Wenn du eine Kuscheldecke für ruhige Abende auf dem Sofa suchst, lohnt sich ein Blick auf Größe, Material und Pflegehinweise. Prüfe die Angaben ${linkTarget} und entscheide, was zu deinem Alltag passt. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`;
    return `Werbung | Feierabend, Tee und ein Platz auf dem Sofa: Eine Kuscheldecke macht den ruhigen Abend ein bisschen gemütlicher. Welche zu dir passt, hängt von Größe, Material und Pflege ab. Prüfe die Angaben ${linkTarget} – besonders, wenn du dich ganz einwickeln möchtest. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`;
  }
  const criteria = inspiration.purchaseCriteria.slice(0, 3).join(", ");
  if (subdued) return `Werbung | Bei ${inspiration.categoryLabel} lohnt es sich, ${criteria} zu vergleichen. Prüfe die Angaben ${linkTarget} und entscheide, welche Ausführung zu deinem Alltag passt. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`;
  return `Werbung | ${inspiration.categoryLabel}: Worauf kommt es dir im Alltag an? Beim Vergleichen helfen ${criteria} als Orientierung. Prüfe die konkreten Angaben ${linkTarget}, bevor du dich entscheidest. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`;
}

function reviseReferenceImage(brief: Brief) {
  if (brief.previous?.format !== "image" || !brief.changeRequest) throw new Error("Vorheriger Bild-Plan und Änderungsauftrag fehlen.");
  const request = brief.changeRequest.toLocaleLowerCase("de-DE");
  const next = structuredClone(brief.previous);
  next.visualConcept ||= visualConcept(brief);
  let applied = false;

  if (/kürzer|kompakter|weniger text|text reduzieren|text kürzen/.test(request)) {
    next.caption = shorten(next.caption, 520);
    next.slides = next.slides.map(slide => ({ ...slide, copy: shorten(slide.copy, 150), headline: shorten(slide.headline, 72) }));
    applied = true;
  }
  if (/weniger werblich|nicht so werblich|sachlicher|neutraler/.test(request)) {
    const inspiration = brief.inspiration;
    next.caption = readerCaption(brief, true);
    next.cta = inspiration.editorialMode === "category"
      ? "Bei Interesse kannst du die verlinkte Auswahl sachlich vergleichen."
      : "Bei Interesse kannst du die verifizierbaren Produktangaben im Link prüfen.";
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
    const inspiration = brief.inspiration;
    next.cta = inspiration.editorialMode === "category"
      ? "Bei Interesse kannst du die verlinkte Auswahl vergleichen."
      : "Bei Interesse kannst du die Produktangaben im Link prüfen.";
    applied = true;
  }
  if (!applied) throw new Error("Änderungswunsch im Referenzmodus nicht eindeutig umsetzbar. Bitte z. B. „kürzer“, „weniger werblich“, „weniger Folien“, „Hook kürzer“ oder „CTA sachlicher“ schreiben.");
  return imageSchema.parse(next);
}

export function imageAgent(brief: Brief, generate: Generator) {
  const inspiration = brief.inspiration;
  return generate("image", `Erstelle ein Einzelbild oder 3–7 zusammenhängende Carousel-Slides passend zum freigegebenen Konzept.
Je Slide: Überschrift, knapper Text, konkrete Bildgestaltung, origineller Bildprompt und Alt-Text.
Ein echtes visuelles Konzept ist Pflicht: Lifestyle-/Anwendungsszene, redaktioneller Vergleich oder eigenständige Collage. Keine reine Textkarte oder Symbolgrafik als Endprodukt.
Nutze Product-Inspiration nur redaktionell. Keine Händlerbilder, Amazon-Screenshots, Logos, Shop-UI oder exakte Produktfoto-Nachbauten.
Bei Such-/Kategorieseiten kategorisch bleiben. Konkrete Produkteigenschaften nur aus verifiedFacts übernehmen.
Keine Typografie in das generierte Bild verlangen; Schrift wird später im Layout ergänzt. Keine Bilder erzeugen.`, { ...brief, inspiration }, imageSchema, () => {
    if (brief.changeRequest) return reviseReferenceImage({ ...brief, inspiration });
    const { idea, opportunity } = brief;
    const vacuum = /vakuumier|vakuum.?versiegl/i.test(opportunity.product.name);
    const categoryMode = inspiration.editorialMode === "category";
    const criteria = inspiration.purchaseCriteria.slice(0, 3);

    const items: [string, string, string][] = vacuum ? [
      [idea.hook, "Einen Einkauf in passende Mahlzeiten-Portionen aufteilen.", "Saubere Küchenarbeitsfläche mit mehreren vorbereiteten Lebensmittelportionen und neutralem, markenfreiem Gerät im Anwendungskontext."],
      ["Portionieren und verschließen", "Zum Gerät und Lebensmittel passende Beutel verwenden.", "Hände führen einen gefüllten Beutel in ein neutral dargestelltes Vakuumiergerät; klare Handlung statt Produktshot."],
      ["Beschriften und passend lagern", "Je nach Lebensmittel kühlen oder einfrieren. Vakuumieren ersetzt keine Kühlung und Hygiene.", "Beschriftete, neutral verpackte Portionen werden nachvollziehbar in Kühl- und Gefrierkontext einsortiert."],
      ["Sous-vide ist ein weiterer Anwendungsfall", "Zum Garen braucht es geeignete Beutel und ein separates temperiertes Wasserbad.", "Vakuumiergerät und separater Sous-vide-Garer in einer Küchenanwendung klar als unterschiedliche Aufgaben visualisiert."],
    ] : [
      [idea.hook, idea.situation, inspiration.visualDirections[0] || `Konkrete Alltagssituation: ${idea.useCase}`],
      ...criteria.map((criterion, index) => [
        criterion,
        `${criterion} als Kaufkriterium anhand der Herstellerangaben bzw. der Auswahl prüfen.`,
        inspiration.visualDirections[index + 1] || `Eigenständige redaktionelle Illustration zum Kriterium ${criterion}; Produktkategorie in realistischem Nutzungskontext, keine Händleroberfläche.`,
      ] as [string, string, string]),
      [
        categoryMode ? "Auswahl vergleichen" : "Angaben am Produkt prüfen",
        categoryMode ? "Mehrere passende Optionen anhand der Kriterien sachlich gegenüberstellen." : "Nur belegte Produktangaben in die Entscheidung einbeziehen.",
        "Eigenständige redaktionelle Vergleichsszene mit mehreren neutralen, nicht markengebundenen Varianten im Nutzungskontext; keine Shop-Kacheln, Preise oder Sternebewertungen.",
      ],
    ];

    return {
      format: "image" as const,
      layout: "carousel" as const,
      visualConcept: visualConcept({ ...brief, inspiration }),
      title: idea.title,
      hook: idea.hook,
      useCase: idea.useCase,
      productIntegration: idea.benefit,
      slides: items.slice(0, 7).map(([headline, copy, visual]) => ({
        headline,
        copy,
        visual,
        alt: visual,
        prompt: `Originelles redaktionelles Social-Media-Visual im Hochformat 4:5. ${visual} Hochwertiger Editorial-/Lifestyle-Look, glaubwürdige Materialien und Licht, klare visuelle Hauptaussage, ausreichend freie Fläche für später gesetzte kurze Redaktionstexte. Keine Logos, keine Shop-Oberfläche, keine eingebrannte Schrift, keine exakte Modellnachbildung und keine erfundenen Produkteigenschaften.`,
      })),
      caption: readerCaption({ ...brief, inspiration }),
      cta: categoryMode ? "Optionen in der Auswahl ansehen und vergleichen." : "Produktdetails über den gekennzeichneten Link prüfen.",
      disclosure: "Werbung | Affiliate-Link" as const,
      checks: [
        "Visual muss als originelles redaktionelles Creative vorliegen; Textkarte/Symbolgrafik ist nur Preview.",
        categoryMode ? "Keine konkrete Modellbehauptung aus der Such-/Kategorieseite ableiten." : "Modellbezogene Aussagen nur aus verifiedFacts übernehmen.",
        "Keine Händlerbilder, Logos, Shop-Screenshots oder exakten Produktfoto-Nachbauten verwenden.",
      ],
    };
  });
}

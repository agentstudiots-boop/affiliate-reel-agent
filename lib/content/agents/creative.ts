import { creativeSchema, type Opportunity } from "../schema";
import type { Generator, ProductInspiration } from "../agent";

export function creativeAgent(opportunity: Opportunity, generate: Generator, inspiration: ProductInspiration) {
  return generate("creative", `Entwickle drei unterschiedliche starke Werbeideen: je eine für Video, Bild/Carousel und Text.
Jede Idee: konkrete Alltagssituation, emotionaler Hook, Handlung, Nutzen, ehrliche Grenzen und Formatbegründung.
Prüfe zuerst die tatsächliche Produktfunktion. Ein Kürbisschnitzset für Halloween gehört zu Home & Living, Dekoration und Basteln: echter Kürbis, sichtbar geschnitzte Gesichtszüge, Laterne als Ergebnis. Keine Koch- oder Essensgeschichte und keine Küchenwerkzeuge für diesen Fall.
Nutze die mitgelieferte Product-Inspiration nur als redaktionelle Inspirationsquelle. Bei Such-/Kategorie-Seiten kategorisch bleiben und kein konkretes Modell vortäuschen.
Keine Händlerbilder, Amazon-Screenshots, Logos oder geschützten Shop-Layouts als Creative planen. Keine exakten Produkteigenschaften ohne verifiedFacts behaupten.
Für Bild/Carousel ist eine echte visuelle Hauptidee Pflicht: Lifestyle, Anwendung, Vergleich oder redaktionelle Collage; keine reine Textkarte.
Prüfe Humor, Überraschung und Storytelling, ohne diese künstlich zu erzwingen. Bewertungen 0–5 sind redaktionelle Einschätzungen, keine Performance-Daten.
Berücksichtige Zielgruppe, Trend, Use Case, Budget und Ziel. Melde sinnvolle Zusatzprodukte mit Begründung und ob erforderlich.`, { opportunity, inspiration }, creativeSchema, () => {
    const vacuum = /vakuumier|vakuum.?versiegl/i.test(opportunity.product.name);
    const pumpkin = /(?:kürbis|kuerbis|pumpkin).{0,40}(?:schnitz|carving)|(?:schnitz|carving).{0,40}(?:kürbis|kuerbis|pumpkin)/i.test(opportunity.product.name);
    const expert = /fach|technik|kompatib|vergleich|community|software|sicherheit/i.test(`${opportunity.useCase} ${opportunity.product.targetGroup}`);
    const storageFocus = /vorrat|haltbar|lager|meal.?prep|einkauf/i.test(opportunity.useCase) && !/steak|familienessen|sous.?vide/i.test(opportunity.useCase);
    const categorical = inspiration.editorialMode === "category";
    const crossSell = vacuum ? [
      { product: "Sous-vide-Garer", reason: "Das temperierte Wasserbad gart das Steak; der Vakuumierer verschließt nur den Beutel.", required: true },
      { product: "Sous-vide-geeignete Vakuumbeutel", reason: "Beutel müssen zum Gerät und zur vorgesehenen Garmethode passen.", required: true },
    ] : [];
    const shared = {
      useCase: opportunity.useCase,
      assumptions: [
        "Redaktioneller Referenzentwurf, keine freie KI-Analyse.",
        inspiration.sourceSummary,
        "Konkrete Modelleigenschaften nur aus separat verifizierten Fakten übernehmen.",
      ],
      crossSell,
    };
    const criteria = inspiration.purchaseCriteria.slice(0, 3).join(", ");
    return { ideas: [
      { ...shared, id: "story", format: "video" as const,
        title: vacuum ? "Oma glaubt es erst nach dem ersten Bissen" : pumpkin ? "Vom Kürbis zur leuchtenden Halloween-Deko" : "Der Aha-Moment im Alltag",
        hook: vacuum ? "Das hast du doch nicht selbst gemacht!" : pumpkin ? "Erst ein Kürbis – dann leuchten Augen und Mund." : `So könnte ${inspiration.categoryLabel} in deinen Alltag passen.`,
        situation: vacuum ? "Die Familie sitzt beim Steakessen. Oma schneidet ein Stück an und schaut überrascht zu Papa." : opportunity.useCase,
        story: vacuum ? "Omas überraschter Blick eröffnet die inszenierte Geschichte. Rückblende: Steak vakuumieren, Sous-vide-Wasserbad mit separatem Garer, auspacken und anbraten. Zurück am Tisch: saftiger rosa Anschnitt und Papas Erklärung." : pumpkin ? "Vorfreude am Basteltisch: Ein Erwachsener zeichnet Augen und Mund auf den echten Kürbis, schnitzt beides sichtbar mit einem Kürbisschnitzwerkzeug aus und zeigt stolz die leuchtende Halloweenlaterne. Das Schnitzset ist als mögliche Werkzeugwahl erkennbar; keine unbelegten Modellmerkmale." : `Zeige zuerst das gewünschte Ergebnis in dieser Situation: ${opportunity.useCase}. Danach die Anwendung und ihre Voraussetzungen nachvollziehbar demonstrieren, ohne ein konkretes Modell zu imitieren.`,
        benefit: vacuum ? "Sous-vide-Vorbereitung zuhause wird als konkreter Schritt zum gemeinsamen Familienessen verständlich." : pumpkin ? "Die Arbeitsschritte machen das gemeinsame Basteln und das Ergebnis als Halloween-Deko anschaulich." : `Die Anwendung der Produktkategorie für ${opportunity.product.targetGroup} anschaulich machen.`,
        rationale: "Handlung und emotionales Ergebnis lassen sich in einer kurzen Geschichte zeigen.",
        scores: { audience: storageFocus ? 2 : 4, credibility: 3, demonstration: storageFocus ? 2 : vacuum ? 5 : 3, conversion: storageFocus ? 2 : 4, economy: 1 } },
      { ...shared, id: "guide", format: "image" as const,
        title: vacuum ? "Ein Einkauf, drei vorbereitete Portionen" : categorical ? `Welche ${inspiration.categoryLabel} passt zu deinem Alltag?` : `${inspiration.categoryLabel}: Anwendung und Kriterien im Blick`,
        hook: vacuum ? "Was morgen auf den Tisch kommt, bereitest du heute vor." : categorical ? `Nicht nur nach Optik wählen: ${criteria} im Alltag vergleichen.` : `Passt ${inspiration.categoryLabel} zu deinem Anwendungsfall?`,
        situation: vacuum ? "Nach dem Einkauf werden Portionen vorbereitet und passend gelagert." : inspiration.useCases[0] || opportunity.useCase,
        story: vacuum ? "Carousel: portionieren, vakuumieren, beschriften, passend kühlen oder einfrieren. Ein letzter Slide trennt Lagerung und Sous-vide-Vorbereitung." : `Eigenständiges redaktionelles Carousel: emotionale Anwendungsszene als Einstieg, danach kurze visuelle Orientierung zu ${criteria}; keine Händlerbilder oder Modellbehauptungen.`,
        benefit: vacuum ? "Vorbereitete Portionen griffbereit haben; Lagerbedingungen bleiben entscheidend." : "Anwendung und relevante Kaufkriterien als visuelle Entscheidungshilfe verständlich machen.",
        rationale: "Speicherbare visuelle Orientierung mit konkreter Alltagsszene; deutlich mehr Nutzwert als eine Textkarte.",
        scores: { audience: 4, credibility: 4, demonstration: 4, conversion: 3, economy: 4 } },
      { ...shared, id: "discussion", format: "text" as const,
        title: vacuum ? "Vakuumieren ist noch kein Garen" : "Eine ehrliche Entscheidungshilfe",
        hook: vacuum ? "Braucht man fürs Sous-vide-Steak wirklich zwei Geräte?" : categorical ? `Welche Kriterien zählen bei ${inspiration.categoryLabel} wirklich?` : `Wann lohnt sich ${inspiration.categoryLabel} für diesen Zweck?`,
        situation: vacuum ? "Hobbyköche überlegen, was sie zum Einstieg in Sous-vide tatsächlich brauchen." : opportunity.useCase,
        story: vacuum ? "Die Rollen von Vakuumierer, geeignetem Beutel und temperiertem Wasserbad erklären. Lagerung als zweiten Use Case einordnen und die Community nach ihrem Alltag fragen." : "Den beschriebenen Anwendungsfall erklären, offene Eignungsfragen benennen und zur Diskussion einladen, ohne eigene Nutzung zu erfinden.",
        benefit: "Eine informierte Kaufentscheidung mit verständlichen Voraussetzungen.",
        rationale: "Fachliche Fragen und Grenzen brauchen Erklärung; Text erlaubt Nuancen und Rückfragen.",
        scores: { audience: expert ? 5 : 3, credibility: 5, demonstration: expert ? 4 : 1, conversion: 3, economy: 5 } },
    ] };
  });
}

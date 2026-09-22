import { creativeSchema, type Opportunity } from "../schema";
import type { Generator } from "../agent";

export function creativeAgent(opportunity: Opportunity, generate: Generator) {
  return generate("creative", `Entwickle drei unterschiedliche starke Werbeideen: je eine für Video, Bild/Carousel und Text.
Jede Idee: konkrete Alltagssituation, emotionaler Hook, Handlung, Nutzen, ehrliche Grenzen und Formatbegründung.
Prüfe Humor, Überraschung und Storytelling, ohne diese künstlich zu erzwingen. Bewertungen 0–5 sind redaktionelle Einschätzungen, keine Performance-Daten.
Berücksichtige Zielgruppe, Trend, Use Case, Budget und Ziel. Melde sinnvolle Zusatzprodukte mit Begründung und ob erforderlich.`, opportunity, creativeSchema, () => {
    const vacuum = /vakuumier|vakuum.?versiegl/i.test(opportunity.product.name);
    const expert = /fach|technik|kompatib|vergleich|community|software|sicherheit/i.test(`${opportunity.useCase} ${opportunity.product.targetGroup}`);
    const storageFocus = /vorrat|haltbar|lager|meal.?prep|einkauf/i.test(opportunity.useCase) && !/steak|familienessen|sous.?vide/i.test(opportunity.useCase);
    const crossSell = vacuum ? [
      { product: "Sous-vide-Garer", reason: "Das temperierte Wasserbad gart das Steak; der Vakuumierer verschließt nur den Beutel.", required: true },
      { product: "Sous-vide-geeignete Vakuumbeutel", reason: "Beutel müssen zum Gerät und zur vorgesehenen Garmethode passen.", required: true },
    ] : [];
    const shared = { useCase: opportunity.useCase, assumptions: ["Redaktioneller Referenzentwurf, keine freie KI-Analyse.", "Konkrete Modelleigenschaften und Eignung vor Veröffentlichung prüfen."], crossSell };
    return { ideas: [
      { ...shared, id: "story", format: "video" as const,
        title: vacuum ? "Oma glaubt es erst nach dem ersten Bissen" : "Der Aha-Moment im Alltag",
        hook: vacuum ? "Das hast du doch nicht selbst gemacht!" : `So könnte ${opportunity.product.name} in deinen Alltag passen.`,
        situation: vacuum ? "Die Familie sitzt beim Steakessen. Oma schneidet ein Stück an und schaut überrascht zu Papa." : opportunity.useCase,
        story: vacuum ? "Omas überraschter Blick eröffnet die inszenierte Geschichte. Rückblende: Steak vakuumieren, Sous-vide-Wasserbad mit separatem Garer, auspacken und anbraten. Zurück am Tisch: saftiger rosa Anschnitt und Papas Erklärung." : `Zeige zuerst das gewünschte Ergebnis in dieser Situation: ${opportunity.useCase}. Danach die Anwendung und ihre Voraussetzungen nachvollziehbar demonstrieren.`,
        benefit: vacuum ? "Sous-vide-Vorbereitung zuhause wird als konkreter Schritt zum gemeinsamen Familienessen verständlich." : `Die Anwendung für ${opportunity.product.targetGroup} anschaulich machen.`,
        rationale: "Handlung und emotionales Ergebnis lassen sich in einer kurzen Geschichte zeigen.",
        scores: { audience: storageFocus ? 2 : 4, credibility: 3, demonstration: storageFocus ? 2 : vacuum ? 5 : 3, conversion: storageFocus ? 2 : 4, economy: 1 } },
      { ...shared, id: "guide", format: "image" as const,
        title: vacuum ? "Ein Einkauf, drei vorbereitete Portionen" : "Vor dem Kauf: die Anwendung verstehen",
        hook: vacuum ? "Was morgen auf den Tisch kommt, bereitest du heute vor." : `Passt ${opportunity.product.name} zu deinem Anwendungsfall?`,
        situation: vacuum ? "Nach dem Einkauf werden Portionen vorbereitet und passend gelagert." : opportunity.useCase,
        story: vacuum ? "Carousel: portionieren, vakuumieren, beschriften, passend kühlen oder einfrieren. Ein letzter Slide trennt Lagerung und Sous-vide-Vorbereitung." : "Carousel mit Ausgangssituation, konkreter Anwendung, benötigtem Zubehör und einer Kaufentscheidungshilfe.",
        benefit: vacuum ? "Vorbereitete Portionen griffbereit haben; Lagerbedingungen bleiben entscheidend." : "Schritte und Kaufkriterien in Ruhe vergleichen können.",
        rationale: "Speicherbare Schrittfolge; geringer Produktionsaufwand als ein inszeniertes Video.",
        scores: { audience: 4, credibility: 4, demonstration: 4, conversion: 3, economy: 4 } },
      { ...shared, id: "discussion", format: "text" as const,
        title: vacuum ? "Vakuumieren ist noch kein Garen" : "Eine ehrliche Entscheidungshilfe",
        hook: vacuum ? "Braucht man fürs Sous-vide-Steak wirklich zwei Geräte?" : `Wann lohnt sich ${opportunity.product.name} für diesen Zweck?`,
        situation: vacuum ? "Hobbyköche überlegen, was sie zum Einstieg in Sous-vide tatsächlich brauchen." : opportunity.useCase,
        story: vacuum ? "Die Rollen von Vakuumierer, geeignetem Beutel und temperiertem Wasserbad erklären. Lagerung als zweiten Use Case einordnen und die Community nach ihrem Alltag fragen." : "Den beschriebenen Anwendungsfall erklären, offene Eignungsfragen benennen und zur Diskussion einladen, ohne eigene Nutzung zu erfinden.",
        benefit: "Eine informierte Kaufentscheidung mit verständlichen Voraussetzungen.",
        rationale: "Fachliche Fragen und Grenzen brauchen Erklärung; Text erlaubt Nuancen und Rückfragen.",
        scores: { audience: expert ? 5 : 3, credibility: 5, demonstration: expert ? 4 : 1, conversion: 3, economy: 5 } },
    ] };
  });
}

import { tavilySearch, tavilySources } from "@/lib/tavily";
import type { ContentChance } from "@/lib/content/strategy";
import { CHANCE_SEEDS, CONTENT_CHANCES } from "@/lib/agents/content-chances";

type Kind = "Dauerläufer" | "Saisontrend" | "Aktueller Trend";
type Seed = { name: string; category: string; kind: Kind; season: string; whyNow: string; reelIdea: string; targetGroup: string; benefitsToVerify: string[]; chance?: ContentChance };

const evergreen: Seed[] = [
  { name: "Hochwertige Küchenreibe", category: "Küche", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Praktisches Küchenwerkzeug mit dauerhaft verständlichem Nutzen.", reelIdea: "Nahaufnahme beim Reiben von Hartkäse oder Zitrusschale.", targetGroup: "Hobbyköche und Haushalte", benefitsToVerify: ["Klingenmaterial und Schärfe", "Reinigung und Handhabung"] },
  { name: "Vakuumiergerät für Lebensmittel", category: "Haushalt", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Vorratshaltung und Küchenorganisation sind dauerhaft relevante Themen.", reelIdea: "Lebensmittel portionieren, vakuumieren und ordentlich lagern.", targetGroup: "Haushalte, Meal-Prep-Fans und Hobbyköche", benefitsToVerify: ["Kompatible Beutel", "Bedienung und Reinigungsmöglichkeiten"] },
  { name: "Silikon Backmatte", category: "Backen", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Backzubehör wird das ganze Jahr verwendet.", reelIdea: "Teig auf einer geeigneten Backmatte ausrollen und die Arbeitsfläche danach reinigen.", targetGroup: "Hobbybäcker", benefitsToVerify: ["Material und Maße", "Temperaturangaben des Herstellers"] },
  { name: "Messbecher mit Skala", category: "Küche", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Abmessen gehört zu vielen Rezepten.", reelIdea: "Zutaten für ein Rezept sichtbar abmessen und in die Schüssel geben.", targetGroup: "Hobbyköche und Hobbybäcker", benefitsToVerify: ["Skaleneinteilung", "Material und Fassungsvermögen"] },
  { name: "Aufbewahrungsboxen mit Deckel", category: "Haushalt", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Ordnung im Haushalt ist dauerhaft relevant.", reelIdea: "Kleinteile sortieren und die verschlossenen Boxen ins Regal stellen.", targetGroup: "Haushalte", benefitsToVerify: ["Maße und Material", "Lieferumfang"] },
  { name: "Wäschekorb mit Griffen", category: "Haushalt", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Wäschetransport gehört zum Alltag.", reelIdea: "Wäsche aus dem Bad zur Waschmaschine tragen und den Korb abstellen.", targetGroup: "Haushalte", benefitsToVerify: ["Fassungsvermögen", "Maße und Griffe"] },
  { name: "Rutschfeste Badematte", category: "Wohnen", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Badezimmerzubehör ist ganzjährig gefragt.", reelIdea: "Die Matte vor die Dusche legen und Material sowie Pflegehinweise zeigen.", targetGroup: "Haushalte", benefitsToVerify: ["Maße und Material", "Pflege und Eignung für den Untergrund"] },
  { name: "LED Schreibtischlampe", category: "Wohnen", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Gutes Arbeitslicht ist am Schreibtisch dauerhaft nützlich.", reelIdea: "Einen Schreibtisch zum Lesen oder Arbeiten ausleuchten.", targetGroup: "Menschen mit Arbeitsplatz zu Hause", benefitsToVerify: ["Stromversorgung", "Abmessungen und Bedienelemente"] },
  { name: "Gartenhandschuhe", category: "Garten", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Pflegearbeiten an Pflanzen fallen regelmäßig an.", reelIdea: "Pflanzen umtopfen und dabei die Passform der Handschuhe zeigen.", targetGroup: "Balkon- und Gartenfans", benefitsToVerify: ["Material und Größen", "Pflegehinweise"] },
  { name: "Edelstahl Trinkflasche", category: "Unterwegs", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Getränke mitzunehmen ist ein alltäglicher Bedarf.", reelIdea: "Eine Trinkflasche für den Arbeitsweg befüllen und in die Tasche stellen.", targetGroup: "Pendler und Familien", benefitsToVerify: ["Fassungsvermögen", "Verschluss und Reinigung"] },
  { name: "Brotdose mit Fächern", category: "Unterwegs", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Mahlzeiten für unterwegs werden ganzjährig vorbereitet.", reelIdea: "Ein einfaches Pausenbrot und Obst getrennt einpacken.", targetGroup: "Pendler und Familien", benefitsToVerify: ["Fächer und Material", "Reinigung und Verschluss"] },
  { name: "Duschabzieher", category: "Bad", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Die Reinigung der Dusche ist eine regelmäßige Haushaltsaufgabe.", reelIdea: "Wasser nach dem Duschen von einer geeigneten Glasfläche abziehen.", targetGroup: "Haushalte", benefitsToVerify: ["Breite und Material", "Eignung für die Oberfläche"] },
  { name: "Kabel Organizer", category: "Wohnen", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Kabelordnung am Arbeitsplatz ist dauerhaft relevant.", reelIdea: "Ladekabel am Schreibtisch sortieren und den Aufbau zeigen.", targetGroup: "Menschen mit mehreren Geräten", benefitsToVerify: ["Befestigung und Lieferumfang", "Geeignete Kabelmaße"] },
];

function seasonalSeeds(month: number): Seed[] {
  if (month <= 2) return [
    { name: "Gravierbare Schmuck-Geschenkidee", category: "Geschenke", kind: "Saisontrend", season: "Valentinstag", whyNow: "Geschenkideen werden vor dem Valentinstag verstärkt gesucht.", reelIdea: "Verpackung, Detailaufnahme und mögliche Personalisierung zeigen.", targetGroup: "Menschen auf der Suche nach einem persönlichen Geschenk", benefitsToVerify: ["Materialangabe", "Personalisierung und Lieferzeit"] },
    { name: "Wärmende Kuscheldecke", category: "Wohnen", kind: "Saisontrend", season: "Winter", whyNow: "Wärme und Gemütlichkeit passen zur kalten Jahreszeit.", reelIdea: "Gemütliche Sofaszene mit Material-Nahaufnahme.", targetGroup: "Haushalte und Geschenkekäufer", benefitsToVerify: ["Material und Maße", "Waschbarkeit"] },
  ];
  if (month <= 4) return [
    { name: "Oster-Backformen-Set", category: "Backen", kind: "Saisontrend", season: "Ostern", whyNow: "Back- und Dekorationsideen werden vor Ostern relevant.", reelIdea: "Vom Teig bis zum fertigen Ostergebäck in schnellen Schnitten.", targetGroup: "Familien und Hobbybäcker", benefitsToVerify: ["Material", "Spülmaschinen- und Hitzebeständigkeit"] },
    { name: "Anzuchtset für Kräuter", category: "Garten", kind: "Saisontrend", season: "Frühling", whyNow: "Im Frühjahr beginnt für viele die Anzucht- und Gartensaison.", reelIdea: "Aussaat, Keimung und Platzierung am Fenster zeigen.", targetGroup: "Balkon-, Garten- und Küchenkräuter-Fans", benefitsToVerify: ["Lieferumfang", "geeignete Pflanzen und Standortbedingungen"] },
  ];
  if (month <= 7) return [
    { name: "Tragbarer Tischventilator", category: "Sommer", kind: "Saisontrend", season: "Sommer", whyNow: "Kompakte Kühlung wird in warmen Monaten relevanter.", reelIdea: "Größe, Bedienung und Einsatz am Schreibtisch zeigen.", targetGroup: "Menschen im Homeoffice und unterwegs", benefitsToVerify: ["Akkulaufzeit", "Lautstärke und Leistungsstufen"] },
    { name: "Wiederverwendbares Grillkorb-Set", category: "Grillen", kind: "Saisontrend", season: "Grillsaison", whyNow: "Grillzubehör passt zur saisonalen Nutzung im Freien.", reelIdea: "Gemüse vorbereiten und die Handhabung am Grill demonstrieren.", targetGroup: "Grillfans und Haushalte mit Balkon oder Garten", benefitsToVerify: ["Material", "Größe und Reinigungsmöglichkeiten"] },
  ];
  if (month <= 10) return [
    { name: "Kürbis-Schnitzwerkzeug-Set", category: "Halloween", kind: "Saisontrend", season: "Halloween", whyNow: "Die Nachfrage nach Kürbis- und Halloween-Zubehör steigt vor Ende Oktober.", reelIdea: "Vom Kürbis zur fertigen Laterne als Vorher-Nachher-Sequenz.", targetGroup: "Familien und Halloween-Fans", benefitsToVerify: ["Lieferumfang", "Material und sichere Handhabung"] },
    { name: "Halloween LED Kürbis Lichterkette", category: "Halloween", kind: "Saisontrend", season: "Halloween", whyNow: "Halloween-Dekoration wird vor Ende Oktober verstärkt gesucht.", reelIdea: "Dunkle Fensterbank vorher, leuchtende Halloween-Stimmung nachher.", targetGroup: "Familien und Halloween-Fans", benefitsToVerify: ["Stromversorgung und Länge", "Einsatz innen oder außen laut Hersteller"] },
    { name: "Wärmende Kuscheldecke", category: "Wohnen", kind: "Saisontrend", season: "Herbst", whyNow: "Gemütliche Wohnprodukte werden mit sinkenden Temperaturen relevanter.", reelIdea: "Materialstruktur und gemütliche Sofaszene zeigen.", targetGroup: "Haushalte und Geschenkekäufer", benefitsToVerify: ["Material und Maße", "Waschbarkeit"] },
  ];
  return [
    { name: "LED-Weihnachtsbeleuchtung", category: "Weihnachten", kind: "Saisontrend", season: "Advent", whyNow: "Dekoration wird vor Advent und Weihnachten verstärkt gesucht.", reelIdea: "Aufbau und Lichtwirkung vorher und nachher zeigen.", targetGroup: "Haushalte und Dekorationsfans", benefitsToVerify: ["Einsatzbereich innen oder außen", "Länge, Stromversorgung und Schutzart"] },
    { name: "Praktisches Küchen-Geschenkset", category: "Geschenke", kind: "Saisontrend", season: "Weihnachten", whyNow: "Nützliche Geschenkideen sind vor Weihnachten besonders relevant.", reelIdea: "Lieferumfang auspacken und eine Anwendung demonstrieren.", targetGroup: "Geschenkekäufer und Hobbyköche", benefitsToVerify: ["Lieferumfang", "Material und Reinigung"] },
  ];
}

// Static bootstrap/fallback ideas (no network). Ideas start from a content chance; those without a recorded chance
// stay in the list only so the quality gate can reject them transparently.
export function seedIdeas(now = new Date()) {
  const chanceIdeas: Seed[] = CHANCE_SEEDS.map(item => ({ ...item, kind: "Dauerläufer" as const, season: "Ganzjährig" }));
  return [...evergreen, ...chanceIdeas, ...seasonalSeeds(now.getUTCMonth() + 1)].map(seed => ({ ...seed, chance: seed.chance ?? CONTENT_CHANCES[seed.name], searchQuery: seed.name, confidence: 55 }));
}

export async function scoutProducts(productSearch?: string) {
  const now = new Date();
  if (productSearch) {
    const searchResults = await tavilySearch({ query: `${productSearch} Produktvergleich Deutschland Anwendung Kaufberatung`, maxResults: 6 });
    const candidate: Seed = {
      name: productSearch, category: "Gezielte Artikelsuche", kind: "Dauerläufer", season: "Auf Anfrage",
      whyNow: `Gezielte Suche nach ${productSearch} auf Wunsch des Betreibers; kein belegter Trend.`,
      reelIdea: `${productSearch} in einer passenden Alltagssituation zeigen. Nur belegte Produkteigenschaften nennen und die Eignung vor dem Kauf prüfen.`,
      targetGroup: "Menschen, die ein passendes Produkt für ihren Alltag suchen",
      benefitsToVerify: ["Anwendung und Lieferumfang", "Herstellerhinweise und konkrete Produktmerkmale"],
    };
    return {output:{summary:`Gezielte Trendscout-Suche nach „${productSearch}“. Ein konkretes Produkt wird erst nach Prüfung der Amazon-Produktseite ausgewählt.`,
      researchedAt:now.toISOString(),candidates:[{...candidate,searchQuery:productSearch,confidence:50}]},
      sources:tavilySources(searchResults)};
  }
  const searchResults = await tavilySearch({ query: "Deutschland aktuelle Produkttrends Haushalt Küche Geschenke saisonale Produkte", timeRange: "month", maxResults: 10 });
  const signal = searchResults[0];
  const trendName = signal?.title?.slice(0, 110) || "Aktuell gefragtes Haushaltsprodukt";
  const trend: Seed = { name: trendName, category: "Aktuelles Suchsignal", kind: "Aktueller Trend", season: "Aktuell", whyNow: signal ? `Aktuelles Suchsignal: ${signal.title}` : "Aktueller Kandidat zur manuellen Prüfung.", reelIdea: "Das konkrete Alltagsproblem und die Anwendung in einer kurzen Vorher-Nachher-Sequenz zeigen.", targetGroup: "Interessierte Käufer in Deutschland", benefitsToVerify: ["Produkteigenschaften auf der Amazon-Seite", "Preis, Verfügbarkeit und Kundenhinweise"] };
  const candidates = [...seedIdeas(now), { ...trend, searchQuery: trend.name,
    confidence: Math.round(Math.min(85, Math.max(35, (signal?.score ?? 0.5) * 100))) }];
  return { output: { summary: "Tavily hat aktuelle Websignale geliefert. Die Vorschläge wurden ohne kostenpflichtiges Sprachmodell mit einem Saisonkalender und festen Sicherheitsregeln zusammengestellt.", researchedAt: now.toISOString(), candidates }, sources: tavilySources(searchResults) };
}

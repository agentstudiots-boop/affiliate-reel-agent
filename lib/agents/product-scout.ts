import { tavilySearch, tavilySources } from "@/lib/tavily";

type Kind = "Dauerläufer" | "Saisontrend" | "Aktueller Trend";
type Seed = { name: string; category: string; kind: Kind; season: string; whyNow: string; reelIdea: string; targetGroup: string; benefitsToVerify: string[] };

const evergreen: Seed[] = [
  { name: "Hochwertige Küchenreibe", category: "Küche", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Praktisches Küchenwerkzeug mit dauerhaft verständlichem Nutzen.", reelIdea: "Nahaufnahme beim Reiben von Hartkäse oder Zitrusschale.", targetGroup: "Hobbyköche und Haushalte", benefitsToVerify: ["Klingenmaterial und Schärfe", "Reinigung und Handhabung"] },
  { name: "Vakuumiergerät für Lebensmittel", category: "Haushalt", kind: "Dauerläufer", season: "Ganzjährig", whyNow: "Vorratshaltung und Küchenorganisation sind dauerhaft relevante Themen.", reelIdea: "Lebensmittel portionieren, vakuumieren und ordentlich lagern.", targetGroup: "Haushalte, Meal-Prep-Fans und Hobbyköche", benefitsToVerify: ["Kompatible Beutel", "Bedienung und Reinigungsmöglichkeiten"] },
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
    { name: "Wärmende Kuscheldecke", category: "Wohnen", kind: "Saisontrend", season: "Herbst", whyNow: "Gemütliche Wohnprodukte werden mit sinkenden Temperaturen relevanter.", reelIdea: "Materialstruktur und gemütliche Sofaszene zeigen.", targetGroup: "Haushalte und Geschenkekäufer", benefitsToVerify: ["Material und Maße", "Waschbarkeit"] },
  ];
  return [
    { name: "LED-Weihnachtsbeleuchtung", category: "Weihnachten", kind: "Saisontrend", season: "Advent", whyNow: "Dekoration wird vor Advent und Weihnachten verstärkt gesucht.", reelIdea: "Aufbau und Lichtwirkung vorher und nachher zeigen.", targetGroup: "Haushalte und Dekorationsfans", benefitsToVerify: ["Einsatzbereich innen oder außen", "Länge, Stromversorgung und Schutzart"] },
    { name: "Praktisches Küchen-Geschenkset", category: "Geschenke", kind: "Saisontrend", season: "Weihnachten", whyNow: "Nützliche Geschenkideen sind vor Weihnachten besonders relevant.", reelIdea: "Lieferumfang auspacken und eine Anwendung demonstrieren.", targetGroup: "Geschenkekäufer und Hobbyköche", benefitsToVerify: ["Lieferumfang", "Material und Reinigung"] },
  ];
}

export async function scoutProducts() {
  const now = new Date();
  const searchResults = await tavilySearch({ query: "Deutschland aktuelle Produkttrends Haushalt Küche Geschenke saisonale Produkte", timeRange: "month", maxResults: 10 });
  const signal = searchResults[0];
  const trendName = signal?.title?.slice(0, 110) || "Aktuell gefragtes Haushaltsprodukt";
  const trend: Seed = { name: trendName, category: "Aktuelles Suchsignal", kind: "Aktueller Trend", season: "Aktuell", whyNow: signal ? `Aktuelles Suchsignal: ${signal.title}` : "Aktueller Kandidat zur manuellen Prüfung.", reelIdea: "Das konkrete Alltagsproblem und die Anwendung in einer kurzen Vorher-Nachher-Sequenz zeigen.", targetGroup: "Interessierte Käufer in Deutschland", benefitsToVerify: ["Produkteigenschaften auf der Amazon-Seite", "Preis, Verfügbarkeit und Kundenhinweise"] };
  const candidates = [...evergreen, ...seasonalSeeds(now.getUTCMonth() + 1), trend].map((seed, index) => ({ ...seed, searchQuery: seed.name, confidence: index === 4 ? Math.round(Math.min(85, Math.max(35, (signal?.score ?? 0.5) * 100))) : 55 }));
  return { output: { summary: "Tavily hat aktuelle Websignale geliefert. Die Vorschläge wurden ohne kostenpflichtiges Sprachmodell mit einem Saisonkalender und festen Sicherheitsregeln zusammengestellt.", researchedAt: now.toISOString(), candidates }, sources: tavilySources(searchResults) };
}

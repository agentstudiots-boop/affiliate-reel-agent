import type { ContentChance } from "../content/strategy";

// Editorial content chances per scout idea. A chance is a reason to make content, NOT a product fact:
// product data still come from the verified Amazon page. Ideas without an entry have no recorded
// content chance and are rejected by the quality gate for scheduled slots.
const flags = (on: Array<keyof Omit<ContentChance, "type" | "hook" | "concept" | "group">>) => ({
  demonstrable: false, beforeAfter: false, wow: false, fun: false, impulse: false, gift: false, aesthetic: false, broadAppeal: false, seasonalFit: false,
  ...Object.fromEntries(on.map(key => [key, true])),
});
const chance = (type: ContentChance["type"], concept: string, hook: string, on: Parameters<typeof flags>[0], group?: string): ContentChance =>
  ({ type, hook, concept, ...(group ? { group } : {}), ...flags(on) });

export const CONTENT_CHANCES: Record<string, ContentChance> = {
  "Vakuumiergerät für Lebensmittel": chance("problem_solver", "vacuum-portioning", "Vorräte portionieren und luftdicht verpacken: aus losen Beuteln wird ein aufgeräumter Stapel", ["demonstrable", "beforeAfter", "broadAppeal"], "vacuum"),
  "Duschabzieher": chance("problem_solver", "shower-glass-clean", "Verschmierte Glasscheibe vorher, klare Scheibe nachher in wenigen Zügen", ["demonstrable", "beforeAfter", "broadAppeal"], "cleaning_tool"),
  "Kabel Organizer": chance("problem_solver", "cable-order", "Kabelsalat am Schreibtisch vorher, sortierte Kabelführung nachher", ["demonstrable", "beforeAfter", "broadAppeal"], "desk_cable"),
  "Kürbis-Schnitzwerkzeug-Set": chance("social_game", "pumpkin-carving", "Vom glatten Kürbis zur leuchtenden Halloween-Laterne: Familienaktion mit Vorher/Nachher", ["demonstrable", "beforeAfter", "fun", "broadAppeal", "seasonalFit"], "pumpkin_carving"),
  "Halloween LED Kürbis Lichterkette": chance("deco_lifestyle", "halloween-lights", "Dunkle Fensterbank vorher, leuchtende Halloween-Stimmung nachher", ["demonstrable", "beforeAfter", "aesthetic", "broadAppeal", "seasonalFit"], "lights_deco"),
  "LED-Weihnachtsbeleuchtung": chance("deco_lifestyle", "christmas-lights", "Dunkle Ecke vorher, warmer Lichterglanz nachher", ["demonstrable", "beforeAfter", "aesthetic", "broadAppeal", "seasonalFit"], "lights_deco"),
  "Gravierbare Schmuck-Geschenkidee": chance("deco_lifestyle", "personal-gift", "Persönliches Geschenk mit Gesprächswert zum Valentinstag", ["gift", "aesthetic", "impulse", "broadAppeal", "seasonalFit"], "gift_jewelry"),
};

// Additional ideas that were not in the evergreen list: each starts from a concrete content chance.
export const CHANCE_SEEDS: { name: string; category: string; whyNow: string; reelIdea: string; targetGroup: string; benefitsToVerify: string[]; chance: ContentChance }[] = [
  { name: "Fusselrasierer für Kleidung", category: "Haushalt", whyNow: "Strickpullover und Decken kommen mit der kühlen Jahreszeit wieder hervor.", reelIdea: "Verfilzten Stoff vorher zeigen, Fusseln entfernen, glatten Stoff nachher zeigen.", targetGroup: "Haushalte", benefitsToVerify: ["Stromversorgung und Lieferumfang", "geeignete Stoffe laut Hersteller"],
    chance: chance("problem_solver", "lint-removal", "Verfilzter Pullover vorher, glatter Stoff nachher", ["demonstrable", "beforeAfter", "broadAppeal"], "textile_care") },
  { name: "Pizzaschere", category: "Küche", whyNow: "Ungewöhnliches Küchengadget mit Gesprächswert, ganzjährig teilbar.", reelIdea: "Eine Pizza mit der Schere in Stücke schneiden und das Servieren zeigen.", targetGroup: "Hobbyköche und Familien", benefitsToVerify: ["Klingenmaterial", "Reinigung laut Hersteller"],
    chance: chance("fun_impulse", "pizza-scissors", "Pizza mit der Schere statt dem Rollrädchen schneiden: Hingucker am Tisch, den man jemandem zeigen will", ["demonstrable", "fun", "impulse", "broadAppeal"], "kitchen_gadget_fun") },
  { name: "Fleischkrallen Pulled Pork", category: "Grillen", whyNow: "Ungewöhnliches Küchenwerkzeug mit Wow-Faktor für Grill- und Kochfans.", reelIdea: "Gegartes Fleisch mit den Krallen zerpflücken und anrichten.", targetGroup: "Grill- und Kochfans", benefitsToVerify: ["Material", "Hitzebeständigkeit laut Hersteller"],
    chance: chance("fun_impulse", "shredding-claws", "Zerpflücken wie ein Bär: ungewöhnliches Werkzeug, bei dem man „Was ist das denn?“ fragt", ["demonstrable", "wow", "fun", "impulse", "broadAppeal"], "kitchen_gadget_fun") },
  { name: "Mond Lampe 3D", category: "Wohnen", whyNow: "Leuchtende Wohnaccessoires wirken in der dunklen Jahreszeit besonders.", reelIdea: "Den Raum abdunkeln und das Leuchten als Blickfang zeigen.", targetGroup: "Wohn- und Geschenkfans", benefitsToVerify: ["Stromversorgung", "Größe und Lichtmodi laut Hersteller"],
    chance: chance("deco_lifestyle", "moon-lamp", "Leuchtender Mond als Blickfang im abgedunkelten Raum: starker ästhetischer Effekt und Geschenkidee", ["demonstrable", "wow", "aesthetic", "impulse", "gift", "broadAppeal"], "lights_deco") },
  { name: "Sternenhimmel Projektor", category: "Wohnen", whyNow: "Stimmungslicht als Deko- und Geschenkidee, visuell sofort verständlich.", reelIdea: "Zimmer abdunkeln und die Projektion an der Decke zeigen.", targetGroup: "Wohn- und Geschenkfans", benefitsToVerify: ["Stromversorgung", "Projektionsmodi laut Hersteller"],
    chance: chance("deco_lifestyle", "star-projector", "Sternenhimmel an der Zimmerdecke: Wow-Effekt in Sekunden sichtbar", ["demonstrable", "wow", "aesthetic", "impulse", "gift", "broadAppeal"], "lights_deco") },
  { name: "Partyspiel Kartenspiel für Erwachsene", category: "Freizeit", whyNow: "Spielabende und Geschenkideen für Freundeskreis und Familie.", reelIdea: "Eine Spielrunde zeigen: Karten ziehen, Reaktionen der Mitspieler.", targetGroup: "Freunde, Paare und Familien", benefitsToVerify: ["Spieleranzahl und Altersangabe", "Spielprinzip laut Hersteller"],
    chance: chance("social_game", "party-card-game", "Spielrunde mit Freunden, in der die Reaktionen der Mitspieler der Inhalt sind", ["fun", "impulse", "gift", "broadAppeal"], "party_game") },
  { name: "LED Kerzen flackernd", category: "Wohnen", whyNow: "Stimmungslicht ohne offene Flamme, besonders in der dunklen Jahreszeit.", reelIdea: "Einen abgedunkelten Tisch mit den Kerzen als Stimmungsbild zeigen.", targetGroup: "Wohn- und Dekofans", benefitsToVerify: ["Stromversorgung", "Maße und Lieferumfang"],
    chance: chance("deco_lifestyle", "led-candles", "Warmes Kerzenlicht ohne offene Flamme als Stimmungsmacher am gedeckten Tisch", ["demonstrable", "aesthetic", "impulse", "broadAppeal"], "candle_scent") },
];

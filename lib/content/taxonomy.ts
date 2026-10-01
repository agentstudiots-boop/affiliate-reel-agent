// Controlled category taxonomy. A category is a stable technical key (stored in content_jobs.category)
// with a clean German display name. Built-in categories are fixed here; the Trendscout and the
// orchestrator may only choose among them. A new category exists only if the operator names it explicitly.
export type Category = { key: string; label: string; custom?: boolean };
type BuiltIn = Category & { aliases: string[] };

// Keys of the historical enum (general, kitchen, household, home_living, technology, leisure) are kept unchanged.
const BUILT_IN: BuiltIn[] = [
  { key: "general", label: "Allgemein", aliases: ["allgemein", "sonstiges", "sonstige", "diverses", "general"] },
  { key: "household", label: "Haushalt", aliases: ["haushalt", "haushaltshelfer", "household"] },
  { key: "kitchen", label: "Küche", aliases: ["küche", "küchenhelfer", "kitchen"] },
  { key: "cooking_baking", label: "Kochen & Backen", aliases: ["kochen & backen", "backen & kochen", "kochen und backen"] },
  { key: "home_living", label: "Home & Living", aliases: ["home & living", "home and living", "home_living", "wohnen", "wohnen & living", "living"] },
  { key: "decor", label: "Deko", aliases: ["deko", "dekoration", "decor", "decoration"] },
  { key: "technology", label: "Technik", aliases: ["technik", "technologie", "tech", "technology"] },
  { key: "outdoor", label: "Outdoor", aliases: ["outdoor", "draußen"] },
  { key: "leisure", label: "Freizeit", aliases: ["freizeit", "leisure"] },
  { key: "seasonal", label: "Saisonales", aliases: ["saisonales", "saisonal", "saison", "seasonal"] },
];
export const BUILT_IN_CATEGORIES: Category[] = BUILT_IN.map(({ key, label }) => ({ key, label }));
export const FALLBACK_CATEGORY = "general";

const STOP = new Set(["und", "and", "the", "der", "die", "das", "fuer", "kategorie", "bereich"]);
// Canonical, order-independent form: folded umlauts, no punctuation, no filler words.
export function nameTokens(value: string): string[] {
  return value.toLocaleLowerCase("de-DE").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter(token => token && !STOP.has(token)).sort();
}
export const normalizedName = (value: string) => nameTokens(value).join(" ");

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = row[j]; row[j] = next;
    }
  }
  return row[b.length];
}
// A one-letter typo in a longer word is the same category, not a new one.
const sameTokens = (a: string[], b: string[]) => a.length === b.length && a.every((token, i) => token === b[i] || (token.length >= 5 && distance(token, b[i]) <= 1));

export type Registry = Category[];
export const withCustom = (custom: { key: string; label: string }[] = []): Registry =>
  [...BUILT_IN_CATEGORIES, ...custom.map(item => ({ ...item, custom: true }))];

export type Resolution =
  | { kind: "match"; category: Category }
  | { kind: "similar"; category: Category } // overlapping name (e.g. „Backen“ vs „Kochen & Backen“): ask, never guess
  | { kind: "none" };

export function resolveCategory(input: string, registry: Registry = BUILT_IN_CATEGORIES): Resolution {
  const wanted = nameTokens(input);
  if (!wanted.length) return { kind: "none" };
  const aliasesOf = (category: Category) => [category.key, category.label, ...(BUILT_IN.find(item => item.key === category.key)?.aliases ?? [])].map(nameTokens);
  for (const category of registry) if (aliasesOf(category).some(tokens => sameTokens(wanted, tokens))) return { kind: "match", category };
  for (const category of registry) {
    const label = nameTokens(category.label);
    if (label.length > 1 && wanted.every(token => label.includes(token)) || wanted.length > 1 && label.every(token => wanted.includes(token))) return { kind: "similar", category };
  }
  return { kind: "none" };
}

export const labelFor = (key: string, registry: Registry = BUILT_IN_CATEGORIES) =>
  registry.find(category => category.key === key)?.label ?? key.replace(/_/g, " ").replace(/^./, c => c.toLocaleUpperCase("de-DE"));

// New operator-defined name: short, a noun phrase, not a sentence.
export function validNewName(input: string): string | null {
  const name = input.trim().replace(/^[„"“'`]+|[„"“'`.!?]+$/g, "").replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 30 || name.split(" ").length > 3) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &-]*$/u.test(name) || /^\d+$/.test(name)) return null;
  return name.charAt(0).toLocaleUpperCase("de-DE") + name.slice(1);
}
export function keyFor(label: string): string {
  const slug = label.toLocaleLowerCase("de-DE").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/&/g, " und ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 39);
  return /^[a-z]/.test(slug) ? slug : `kat_${slug}`.slice(0, 39);
}

// ---- Automatic assignment (orchestrator): chooses ONLY among built-in categories, never invents one -----------
const fold = (value: string) => value.toLocaleLowerCase("de-DE").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
const PRODUCT_RULES: [string, RegExp][] = [
  ["seasonal", /kuerbis.{0,40}schnitz|schnitz.{0,40}kuerbis|pumpkin.{0,30}carv/],
  ["cooking_baking", /back(?:matte|form|formen|unterlage|blech|papier|ofen|zubehoer)|silikon.{0,20}back|muffin|kuchen|teig|ausroll|\bkoch(?:en|topf)\b|pfanne|\btopf/],
  ["kitchen", /kuechen|reibe|messbecher|messer|schneid|sieb|schneebesen|tortilla|vakuumier|brotdose|vorrat|kaffee|espresso|wasserkocher|toaster|multikocher|heissluft|airfryer|mixer|waage/],
  ["home_living", /kabel.?organizer|kabelhalter/],
  ["technology", /kabel|usb|akku|ladegeraet|bluetooth|saugroboter|staubsauger|ventilator|lautsprecher|kamera|powerbank|smart|elektr/],
  ["decor", /deko|lichterkette|girlande|kranz|kerzenhalter|figur|dekoration/],
  ["home_living", /decke|kissen|lampe|teppich|badematte|vorhang|regal|sofa|schreibtisch|spiegel|kerze|vase|kabel.?organizer/],
  ["outdoor", /garten|grill|camping|wander|outdoor|pflanz|balkon|trinkflasche|rucksack|picknick|fahrrad|zelt/],
  ["household", /wasch|buegel|putz|reinig|aufbewahr|\bbox\b|korb|organizer|ordnung|besen|schwamm|duschabzieher|abzieher|haushalt/],
  ["leisure", /spiel|puzzle|\bbuch\b|hobby|sport|yoga|bastel|malen/],
];
const SCOUT_CATEGORY: Record<string, string> = {
  küche: "kitchen", haushalt: "household", backen: "cooking_baking", wohnen: "home_living", garten: "outdoor", unterwegs: "outdoor",
  bad: "household", geschenke: "seasonal", sommer: "seasonal", grillen: "outdoor", halloween: "seasonal", weihnachten: "seasonal",
};
export function suggestCategory(productName: string, scoutCategory?: string | null, scoutKind?: string | null): string {
  const name = fold(productName);
  for (const [key, pattern] of PRODUCT_RULES) if (pattern.test(name)) return key;
  const mapped = scoutCategory ? SCOUT_CATEGORY[scoutCategory.trim().toLocaleLowerCase("de-DE")] : undefined;
  if (mapped) return mapped;
  return scoutKind === "Saisontrend" ? "seasonal" : FALLBACK_CATEGORY;
}

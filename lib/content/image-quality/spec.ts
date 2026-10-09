import type { ContentJob, ImageSpec } from "../schema";
import { analyzeProductInspiration } from "../product-inspiration";
import { isPumpkinCarvingProduct } from "../category";
import { isBathtubMat } from "../bathtub-mat";

// Structured image briefing: the machine-readable requirements every generated image is held to, from the creative plan
// through the provider prompt to the visual quality gate. Shared by affiliate and topic images.
//
// The starting point is always the concrete article: its title (product type, motif, material, setting), its verified
// facts and the content idea. Nothing is invented: what the title and the verified facts do not state is listed as
// missing information and must not be shown as a product property.

export type { ImageSpec };

// Words that describe packaging, quantity, season or marketing, never the object itself.
const GENERIC = new Set(["deko", "dekoration", "dekorativ", "dekorative", "dekorativer", "set", "stück", "stk", "stck", "herbst", "herbstdeko", "winter", "sommer",
  "frühling", "groß", "große", "großer", "klein", "kleine", "kleiner", "premium", "modern", "moderne", "neu", "neue", "farbe", "farben", "bunt", "bunte", "inkl",
  "inklusive", "für", "mit", "und", "aus", "der", "die", "das", "zum", "zur", "innen", "außen", "outdoor", "indoor", "haus", "home", "geschenk", "geschenkidee",
  "dekofigur", "dekofiguren", "wetterfest", "handgemacht", "handbemalt", "stimmungsvoll", "gemütlich", "tisch", "tischdeko", "wohnzimmer", "zimmer", "garten"]);

// A conservative stem so that "Pilze", "Pilz" and "Pilzdeko" share "pilz", "Kürbisse" and "Kürbis" share "kürbis".
export function stem(word: string): string {
  const value = word.toLocaleLowerCase("de-DE").normalize("NFC");
  return value.length >= 5 ? value.replace(/(?:en|se|e|n|s)$/u, "") : value;
}

// Does the text mention one of the terms (by stem)?
export function mentions(text: string, terms: string[]): boolean {
  const lower = text.toLocaleLowerCase("de-DE");
  return terms.some(term => lower.includes(stem(term)));
}

export function significantWords(text: string): string[] {
  return [...new Set((text.match(/[\p{L}]{4,}/gu) ?? []).map(word => word.toLocaleLowerCase("de-DE")).filter(word => !GENERIC.has(word)))];
}

// Product type (what the article is) — decides shape, use and what must be visible.
const TYPES: { pattern: RegExp; type: string; term: string; composition: string; missing?: string[] }[] = [
  { pattern: /lampe|leuchte|nachtlicht|lichterkette|led[- ]?licht/i, type: "Leuchte", term: "leuchte", composition: "Leuchte als Hauptmotiv im Vordergrund, leicht gedämpftes Umgebungslicht, damit Form und Leuchtwirkung erkennbar sind", missing: ["Lichtfarbe und Helligkeit nicht belegt"] },
  { pattern: /kerze/i, type: "Kerze", term: "kerze", composition: "Kerze groß im Vordergrund" },
  { pattern: /figur|statue|skulptur|aufsteller/i, type: "Dekofigur", term: "figur", composition: "Figur groß und scharf im Vordergrund, Umgebung unscharf" },
  { pattern: /gartenstecker|stecker|beetstecker/i, type: "Gartenstecker", term: "stecker", composition: "Stecker im Beet oder Blumentopf groß im Vordergrund" },
  { pattern: /girlande|kranz/i, type: "Girlande/Kranz", term: "kranz", composition: "Girlande bzw. Kranz bildfüllend im Vordergrund" },
  { pattern: /kissen|kissenbezug/i, type: "Kissen", term: "kissen", composition: "Kissen groß im Vordergrund auf Sofa oder Sessel" },
  { pattern: /vase|übertopf|blumentopf/i, type: "Gefäß", term: "vase", composition: "Gefäß groß im Vordergrund" },
];
const MATERIALS = ["keramik", "porzellan", "holz", "metall", "glas", "polyresin", "kunstharz", "harz", "filz", "stoff", "beton", "terrakotta", "ton", "rattan", "kunststoff"];
const OUTDOOR = /garten|gartendeko|beet|balkon|terrasse|außenbereich|outdoor|wetterfest/i;

// A model or brand article ("Roborock Qrevo Edge 2", "Philips Hue Go"): a generated picture can never be confirmed as
// that exact product. A no-name generic article ("Deko Pilze 6 Stück") is a generic product depiction.
export function identityClassOf(name: string): ImageSpec["identity_class"] {
  const tokens = name.split(/\s+/);
  const modelToken = tokens.some(token => /^(?=[\p{L}-]*\d)(?=\d*[\p{L}])[\p{L}\d-]{2,}$/u.test(token) && !/^\d+(?:er|x|cm|mm|ml|l|m|teilig|stück|stk|pcs|w|v|led)$/i.test(token));
  const UNIT = /^(?:stück|stk|stck|teilig|tlg|cm|mm|m|l|ml|x|er|pcs|w|v|led|set|packung|pack)$/i;
  const numberedModel = [...name.matchAll(/([\p{Lu}][\p{Ll}]+)\s+(\d{1,3})(?![\p{L}\d.,])(?:\s+([\p{L}]+))?/gu)].some(match => !match[3] || !UNIT.test(match[3]));
  return modelToken || numberedModel ? "brand_article" : "generic_product";
}

type Primary = Pick<ImageSpec, "primary_object" | "primary_object_terms" | "required_objects" | "forbidden_objects" | "composition" | "product_type" | "product_attributes" | "setting" | "missing_information">;

const KNOWN: { test: (name: string) => boolean; value: Omit<Primary, "product_attributes" | "setting" | "missing_information"> }[] = [
  { test: isPumpkinCarvingProduct, value: { product_type: "Kürbisschnitzwerkzeug", primary_object: "großer orangefarbener Halloween-Kürbis, der gerade mit einem kleinen Schnitzwerkzeug geschnitzt wird",
    primary_object_terms: ["kürbis"], required_objects: ["schnitzwerkzeug"], forbidden_objects: ["gabel", "kind", "kinder", "backwaren", "küchenmesser"], composition: "Kürbis und Schnitzhandlung groß im Vordergrund" } },
  { test: isBathtubMat, value: { product_type: "Badewannenmatte", primary_object: "Badewannenmatte in einer leeren Badewanne", primary_object_terms: ["badewannenmatte", "matte"], required_objects: [], forbidden_objects: [], composition: "Matte in der Badewanne gut sichtbar im Vordergrund" } },
  { test: name => /heizdecke|wärmedecke|elektrische decke/i.test(name), value: { product_type: "Heizdecke", primary_object: "Heizdecke", primary_object_terms: ["decke"], required_objects: [], forbidden_objects: [], composition: "Decke groß im Vordergrund" } },
  { test: name => /kuscheldecke|wohndecke|fleecedecke/i.test(name), value: { product_type: "Kuscheldecke", primary_object: "Kuscheldecke", primary_object_terms: ["decke"], required_objects: [], forbidden_objects: [], composition: "Decke groß im Vordergrund auf dem Sofa" } },
  { test: name => /vakuumier|vakuum.?versiegl/i.test(name), value: { product_type: "Vakuumierer", primary_object: "Vakuumiergerät beim Verschließen eines Beutels", primary_object_terms: ["vakuumier"], required_objects: [], forbidden_objects: [], composition: "Gerät und Beutel groß im Vordergrund" } },
  { test: name => /saugroboter|robot.?vacuum/i.test(name), value: { product_type: "Saugroboter", primary_object: "Saugroboter auf dem Boden", primary_object_terms: ["saugroboter"], required_objects: [], forbidden_objects: [], composition: "Saugroboter groß im Vordergrund auf dem Boden" } },
  { test: name => /tortilla.{0,25}presse|fladenbrotpresse/i.test(name), value: { product_type: "Tortillapresse", primary_object: "Tortillapresse mit Teigkugel", primary_object_terms: ["tortillapresse", "presse"], required_objects: [], forbidden_objects: [], composition: "Presse und Teig groß im Vordergrund" } },
];

const capital = (word: string) => word.replace(/^./, char => char.toLocaleUpperCase("de-DE"));

// The concrete article decides the briefing: a "Pilzlampe aus Holz" is a lamp in mushroom form, a "Keramik Pilz" a ceramic
// figure, a "Pilz Gartenstecker" a garden decoration outdoors.
export function productBriefing(job: ContentJob): Primary {
  const name = job.opportunity.product.name;
  const lower = name.toLocaleLowerCase("de-DE");
  const verified = job.opportunity.verifiedFacts.map(fact => fact.claim);
  const material = MATERIALS.find(item => lower.includes(item));
  const outdoor = OUTDOOR.test(name);
  const setting = outdoor ? "draußen im Garten, im Beet oder auf der Terrasse" : job.opportunity.useCase.slice(0, 200);
  const attributes = [...new Set([material ? `Material laut Titel: ${capital(material)}` : "", ...verified.map(claim => `Beleg: ${claim}`)].filter(Boolean))].slice(0, 8);
  const missing = ["Größe nicht belegt", "Farbe nicht belegt"].filter(item => !verified.some(claim => new RegExp(item.split(" ")[0], "i").test(claim)));
  const known = KNOWN.find(entry => entry.test(name));
  if (known) return { ...known.value, product_attributes: attributes, setting, missing_information: missing };
  const label = analyzeProductInspiration(job.opportunity).categoryLabel;
  const type = TYPES.find(entry => entry.pattern.test(name));
  const motifWords = significantWords(name).filter(word => !/\d/.test(word) && !MATERIALS.includes(word) && !(type && type.pattern.test(word)) && !OUTDOOR.test(word));
  // The motif of a compound like "Pilzlampe" is its first part ("pilz").
  const compoundMotif = type ? (lower.match(new RegExp(`([\\p{L}]{3,})(?:${type.pattern.source})`, "iu"))?.[1] ?? null) : null;
  const motif = (compoundMotif && !GENERIC.has(compoundMotif) ? compoundMotif : motifWords[0]) ?? significantWords(label)[0] ?? label.toLocaleLowerCase("de-DE");
  const decoration = /deko|dekoration|figur|ornament/i.test(`${label} ${name}`);
  const typeName = type?.type ?? (decoration ? "Dekoration" : capital(significantWords(label)[0] ?? label));
  const primary = type ? `${capital(motif)}-${type.type}${material ? ` aus ${capital(material)}` : ""}`
    : decoration ? `dekorative ${capital(motif)}${material ? ` aus ${capital(material)}` : ""} (Dekoration${outdoor ? " für den Garten" : ""})`
      : `${capital(motif)}${material ? ` aus ${capital(material)}` : ""}`;
  const terms = [...new Set([motif, ...(type ? [type.term] : [])])].map(term => term.slice(0, 60));
  return { product_type: typeName, primary_object: primary.slice(0, 160), primary_object_terms: terms, required_objects: [], forbidden_objects: [],
    composition: (type?.composition ?? `${primary} groß und scharf im Vordergrund, als klar erkennbares Hauptmotiv`).slice(0, 240),
    product_attributes: attributes, setting, missing_information: [...missing, ...(type?.missing ?? [])].slice(0, 6) };
}

// "Entferne den Hund", "ohne Hund", "keine Katze im Bild", "der Hund soll weg" → forbidden "hund"/"katze".
export function removedObjects(instruction: string): string[] {
  const found = new Set<string>();
  const patterns = [/\b(?:entfern\w*|lösch\w*|streich\w*|weg\s+mit|raus\s+mit)\s+(?:bitte\s+)?(?:den|die|das|dem|alle|jeden|jede)?\s*([\p{L}-]{3,})/giu,
    /\b(?:ohne|kein|keine|keinen|keinem)\s+([\p{L}-]{3,})/giu, /\b(?:den|die|das)\s+([\p{L}-]{3,})\s+(?:soll|muss|bitte)\s+(?:weg|raus)/giu];
  for (const pattern of patterns) for (const match of instruction.matchAll(pattern)) {
    const word = match[1].toLocaleLowerCase("de-DE");
    if (!["bitte", "mehr", "weniger", "text", "schrift", "logo", "logos", "änderung", "problem"].includes(word)) found.add(word);
  }
  return [...found];
}

// The structured briefing of an image job: the stored one (kept across operator revisions) or one derived from the article.
export function imageSpecFor(job: ContentJob, extraChanges: string[] = [], lessons: { guidance: string[]; forbidden: string[]; dominant: boolean } | null = null): ImageSpec {
  if (job.content?.format !== "image") throw new Error("Bildbriefing fehlt.");
  const stored = job.content.imageSpec;
  const base: ImageSpec = stored ?? (() => {
    const product = productBriefing(job);
    const inspiration = analyzeProductInspiration(job.opportunity);
    return {
      content_type: "affiliate_image", subject: job.opportunity.product.name.slice(0, 160), ...product,
      primary_object_required: true, primary_object_prominence: "dominant",
      style: "hochwertige, fotorealistische Lifestyle-Fotografie mit natürlichem Licht", aspect_ratio: "4:5", platforms: ["facebook", "instagram"],
      commercial_intent: `${product.product_type}: Anwendung und Nutzen im Alltag klar erkennbar`.slice(0, 240),
      product_reference_required: inspiration.representation === "verified_product_context", representation: inspiration.representation,
      edit_mode: "regenerate", change_instructions: [], identity_class: identityClassOf(job.opportunity.product.name), learned_guidance: [],
    } satisfies ImageSpec;
  })();
  const withLessons = lessons ? applyLessons(base, lessons) : base;
  return extraChanges.reduce((spec, change) => withChange(spec, change), withLessons);
}

// Experience only adds guidance and exclusions; the product-specific requirements (primary object, product type) stay.
export function applyLessons(spec: ImageSpec, lessons: { guidance: string[]; forbidden: string[]; dominant: boolean }): ImageSpec {
  const forbidden = lessons.forbidden.filter(word => !mentions(word, spec.primary_object_terms) && !spec.primary_object_terms.some(term => mentions(term, [word])));
  return { ...spec, primary_object_prominence: lessons.dominant ? "dominant" : spec.primary_object_prominence,
    forbidden_objects: [...new Set([...spec.forbidden_objects, ...forbidden])].slice(0, 12),
    learned_guidance: [...new Set([...spec.learned_guidance, ...lessons.guidance])].slice(0, 4) };
}

// An operator change keeps every unchanged requirement: the primary object always stays; removals become forbidden objects.
export function withChange(spec: ImageSpec, change: string): ImageSpec {
  const text = change.trim().slice(0, 300);
  if (!text) return spec;
  const removed = removedObjects(text).filter(word => !mentions(word, spec.primary_object_terms));
  return { ...spec, forbidden_objects: [...new Set([...spec.forbidden_objects, ...removed])].slice(0, 12),
    change_instructions: [...spec.change_instructions, text].slice(-6) };
}

// Briefing validation before any prompt is built: contradictions here can never be fixed by generating again.
export function imageSpecErrors(spec: ImageSpec): string[] {
  const errors: string[] = [];
  if (!spec.primary_object.trim() || !spec.primary_object_terms.length) errors.push("Hauptmotiv fehlt im Briefing.");
  if (spec.forbidden_objects.some(word => mentions(word, spec.primary_object_terms) || spec.primary_object_terms.some(term => mentions(term, [word]))))
    errors.push("Briefing widersprüchlich: das Hauptmotiv ist zugleich ausgeschlossen.");
  if (spec.aspect_ratio !== "4:5") errors.push("Bildformat ist nicht 4:5.");
  return errors;
}

// Topic images: the motif of the topic copy is the primary object (symbolic illustration, no product identity).
export function topicImageSpec(input: { motif: string; title: string; platforms?: ImageSpec["platforms"] }): ImageSpec {
  const words = significantWords(input.motif).slice(0, 3);
  return { content_type: "topic_image", subject: input.title.slice(0, 160), primary_object: input.motif.slice(0, 160), primary_object_terms: words.length ? words : [input.motif.slice(0, 60)],
    primary_object_required: true, primary_object_prominence: "visible", required_objects: [], forbidden_objects: [], composition: "Motiv klar erkennbar und bildbestimmend",
    style: "redaktionelles Bild, natürliches Licht", aspect_ratio: "4:5", platforms: input.platforms ?? ["instagram", "facebook"],
    commercial_intent: "Thema auf einen Blick verständlich", product_reference_required: false, representation: "symbolic", edit_mode: "regenerate", change_instructions: [],
    product_type: "", product_attributes: [], setting: "", missing_information: [], identity_class: "symbolic", learned_guidance: [] };
}

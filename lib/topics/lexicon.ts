// Deterministic German keyword lexicons for classification and scoring. Every score factor names the
// matched words, so a decision can always be traced back to the source text.

export const fold = (value: string) => value.toLocaleLowerCase("de-DE").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFKD").replace(/\p{M}/gu, "");

const STOP = new Set(["und", "oder", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines", "einem", "einen", "mit", "fuer", "von", "vom", "zum", "zur",
  "auf", "aus", "bei", "nach", "ueber", "unter", "vor", "wie", "was", "wer", "wird", "werden", "ist", "sind", "war", "hat", "haben", "nicht", "auch", "noch", "nur", "jetzt",
  "heute", "neue", "neuer", "neues", "neu", "alle", "mehr", "sich", "sie", "ihr", "ihre", "sein", "seine", "dass", "als", "bis", "kann", "will", "soll", "the", "and", "for",
  "news", "aktuell", "live", "ticker", "video", "bilder", "foto", "fotos", "so", "am", "musst", "welche", "welcher", "welches", "ende", "anfang", "mal", "wieder", "jahr", "jahre", "jahren", "im", "in", "an", "zu", "es", "er", "man", "um", "gibt", "diese", "dieser", "dieses"]);

export function tokens(value: string): string[] {
  return fold(value).split(/[^a-z0-9]+/).filter(token => token.length >= 3 && !STOP.has(token) && !/^\d+$/.test(token));
}

export function jaccard(a: Iterable<string>, b: Iterable<string>) {
  const x = new Set(a), y = new Set(b);
  if (!x.size || !y.size) return 0;
  const shared = [...x].filter(token => y.has(token)).length;
  return shared / new Set([...x, ...y]).size;
}
export function sharedCount(a: Iterable<string>, b: Iterable<string>) { const y = new Set(b); return [...new Set(a)].filter(token => y.has(token)).length; }

type Lexicon = { name: string; words: string[] };
const lex = (name: string, words: string): Lexicon => ({ name, words: words.split("|").map(word => fold(word.trim())).filter(Boolean) });

export const LEXICONS = {
  entertainment: lex("Entertainment", "film|kino|serie|staffel|netflix|prime video|disney|streaming|trailer|premiere|tatort|schauspieler|schauspielerin|album|konzert|tournee|song|eurovision|oscar|bambi|dschungelcamp|bachelor|gntm|castingshow|fernsehshow|folge|finale|sitcom|blockbuster|kinostart|musikvideo|rapper|saengerin|saenger"),
  gossip: lex("Promi-Klatsch", "promi|liebes-aus|ehe-aus|trennung|affaere|schwanger|baby-news|scheidung|flirt|nackt|enthuellt|skandal|zoff|rosenkrieg|liebescomeback|knutsch|beziehungsstatus|fremdgehen"),
  curiosity: lex("Kurioses", "kurios|skurril|ungewoehnlich|weltrekord|rekord|wusstest du|ueberraschend|verrueckt|seltsam|erstaunlich|raetsel|merkwuerdig|lustig|witzig"),
  practical: lex("Alltagsnutzen", "tipp|tipps|so geht|anleitung|trick|haushalt|putzen|reinigen|reinigung|ordnung|aufraeumen|lueften|heizen|heizkosten|sparen|kueche|kochen|backen|rezept|waesche|kalk|schimmel|energie|strom|lebensmittel|garten|balkon|vorrat|stauraum|organisieren|feucht|kondenswasser|fenster|kuehlschrank|backofen|verbraucher|alltag|familie|zeitumstellung|uhr|vorbereiten|planen|reste"),
  product: lex("Produktbezug", "gadget|geraet|kuechengeraet|staubsauger|airfryer|heissluftfritteuse|thermomix|lampe|aufbewahrung|organizer|dose|matte|buerste|deko|kerze|lichterkette|laterne|decke|thermoskanne|trinkflasche|regal|korb|haken|kabel|wasserkocher|mikrowelle|wecker|heizdecke|waermflasche|luftentfeuchter|kuerbis|geschenk"),
  weather: lex("Wetter/Jahreszeit", "wetter|unwetter|sturm|frost|schnee|glaette|hitze|hitzewelle|regen|herbst|winter|sommer|fruehling|zeitumstellung|ferien|feiertag|kaelte|nebel|laub|dunkel"),
  event: lex("Ereignis", "festival|messe|oktoberfest|weihnachtsmarkt|black friday|prime day|bundesliga|weltmeisterschaft|europameisterschaft|olympia|marathon|ausstellung|jahrestag|feiertag|halloween|advent|ostern|silvester|muttertag|valentinstag"),
  social: lex("Social Hype", "viral|tiktok|hype|challenge|instagram|influencer|meme|trend|alle reden|netz lacht|internet"),
  highRisk: lex("hohes Risiko", "tot|tod|toedlich|gestorben|stirbt|verstorben|leiche|mord|getoetet|anschlag|terror|krieg|angriff|explosion|schiesserei|messerangriff|vergewaltig|missbrauch|suizid|selbstmord|geisel|amok|bombe|rakete|partei|afd|cdu|csu|spd|gruene|fdp|linke|bsw|wahlkampf|bundestagswahl|kanzler|migration|fluechtling|abschiebung|israel|gaza|ukraine|russland|putin|trump|nahost"),
  mediumRisk: lex("erhöhtes Risiko", "unfall|verletzt|opfer|prozess|anklage|urteil|gericht|verhaftet|festnahme|polizei|ermittlung|krankheit|krebs|virus|pandemie|impf|insolvenz|entlassung|streik|rueckruf|warnung|gesundheit|diaet|abnehmen|medikament|klage|betrug|drogen|religion|regierung|minister|bundestag|wahl"),
  emotional: lex("Emotion", "liebe|herz|ruehrend|emotional|freude|glueck|wut|aerger|angst|nervt|endlich|familie|kinder|haustier|hund|katze|nostalgie|gemuetlich|stress|entspannt|ueberraschung"),
  visual: lex("Visuell", "vorher|nachher|deko|rezept|kochen|backen|garten|balkon|farben|licht|kuerbis|laterne|laub|schnee|einrichtung|ordnung|aufraeumen|basteln|outfit|kueche|gemuetlich|beleuchtung|kerze|herbst|adventskranz"),
  process: lex("Ablauf zeigbar", "so geht|anleitung|schritt|trick|tipp|in sekunden|minuten|rezept|basteln|umraeumen|reinigen|putzen|vorbereiten|organisieren|lueften|packen|verarbeiten|ordnen"),
  interaction: lex("Interaktion", "welche|warum|wie|was|eure|euer|tipps|liste|fehler|meinung|lieblings|oder|frage"),
  sensational: lex("Sensationssprache", "schock|unfassbar|irre|wahnsinn|skandal|eklat|drama|krass|hammer|sensation|bombe|horror|albtraum"),
};
export type LexiconName = keyof typeof LEXICONS;

// Whole-word or phrase match on folded text. Returns the matched words (deduplicated).
export function hits(text: string, name: LexiconName): string[] {
  const folded = ` ${fold(text).replace(/[^a-z0-9-]+/g, " ")} `;
  return [...new Set(LEXICONS[name].words.filter(word => {
    const pattern = word.replace(/[-]/g, "[- ]?");
    // Short words must stand alone ("tot" must not match "totale"); longer stems may be prefixes ("reinig" in "reinigen").
    return word.length <= 4 ? new RegExp(` ${pattern} `).test(folded) : new RegExp(` ${pattern}`).test(folded);
  }))];
}

// Product category hint (controlled taxonomy keys from lib/content/taxonomy.ts). A hint, never a product choice.
const CATEGORY_HINTS: [string, RegExp][] = [
  ["cooking_baking", /\b(rezept|backen|kochen|kuerbis|reste|ernte)/],
  ["kitchen", /\b(kueche|kuehlschrank|backofen|mikrowelle|wasserkocher|lebensmittel|brotdose|fruchtfliege)/],
  ["household", /\b(putzen|reinig|kalk|waesche|lueft|heiz|feucht|kondens|schimmel|haushalt|laub|fenster)/],
  ["decor", /\b(deko|laterne|halloween|advent|kerze|lichterkette|beleuchtung|gemuetlich)/],
  ["outdoor", /\b(garten|balkon|draussen|grill|ausflug)/],
  ["technology", /\b(kabel|technik|gadget|uhr|zeitumstellung|smartphone|laden)/],
  ["home_living", /\b(ordnung|stauraum|aufbewahr|organis|kleiderschrank|wohnung|aufraeum)/],
  ["leisure", /\b(spiel|party|geschenk|reise|koffer|silvester|valentinstag|muttertag|nikolaus|weihnacht)/],
];
export function categoryHint(text: string): string | null {
  const folded = fold(text);
  return CATEGORY_HINTS.find(([, pattern]) => pattern.test(folded))?.[0] ?? null;
}

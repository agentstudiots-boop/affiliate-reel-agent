import { CAROUSEL_MAX_SLIDES, CAROUSEL_MIN_SLIDES, type ContentFormat } from "./catalog";

// Deterministic parser for the operator's free-text format and style wishes ("Mach daraus ein Karussell.",
// "Nur vier Slides.", "Kein Avatar.", "Das ist zu teuer, nimm ein Bild."). It only extracts wishes; it decides
// nothing. The format router applies them with the highest priority.

export type ToneWish = "less_promotional" | "more_humor" | "more_serious" | "shorter";
export type FormatOverride = {
  format: ContentFormat | null;
  slides: number | null;
  exclude: ContentFormat[];
  noProduct: boolean;
  tone: ToneWish[];
  newHook: boolean;
  newTopic: boolean;
  cheaper: boolean;
  matched: string[];
};

export const emptyOverride = (): FormatOverride => ({ format: null, slides: null, exclude: [], noProduct: false, tone: [], newHook: false, newTopic: false, cheaper: false, matched: [] });

const NUMBERS: Record<string, number> = { drei: 3, vier: 4, "fünf": 5, fuenf: 5, sechs: 6, sieben: 7, zwei: 2, acht: 8, neun: 9, zehn: 10 };
const lower = (text: string) => text.toLocaleLowerCase("de-DE");

export function parseFormatInstruction(text: string): FormatOverride {
  const t = lower(text);
  const out = emptyOverride();
  const hit = (label: string) => out.matched.push(label);
  // Negations first: "kein Avatar", "ohne Video", "kein Karussell".
  if (/\b(kein(en)?|ohne|nicht als)\s+(avatar|heygen)/.test(t)) { out.exclude.push("AVATAR_VIDEO"); hit("kein Avatar"); }
  if (/\b(kein(en)?|ohne|nicht als)\s+video/.test(t)) { out.exclude.push("STANDARD_VIDEO", "AVATAR_VIDEO"); hit("kein Video"); }
  if (/\b(kein(en)?|ohne|nicht als)\s+(karussell|carousel|slides)/.test(t)) { out.exclude.push("CAROUSEL"); hit("kein Karussell"); }
  if (/\b(kein(en)?|ohne|nicht als)\s+bild/.test(t)) { out.exclude.push("SINGLE_IMAGE"); hit("kein Bild"); }
  const negated = (pattern: RegExp) => new RegExp(`(kein(en)?|ohne|nicht als)\\s+${pattern.source}`).test(t);
  // Positive format wishes; the most specific one wins.
  if (/heygen|avatar/.test(t) && !negated(/(avatar|heygen)/)) { out.format = "AVATAR_VIDEO"; hit("Avatar-Video"); }
  else if (/\b(video|reel|clip)\b/.test(t) && !negated(/video/)) { out.format = "STANDARD_VIDEO"; hit("Video"); }
  else if (/karussell|carousel|slides?\b|folien/.test(t) && !negated(/(karussell|carousel|slides)/)) { out.format = "CAROUSEL"; hit("Karussell"); }
  else if (/\b(nur|ein|einzel)\s*-?\s*bild\b|\bnimm ein bild\b|\blieber (ein )?bild\b/.test(t) && !negated(/bild/)) { out.format = "SINGLE_IMAGE"; hit("Bild"); }
  else if (/\bnur text\b|\bals text\b|\bnur (ein )?(post|beitrag) ohne bild\b/.test(t)) { out.format = "TEXT"; hit("Text"); }
  const count = t.match(/\b(\d{1,2}|drei|vier|fünf|fuenf|sechs|sieben|zwei|acht|neun|zehn)\s+(slides?|folien|seiten|bilder im karussell)/);
  if (count) {
    const raw = /^\d+$/.test(count[1]) ? Number(count[1]) : NUMBERS[count[1]];
    out.slides = Math.max(CAROUSEL_MIN_SLIDES, Math.min(CAROUSEL_MAX_SLIDES, raw));
    if (!out.format) out.format = "CAROUSEL";
    hit(`${out.slides} Slides`);
  }
  if (/zu teuer|günstiger|guenstiger|billiger|weniger kosten|spar(en|sam)/.test(t)) { out.cheaper = true; hit("günstiger"); }
  if (/ohne produkt|kein produkt|ohne affiliate|ohne link/.test(t)) { out.noProduct = true; hit("ohne Produkt"); }
  if (/weniger werblich|nicht so werblich|weniger verkäuferisch|zu werblich/.test(t)) { out.tone.push("less_promotional"); hit("weniger werblich"); }
  if (/mehr humor|lustiger|witziger/.test(t)) { out.tone.push("more_humor"); hit("mehr Humor"); }
  if (/seriöser|serioeser|sachlicher|ernster/.test(t)) { out.tone.push("more_serious"); hit("sachlicher"); }
  if (/kürzer|kuerzer|knapper/.test(t)) { out.tone.push("shorter"); hit("kürzer"); }
  if (/anderer? (aufhänger|aufhaenger|hook|einstieg)|neuer? (aufhänger|aufhaenger|hook)/.test(t)) { out.newHook = true; hit("anderer Aufhänger"); }
  if (/neues thema|anderes thema|anderes topic/.test(t)) { out.newTopic = true; hit("neues Thema"); }
  if (out.format && out.exclude.includes(out.format)) out.format = null;
  out.exclude = [...new Set(out.exclude)];
  return out;
}

// Later instructions refine earlier ones (each WhatsApp correction adds to the previous wishes).
export function mergeOverrides(base: FormatOverride, next: FormatOverride): FormatOverride {
  const format = next.format ?? (next.exclude.includes(base.format as ContentFormat) ? null : base.format);
  return { format, slides: next.slides ?? base.slides, exclude: [...new Set([...base.exclude, ...next.exclude])].filter(item => item !== next.format),
    noProduct: base.noProduct || next.noProduct, tone: [...new Set([...base.tone, ...next.tone])], newHook: next.newHook, newTopic: next.newTopic,
    cheaper: base.cheaper || next.cheaper, matched: [...base.matched, ...next.matched] };
}

export const hasOverride = (override: FormatOverride) => override.matched.length > 0;

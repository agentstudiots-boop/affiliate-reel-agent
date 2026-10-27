import type { TrendType } from "./schema";

// Editorial patterns for topic posts (P1b, operator order 23.10.): everyday storytelling, aha moments, humour, emotion and
// helpful hacks instead of one neutral „Problem → Schritte“ template. A pattern only shapes HOW a topic is told; it never
// adds facts. Reference mode uses short rule templates (no invented tips, numbers or results); AI mode passes the
// pattern's guidance to the one bounded model call, whose output is checked for unsupported claims as before.
// Own switch TOPIC_EDITORIAL_STYLE=on (default off; without it the texts are exactly the previous ones).

export const EDITORIAL_PATTERNS = ["story", "aha", "humor", "emotion", "hack"] as const;
export type EditorialPattern = (typeof EDITORIAL_PATTERNS)[number];

export const EDITORIAL_LABEL: Record<EditorialPattern, string> = {
  story: "Mini-Geschichte", aha: "Aha-Moment", humor: "Humor", emotion: "Gefühl", hack: "Alltagskniff",
};

export const editorialStyleEnabled = (env: Record<string, string | undefined> = process.env) => env.TOPIC_EDITORIAL_STYLE === "on";

// Which patterns suit which kind of topic. Humour, hacks and emotion never on sensitive topics (an implied relief would be an
// effect claim; Gossip excludes humour and hacks too); an aha moment needs an attributed source (a news signal), because
// without one there is nothing surprising we could truthfully say. Story and hack promise content the rule template cannot
// deliver (a scene, a concrete handgrip), so they are only chosen when the copy is written by the model (TOPIC_COPY_MODE=ai).
const BY_TYPE: Record<TrendType, EditorialPattern[]> = {
  PRACTICAL_LIFE: ["hack", "story", "humor", "emotion"],
  EVERGREEN: ["hack", "humor", "story", "emotion"],
  SEASONAL: ["emotion", "story", "hack", "humor"],
  EVENT: ["story", "emotion", "hack"],
  PRODUCT_ADJACENT: ["story", "hack"],
  CURIOSITY: ["aha", "humor", "story"],
  ENTERTAINMENT: ["humor", "story"],
  SOCIAL_HYPE: ["aha", "humor", "story"],
  SEARCH_TREND: ["aha", "story"],
  BREAKING_NEWS: ["aha", "story"],
};

export type PatternContext = { type: TrendType; topicId: string; variant: number; sensitive: boolean; gossip: boolean; hasNewsSource: boolean; aiCopy: boolean };

export function allowedPatterns(context: Omit<PatternContext, "topicId" | "variant">): EditorialPattern[] {
  return BY_TYPE[context.type].filter(pattern =>
    !(pattern === "aha" && !context.hasNewsSource) &&
    !((pattern === "humor" || pattern === "hack") && (context.sensitive || context.gossip)) &&
    !(pattern === "emotion" && context.sensitive) &&
    !((pattern === "story" || pattern === "hack") && !context.aiCopy));
}

// Deterministic per topic (same topic → same pattern, so a revision keeps its voice); a new variant moves to the next
// suitable pattern. Different topics spread over the patterns instead of always starting with the first.
export function choosePattern(context: PatternContext): EditorialPattern | null {
  const allowed = allowedPatterns(context);
  if (!allowed.length) return null;
  const seed = Number.parseInt(context.topicId.replace(/^tp_/, "").slice(0, 8), 16) || 0;
  return allowed[(seed + context.variant) % allowed.length];
}

// Rule templates (reference mode). Only the topic title and, for „aha“, the attributed publisher are used.
export function patternTexts(pattern: EditorialPattern, short: string, publisher: string | null, variant: number): { hook: string; angle: string } {
  const pick = <T,>(options: T[]) => options[variant % options.length];
  switch (pattern) {
    case "story":
      return { hook: pick([`Kennst du diesen Moment? ${short} im ganz normalen Alltag`, `${short}: eine kleine Geschichte aus dem Alltag`]),
        angle: "Mini-Geschichte: Alltagsszene → kleiner Wendepunkt → was im Alltag hilft" };
    case "aha":
      return { hook: publisher ? pick([`Laut ${publisher}: ${short} – und was das im Alltag heißt`, `Hättest du's gewusst? ${short} (laut ${publisher})`])
        : `${short} – und was das im Alltag heißt`,
        angle: "Aha-Moment: belegte Meldung mit Quelle → überraschende Einordnung → Bezug zum eigenen Alltag" };
    case "humor":
      return { hook: pick([`${short} – ganz ehrlich: Wer kennt's nicht?`, `Wir müssen über ${short} reden – mit einem Augenzwinkern`]),
        angle: "Mit Augenzwinkern: typischer Alltagsmoment zum Wiedererkennen → ernst gemeinter, einfacher Schritt" };
    case "emotion":
      return { hook: pick([`${short}: dieses gute Gefühl, wenn es einfach klappt`, `Weniger Stress bei ${short} – so fühlt sich Alltag leichter an`]),
        angle: "Gefühl benennen (Stress → Erleichterung) → ein machbarer Schritt" };
    case "hack":
      return { hook: pick([`${short}: ein kleiner Alltagskniff zum Ausprobieren`, `${short}: ein Handgriff, den du heute noch ausprobieren kannst`]),
        angle: "Alltagskniff: ein einfacher Handgriff mit Dingen, die man zuhause hat – zum Ausprobieren, ohne Versprechen" };
  }
}

// Guidance for the AI copy (one model call). Same no-invention rules as the base instruction; the pattern only sets voice
// and structure.
export const PATTERN_GUIDANCE: Record<EditorialPattern, string> = {
  story: "Erzählweise Mini-Geschichte: Beginne mit einer konkreten, alltäglichen Szene in der Du-Form (ohne erfundene Personen oder Erlebnisse als Tatsachen), "
    + "baue einen kleinen Wendepunkt ein und löse ihn mit einer nachvollziehbaren Handlung auf.",
  aha: "Erzählweise Aha-Moment: Stelle die Information aus einem gelieferten Quellentitel an den Anfang, immer mit Nennung des Publishers, "
    + "und erkläre dann, was sie im Alltag bedeutet. Nur was wörtlich im Quellentitel steht; keine Zahlen, Details oder Hintergründe, die dort nicht stehen.",
  humor: "Erzählweise Humor: leichter, selbstironischer Ton über die Alltagssituation, die viele kennen; nie über Personen, Gruppen oder Missgeschicke anderer. "
    + "Nach dem Schmunzeln folgt ein ernst gemeinter, einfacher Schritt.",
  emotion: "Erzählweise Gefühl: Benenne das Gefühl der Situation (z. B. Stress, Zeitdruck, Erleichterung, Gemütlichkeit) ehrlich und ohne Angstmache, "
    + "und zeige einen machbaren Schritt hin zu mehr Leichtigkeit.",
  hack: "Erzählweise Alltagskniff: Nur ein Handgriff, der sich direkt aus Thema und Kernaussage ergibt und den jeder ohne Spezialwissen nachvollziehen kann. "
    + "Keine Reinigungs- oder Chemikalienmischungen, nichts mit Strom, Gas, offener Flamme, Lebensmittelhaltbarkeit, Schimmel oder Medikamenten; "
    + "im Zweifel ein organisatorischer Kniff (Reihenfolge, Ort, Zeitpunkt) statt eines stofflichen. "
    + "Formuliere ihn als Vorschlag zum Ausprobieren, nie als garantierte Wirkung; keine Wirk-, Spar- oder Gesundheitsversprechen.",
};

// Engagement question that fits the pattern (reference copy).
export const PATTERN_QUESTION: Record<EditorialPattern, string> = {
  story: "Wie war das zuletzt bei dir?", aha: "Hättest du das gewusst?", humor: "Wer kennt's? Erzähl gern in den Kommentaren.",
  emotion: "Was macht deinen Alltag gerade leichter?", hack: "Probierst du das aus?",
};

// Model texts in the hack voice that touch these areas fall back to the reference text (like unsupported claims): a wrong
// household tip with chemicals, electricity, gas, fire, food safety, mould or medicine can do real harm.
// Long stems match inside compounds („Verschimmeltes“, „Chlorreiniger“), short ones at a word start („Gasherd“). Harmless
// words like „Gasse“ also fall back – the safe direction.
export const RISKY_HACK_PATTERN = /(?:misch|chlor|essig|natron|backpulver|zitronensäure|bleich|ammoniak|spiritus|lösungsmittel|terpentin|steckdose|flamme|schimmel|haltbar|verdorben|medikament|tablette|arznei)|\b(?:gas|strom|feuer|kerze|kabel)/i;

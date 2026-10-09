import { createHash } from "node:crypto";

// One style brief per piece of content; every slide/image brief inherits it so a carousel looks consistent.
// The repository defines no brand colours or fonts (see lib/landing/brand.ts), so none are invented: the palette
// below is a neutral working default, marked as such, and can be replaced via TOPIC_BRAND_PALETTE.

export type StyleBrief = {
  key: string;
  visual_identity: string;
  typography: string;
  layout: string;
  image_style: string;
  tone: string;
  palette: { background: string; text: string; accent: string; source: "configured" | "neutral_default" };
};

const HEX = /^#[0-9a-f]{6}$/i;
function palette(): StyleBrief["palette"] {
  const configured = (process.env.TOPIC_BRAND_PALETTE || "").split(",").map(item => item.trim());
  if (configured.length === 3 && configured.every(item => HEX.test(item))) return { background: configured[0], text: configured[1], accent: configured[2], source: "configured" };
  return { background: "#F6F1EA", text: "#1F2A33", accent: "#2E7D6B", source: "neutral_default" };
}

export function createStyleBrief(input: { topicId: string; trendType: string; tone?: string[] }): StyleBrief {
  const colours = palette();
  const humor = input.tone?.includes("more_humor");
  const serious = input.tone?.includes("more_serious") || ["BREAKING_NEWS", "SEARCH_TREND"].includes(input.trendType);
  const brief = {
    visual_identity: "„Alltäglich leichter“: ruhige, echte Alltagsszenen in deutschen Wohnungen, aufgeräumt, warmes Tageslicht, keine Stockfoto-Ästhetik",
    typography: "Eine serifenlose Schrift, Überschrift fett und groß (max. 8 Wörter), Fließtext max. 25 Wörter, hoher Kontrast, linksbündig",
    layout: "Hochformat 4:5, großzügiger Rand, Überschrift oben, Motiv oder Text darunter, Foliennummer unten rechts, wiederkehrender Akzentbalken",
    image_style: "fotorealistisch, natürliche Farben, Alltagsgegenstände ohne Markenlogos, keine Personen-Close-ups, kein Text im generierten Bild",
    tone: humor ? "locker, leicht humorvoll, nie albern" : serious ? "sachlich, ruhig, ohne Alarmismus" : "freundlich, hilfsbereit, unaufgeregt",
    palette: colours,
  };
  const key = createHash("sha256").update(JSON.stringify(brief)).digest("hex").slice(0, 12);
  return { key, ...brief };
}

export function imagePromptFromBrief(style: StyleBrief, motif: string) {
  return `${motif}. Stil: ${style.image_style}. Bildsprache: ${style.visual_identity}. Farbstimmung passend zu ${style.palette.background} und ${style.palette.accent}. Ohne Schrift, ohne Logos, ohne Wasserzeichen.`;
}

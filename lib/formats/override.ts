import type { ContentFormat } from "./catalog";

// The operator's format and style wishes as structured data. Free-text WhatsApp messages are understood by the
// semantic router (lib/whatsapp/topic-route.ts) and mapped to this shape (lib/topic-pipeline/instructions.ts);
// there is no keyword/pattern parser for free wishes. The format router applies them with the highest priority.

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

// Later instructions refine earlier ones (each WhatsApp correction adds to the previous wishes).
export function mergeOverrides(base: FormatOverride, next: FormatOverride): FormatOverride {
  const format = next.format ?? (next.exclude.includes(base.format as ContentFormat) ? null : base.format);
  return { format, slides: next.slides ?? base.slides, exclude: [...new Set([...base.exclude, ...next.exclude])].filter(item => item !== next.format),
    noProduct: base.noProduct || next.noProduct, tone: [...new Set([...base.tone, ...next.tone])], newHook: next.newHook, newTopic: next.newTopic,
    cheaper: base.cheaper || next.cheaper, matched: [...base.matched, ...next.matched] };
}

export const hasOverride = (override: FormatOverride) => override.matched.length > 0;

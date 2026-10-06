import { CAROUSEL_MAX_SLIDES, CAROUSEL_MIN_SLIDES, FORMAT_LABEL } from "../formats/catalog";
import { emptyOverride, type FormatOverride } from "../formats/override";
import type { TopicRoute } from "../whatsapp/topic-route";

// Maps the semantic router's understanding of a free WhatsApp message to the structured format/style wish.
// Pure: no I/O, no decision about execution.
const TONE_LABEL: Record<string, string> = { less_promotional: "weniger werblich", more_humor: "mehr Humor", more_serious: "sachlicher", shorter: "kürzer" };

export function overrideFromTopicRoute(route: TopicRoute): FormatOverride {
  const out = emptyOverride();
  if (route.intent === "new_topic") { out.newTopic = true; out.matched.push("neues Thema"); return out; }
  if (route.intent === "no_product") { out.noProduct = true; out.matched.push("ohne Produkt"); return out; }
  if (route.intent !== "change") return out;
  out.exclude = [...new Set(route.exclude_formats)];
  out.format = route.format && !out.exclude.includes(route.format) ? route.format : null;
  if (route.slides !== null) {
    out.slides = Math.max(CAROUSEL_MIN_SLIDES, Math.min(CAROUSEL_MAX_SLIDES, route.slides));
    if (!out.format && !out.exclude.includes("CAROUSEL")) out.format = "CAROUSEL";
  }
  out.tone = [...new Set(route.tone)];
  out.newHook = route.new_hook;
  out.cheaper = route.cheaper;
  if (out.format) out.matched.push(FORMAT_LABEL[out.format]);
  if (out.slides) out.matched.push(`${out.slides} Slides`);
  for (const format of out.exclude) out.matched.push(`kein ${FORMAT_LABEL[format]}`);
  for (const tone of out.tone) out.matched.push(TONE_LABEL[tone]);
  if (out.newHook) out.matched.push("anderer Aufhänger");
  if (out.cheaper) out.matched.push("günstiger");
  return out;
}

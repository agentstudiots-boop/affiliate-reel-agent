import { emitEvent } from "../observability/events";
import { CONTENT_FORMATS, COST_CLASS, FALLBACK_CHAIN, FORMAT_LABEL, type ContentFormat, type Platform } from "./catalog";
import type { FormatOverride } from "./override";

// Content Format Router: decides which medium is actually produced. The scout only recommends.
// Priority: 1. manual WhatsApp instruction  2. executive directive (prepared, not wired)  3. router  4. scout.
// No provider calls here: availability, quotas and budget arrive as data.

export type FormatTopic = {
  topic_id: string; trend_type: string; suggested_format: ContentFormat; relevance_score: number; virality_score: number;
  visual_potential: number; suitable_for_video: boolean; suitable_for_avatar: boolean; risk_score: number;
  scores: { utility: { score: number }; video_fit: { score: number }; interaction: { score: number }; emotionality: { score: number } };
};

export type ProviderAvailability = {
  image: { available: boolean; reason?: string };
  standardVideo: { available: boolean; reason?: string };
  avatarVideo: { available: boolean; quotaRemaining: number | null; reason?: string };
};

export type ContentGoal = "reach" | "trust" | "engagement" | "conversion";

// Prepared for a later executive agent: same decision layer, lower priority than the operator.
export type ExecutiveDirective = { source: "executive_agent"; format?: ContentFormat; exclude?: ContentFormat[]; maxCostUnits?: number; reason: string };

export type FormatRequest = {
  topic: FormatTopic;
  goal?: ContentGoal;
  platforms: Platform[];
  availability: ProviderAvailability;
  budget?: { maxCostUnits?: number };
  // Affiliate context: a cheap product should not trigger an expensive production.
  productPriceClass?: "low" | "medium" | "high" | null;
  override?: FormatOverride | null;
  executive?: ExecutiveDirective | null;
};

export type FormatOption = { format: ContentFormat; value: number; costUnits: number; net: number; feasible: boolean; reasons: string[] };
export type FormatDecision = {
  format: ContentFormat;
  source: "manual" | "executive" | "router" | "scout";
  reasons: string[];
  options: FormatOption[];
  fallbacks: ContentFormat[];
  slides: number | null;
  manualNotHonoured?: string;
};

// Which formats each platform can carry natively (YouTube Shorts and TikTok need video or a slideshow derivation).
const PLATFORM_FIT: Record<Platform, Partial<Record<ContentFormat, number>>> = {
  instagram: { TEXT: 0.2, SINGLE_IMAGE: 0.8, CAROUSEL: 1, STANDARD_VIDEO: 1, AVATAR_VIDEO: 0.9 },
  facebook: { TEXT: 0.7, SINGLE_IMAGE: 0.9, CAROUSEL: 0.8, STANDARD_VIDEO: 0.9, AVATAR_VIDEO: 0.8 },
  tiktok: { TEXT: 0, SINGLE_IMAGE: 0.3, CAROUSEL: 0.7, STANDARD_VIDEO: 1, AVATAR_VIDEO: 1 },
  youtube: { TEXT: 0, SINGLE_IMAGE: 0, CAROUSEL: 0.2, STANDARD_VIDEO: 1, AVATAR_VIDEO: 1 },
  x: { TEXT: 1, SINGLE_IMAGE: 0.9, CAROUSEL: 0.6, STANDARD_VIDEO: 0.7, AVATAR_VIDEO: 0.6 },
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function feasibility(format: ContentFormat, availability: ProviderAvailability): { ok: boolean; reason?: string } {
  if (format === "SINGLE_IMAGE" || format === "CAROUSEL") {
    // A carousel can be made from text graphics alone; a single image needs a generated picture.
    if (format === "SINGLE_IMAGE" && !availability.image.available) return { ok: false, reason: `Bildprovider nicht verfügbar${availability.image.reason ? `: ${availability.image.reason}` : ""}` };
    return { ok: true };
  }
  if (format === "STANDARD_VIDEO" && !availability.standardVideo.available) return { ok: false, reason: `Videoproduktion nicht verfügbar${availability.standardVideo.reason ? `: ${availability.standardVideo.reason}` : ""}` };
  if (format === "AVATAR_VIDEO") {
    if (!availability.avatarVideo.available) return { ok: false, reason: `Avatar-Provider nicht verfügbar${availability.avatarVideo.reason ? `: ${availability.avatarVideo.reason}` : ""}` };
    if (availability.avatarVideo.quotaRemaining !== null && availability.avatarVideo.quotaRemaining <= 0) return { ok: false, reason: "Avatar-Kontingent für diesen Monat aufgebraucht" };
  }
  return { ok: true };
}

// Expected value per format, from the topic's own scores. Documented weights, no invented performance data.
function valueOf(format: ContentFormat, request: FormatRequest): { value: number; reasons: string[] } {
  const t = request.topic;
  const utility = t.scores.utility.score, video = t.scores.video_fit.score, interaction = t.scores.interaction.score;
  const reasons: string[] = [];
  let value: number;
  switch (format) {
    case "TEXT": value = 25 + 0.25 * interaction + (t.trend_type === "BREAKING_NEWS" || t.trend_type === "SEARCH_TREND" ? 15 : 0); reasons.push("Text: schnell, Diskussion/Einordnung"); break;
    case "SINGLE_IMAGE": value = 20 + 0.45 * t.visual_potential + 0.15 * t.virality_score; reasons.push(`Bild: visuelles Potenzial ${t.visual_potential}`); break;
    case "CAROUSEL": value = 15 + 0.45 * utility + 0.2 * interaction + 0.1 * t.visual_potential; reasons.push(`Karussell: Nutzwert ${utility}, mehrere Punkte erklärbar`); break;
    case "STANDARD_VIDEO": value = (t.suitable_for_video ? 25 : 0) + 0.45 * video + 0.3 * t.virality_score; reasons.push(`Video: Videoeignung ${video}, Viralität ${t.virality_score}`); break;
    case "AVATAR_VIDEO": value = (t.suitable_for_avatar ? 25 : -20) + 0.3 * utility + 0.35 * t.virality_score + 0.1 * interaction; reasons.push(t.suitable_for_avatar ? "Avatar: Erklärformat passt" : "Avatar: Thema nicht als Erklärvideo geeignet"); break;
  }
  if (t.suggested_format === format) { value += 5; reasons.push("Scout-Empfehlung"); }
  // Platform fit: average over requested platforms.
  const fit = request.platforms.length ? request.platforms.reduce((sum, platform) => sum + (PLATFORM_FIT[platform][format] ?? 0), 0) / request.platforms.length : 1;
  value *= 0.6 + 0.4 * fit;
  if (request.goal === "reach" && (format === "STANDARD_VIDEO" || format === "AVATAR_VIDEO")) { value += 5; reasons.push("Ziel Reichweite"); }
  if (request.goal === "trust" && (format === "CAROUSEL" || format === "TEXT")) { value += 5; reasons.push("Ziel Vertrauen"); }
  return { value: clamp(value), reasons };
}

export function decideFormat(request: FormatRequest): FormatDecision {
  emitEvent("format_router_started", { topicId: request.topic.topic_id, platforms: request.platforms, manual: !!request.override?.matched.length });
  const override = request.override;
  const exclude = new Set<ContentFormat>([...(override?.exclude ?? []), ...(request.executive?.exclude ?? [])]);
  let maxCost = Math.min(request.budget?.maxCostUnits ?? Infinity, request.executive?.maxCostUnits ?? Infinity);
  if (request.productPriceClass === "low") maxCost = Math.min(maxCost, COST_CLASS.CAROUSEL.units);
  if (override?.cheaper) maxCost = Math.min(maxCost, COST_CLASS.SINGLE_IMAGE.units);
  // A strong reach topic may consciously get more budget, unless the operator asked for cheaper.
  const strongReach = request.topic.virality_score >= 70 && request.topic.relevance_score >= 70;

  const options: FormatOption[] = CONTENT_FORMATS.map(format => {
    const { value, reasons } = valueOf(format, request);
    const costUnits = COST_CLASS[format].units;
    const feasible = feasibility(format, request.availability);
    const affordable = costUnits <= maxCost;
    const allowed = !exclude.has(format);
    // Cost matters, but is not the only factor: 2 value points per cost unit; strong reach topics pay half.
    const net = clamp(value - costUnits * (strongReach && !override?.cheaper ? 1 : 2));
    const why = [...reasons, `Kosten: ${COST_CLASS[format].label}`];
    if (!feasible.ok) why.push(feasible.reason!);
    if (!affordable) why.push("über Budget");
    if (!allowed) why.push("ausgeschlossen");
    return { format, value, costUnits, net, feasible: feasible.ok && affordable && allowed, reasons: why };
  });
  const feasibleSorted = options.filter(option => option.feasible)
    // At comparable expected value (within 5 points) prefer the cheaper production.
    .sort((a, b) => Math.abs(a.net - b.net) <= 5 ? a.costUnits - b.costUnits : b.net - a.net);
  const pick = (format: ContentFormat | undefined) => format ? options.find(option => option.format === format && option.feasible) : undefined;
  const fallbacksFor = (format: ContentFormat) => FALLBACK_CHAIN[format].filter(item => options.find(option => option.format === item)?.feasible);

  let decision: FormatDecision;
  if (override?.format) {
    const chosen = pick(override.format);
    if (chosen) decision = { format: chosen.format, source: "manual", reasons: [`Manuelle Anweisung: ${FORMAT_LABEL[chosen.format]}`], options, fallbacks: fallbacksFor(chosen.format), slides: override.slides };
    else {
      const fallback = fallbacksFor(override.format)[0] ?? feasibleSorted[0]?.format ?? "TEXT";
      const blocked = options.find(option => option.format === override.format)!;
      decision = { format: fallback, source: "manual", reasons: [`Wunsch ${FORMAT_LABEL[override.format]} nicht umsetzbar, nächstbeste Form: ${FORMAT_LABEL[fallback]}`],
        options, fallbacks: fallbacksFor(fallback), slides: override.slides, manualNotHonoured: blocked.reasons.filter(reason => /nicht verfügbar|aufgebraucht|Budget|ausgeschlossen/.test(reason)).join("; ") || "nicht umsetzbar" };
    }
  } else if (request.executive?.format && pick(request.executive.format)) {
    const format = request.executive.format;
    decision = { format, source: "executive", reasons: [`Executive-Vorgabe: ${request.executive.reason}`], options, fallbacks: fallbacksFor(format), slides: override?.slides ?? null };
  } else if (feasibleSorted.length) {
    const best = feasibleSorted[0];
    const source = best.format === request.topic.suggested_format ? "scout" : "router";
    decision = { format: best.format, source, reasons: [`Bester erwarteter Nutzen bei vertretbaren Kosten (${best.net})`, ...best.reasons.slice(0, 3)], options, fallbacks: fallbacksFor(best.format), slides: override?.slides ?? null };
  } else {
    // TEXT is always producible without any provider; only an explicit exclusion can remove it.
    decision = { format: "TEXT", source: "router", reasons: ["Keine andere Form umsetzbar; Text braucht keinen Provider"], options, fallbacks: [], slides: null };
  }
  emitEvent("format_router_selected", { topicId: request.topic.topic_id, format: decision.format, source: decision.source, fallbacks: decision.fallbacks, manualNotHonoured: decision.manualNotHonoured });
  return decision;
}

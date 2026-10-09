import type { ContentFormat } from "../formats/catalog";
import { categoryHint, hits, type LexiconName } from "./lexicon";
import { publisherQuality } from "./publishers";
import type { FactStatus, RawSignal, Score, ScoreKey, TrendType } from "./schema";

// Deterministic, traceable classification and scoring. No model call, no invented numbers:
// every score is computed from listed factors (matched words, source counts, dates, source strength).

export type Cluster = { title: string; signals: RawSignal[] };

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const score = (value: number, factors: string[]): Score => ({ score: clamp(value), factors: factors.filter(Boolean).slice(0, 10).map(item => item.slice(0, 160)) });

export function clusterText(cluster: Cluster) { return [cluster.title, ...cluster.signals.map(signal => `${signal.title} ${signal.snippet} ${signal.tags.join(" ")}`)].join(" "); }

export function newestPublished(cluster: Cluster): Date | null {
  const times = cluster.signals.map(signal => signal.publishedAt ? Date.parse(signal.publishedAt) : NaN).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)) : null;
}
const eventDate = (cluster: Cluster) => cluster.signals.find(signal => signal.eventDate)?.eventDate ?? null;
const daysUntil = (date: string, now: Date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);

// Distinct publishers that actually report (news), excluding aggregators and the search feed itself.
export function reportingPublishers(cluster: Cluster) {
  const hosts = new Set<string>();
  for (const signal of cluster.signals) {
    if (signal.kind !== "news" || !signal.publisher) continue;
    if (publisherQuality(signal.publisher) === "aggregator") continue;
    hosts.add(signal.publisher);
  }
  return [...hosts];
}

export function hitMap(text: string) {
  const names: LexiconName[] = ["entertainment", "gossip", "curiosity", "practical", "product", "weather", "event", "social", "highRisk", "mediumRisk", "emotional", "visual", "process", "interaction", "sensational"];
  return Object.fromEntries(names.map(name => [name, hits(text, name)])) as Record<LexiconName, string[]>;
}

export function classifyTrend(cluster: Cluster, now: Date): { type: TrendType; reason: string } {
  const kinds = new Set(cluster.signals.map(signal => signal.kind));
  const text = clusterText(cluster);
  const h = hitMap(text);
  const tags = new Set(cluster.signals.flatMap(signal => signal.tags));
  if (kinds.has("calendar")) {
    return tags.has("jahreszeit") || tags.has("zeitumstellung") ? { type: "SEASONAL", reason: "Kalender: Jahreszeit/Zeitumstellung" } : { type: "EVENT", reason: "Kalender: Feiertag/Anlass" };
  }
  if (kinds.has("evergreen") && kinds.size === 1) {
    return tags.has("ganzjährig") ? { type: "EVERGREEN", reason: "Kuratiertes ganzjähriges Alltagsthema" } : { type: "PRACTICAL_LIFE", reason: "Kuratiertes saisonales Alltagsthema" };
  }
  const newest = newestPublished(cluster);
  const ageHours = newest ? (now.getTime() - newest.getTime()) / 3_600_000 : null;
  if (h.entertainment.length) return { type: "ENTERTAINMENT", reason: `Entertainment-Begriffe: ${h.entertainment.slice(0, 3).join(", ")}` };
  if (h.social.length) return { type: "SOCIAL_HYPE", reason: `Social-Begriffe: ${h.social.slice(0, 3).join(", ")}` };
  if (h.curiosity.length) return { type: "CURIOSITY", reason: `Kurios-Begriffe: ${h.curiosity.slice(0, 3).join(", ")}` };
  if (h.weather.length >= 1 && !h.highRisk.length) return { type: "SEASONAL", reason: `Wetter/Jahreszeit: ${h.weather.slice(0, 3).join(", ")}` };
  if (h.product.length && h.practical.length) return { type: "PRODUCT_ADJACENT", reason: `Produktnah: ${h.product.slice(0, 3).join(", ")}` };
  if (h.practical.length >= 2) return { type: "PRACTICAL_LIFE", reason: `Alltagsbegriffe: ${h.practical.slice(0, 3).join(", ")}` };
  if (h.event.length) return { type: "EVENT", reason: `Ereignis: ${h.event.slice(0, 3).join(", ")}` };
  if (!kinds.has("news")) return { type: "SEARCH_TREND", reason: "Nur Such-/Aufrufsignal, keine Meldung" };
  if (ageHours !== null && ageHours <= 48) return { type: "BREAKING_NEWS", reason: `Aktuelle Meldung (${Math.round(ageHours)} h alt)` };
  return { type: kinds.has("search") ? "SEARCH_TREND" : "BREAKING_NEWS", reason: "Meldung ohne Alltagsbezug" };
}

export function factStatus(cluster: Cluster, type: TrendType): FactStatus {
  const kinds = new Set(cluster.signals.map(signal => signal.kind));
  if ((kinds.has("calendar") || kinds.has("evergreen")) && !kinds.has("news")) return "not_applicable";
  const publishers = reportingPublishers(cluster);
  if (publishers.length >= 2) return "multi_source";
  if (publishers.length === 1 && publisherQuality(publishers[0]) === "reputable") return "single_reputable_source";
  void type;
  return "unverified";
}

const TYPE_BRAND_BASE: Record<TrendType, number> = { PRACTICAL_LIFE: 75, EVERGREEN: 70, SEASONAL: 70, PRODUCT_ADJACENT: 70, EVENT: 60, CURIOSITY: 55, SOCIAL_HYPE: 50, ENTERTAINMENT: 50, SEARCH_TREND: 35, BREAKING_NEWS: 30 };

export type Scored = { scores: Record<ScoreKey, Score>; relevance: number; factStatus: FactStatus; sensitive: boolean; gossip: boolean; category: string | null;
  suitableForVideo: boolean; suitableForAvatar: boolean; suggestedFormat: ContentFormat; confidence: number; ageHours: number | null; daysUntilEvent: number | null };

export function scoreCluster(cluster: Cluster, type: TrendType, now: Date): Scored {
  const text = clusterText(cluster);
  const h = hitMap(text);
  const kinds = new Set(cluster.signals.map(signal => signal.kind));
  const sources = new Set(cluster.signals.map(signal => signal.source));
  const publishers = reportingPublishers(cluster);
  const maxStrength = Math.max(0, ...cluster.signals.map(signal => signal.strength));
  const newest = newestPublished(cluster);
  const ageHours = newest ? Math.max(0, (now.getTime() - newest.getTime()) / 3_600_000) : null;
  const event = eventDate(cluster);
  const daysUntilEvent = event ? daysUntil(event, now) : null;
  const facts = factStatus(cluster, type);
  const gossip = h.gossip.length > 0;
  const sensitive = h.highRisk.length > 0 || h.mediumRisk.length > 0 || gossip;
  const category = gossip || h.highRisk.length ? null : categoryHint(text);
  const list = (label: string, words: string[]) => words.length ? `${label}: ${words.slice(0, 4).join(", ")}` : "";

  // Freshness
  let freshness: Score;
  if (ageHours !== null) {
    const value = ageHours <= 24 ? 100 : ageHours <= 48 ? 85 : ageHours <= 72 ? 70 : ageHours <= 168 ? 45 : ageHours <= 720 ? 20 : 5;
    freshness = score(value, [`Neueste Meldung vor ${Math.round(ageHours)} h`]);
  } else if (daysUntilEvent !== null) {
    freshness = score(daysUntilEvent <= 10 ? 90 : 70, [`Termin in ${daysUntilEvent} Tagen`]);
  } else if (kinds.has("search") || kinds.has("attention")) {
    freshness = score(80, ["Such-/Aufrufsignal von heute bzw. gestern"]);
  } else {
    freshness = score(50, ["Zeitloses Thema ohne Datum"]);
  }

  const trendStrength = score(Math.min(60, 20 * sources.size) + 10 * Math.min(3, publishers.length) + 30 * maxStrength,
    [`${sources.size} Quelle(n): ${[...sources].join(", ")}`, `${publishers.length} berichtende(r) Publisher`, `Max. Quellsignalstärke ${maxStrength.toFixed(2)}`]);

  const riskPoints = (h.highRisk.length ? 70 : 0) + (h.mediumRisk.length ? 35 : 0) + (gossip ? 25 : 0)
    + (kinds.has("news") && facts === "unverified" ? 15 : 0)
    + (publishers.length && publishers.every(host => publisherQuality(host) === "boulevard") ? 15 : 0) + (h.sensational.length ? 10 : 0);
  const risk = score(10 + riskPoints, [list("Hochrisiko-Begriffe", h.highRisk), list("Risiko-Begriffe", h.mediumRisk), gossip ? list("Klatsch", h.gossip) : "",
    kinds.has("news") && facts === "unverified" ? "Meldung nicht ausreichend belegt" : "", list("Sensationssprache", h.sensational), riskPoints ? "" : "Keine Risikobegriffe gefunden"]);

  const brandFit = score(TYPE_BRAND_BASE[type] + Math.min(20, 5 * h.practical.length) + (category ? 10 : 0) - (h.highRisk.length ? 30 : 0) - (h.mediumRisk.length ? 15 : 0) - (gossip ? 25 : 0),
    [`Basis für ${type}: ${TYPE_BRAND_BASE[type]}`, list("Alltagsbezug", h.practical), category ? `Kategorie-Hinweis: ${category}` : "", h.highRisk.length ? "Abzug: Hochrisiko-Thema" : "", gossip ? "Abzug: Klatsch" : ""]);

  const typeUtility: Partial<Record<TrendType, number>> = { PRACTICAL_LIFE: 40, EVERGREEN: 40, SEASONAL: 30, PRODUCT_ADJACENT: 25, EVENT: 15 };
  const utility = score((typeUtility[type] ?? 0) + 12 * h.practical.length + 8 * h.process.length, [`Typ-Basis ${typeUtility[type] ?? 0}`, list("Alltagsbegriffe", h.practical), list("Anleitungsbezug", h.process)]);

  const typeEmotion: Partial<Record<TrendType, number>> = { ENTERTAINMENT: 25, CURIOSITY: 25, EVENT: 20, SOCIAL_HYPE: 20, SEASONAL: 10 };
  const emotionality = score((typeEmotion[type] ?? 5) + 15 * h.emotional.length, [`Typ-Basis ${typeEmotion[type] ?? 5}`, list("Emotionsbegriffe", h.emotional)]);

  const typeVisual: Partial<Record<TrendType, number>> = { SEASONAL: 40, EVENT: 40, PRACTICAL_LIFE: 35, PRODUCT_ADJACENT: 40, EVERGREEN: 30, CURIOSITY: 30, ENTERTAINMENT: 20, SOCIAL_HYPE: 25, SEARCH_TREND: 15, BREAKING_NEWS: 10 };
  const visual = score((typeVisual[type] ?? 15) + 12 * h.visual.length, [`Typ-Basis ${typeVisual[type] ?? 15}`, list("Bildmotive", h.visual), type === "ENTERTAINMENT" ? "Keine fremden Film-/Promi-Bilder verwendbar" : ""]);

  const videoFit = score(0.5 * visual.score + 15 * h.process.length + (type === "PRACTICAL_LIFE" ? 15 : 0), [`Hälfte des visuellen Potenzials (${visual.score})`, list("Zeigbare Abläufe", h.process)]);

  const typeInteraction: Partial<Record<TrendType, number>> = { EVENT: 30, SEASONAL: 30, PRACTICAL_LIFE: 30, ENTERTAINMENT: 25, CURIOSITY: 25, SOCIAL_HYPE: 25, EVERGREEN: 20 };
  const interaction = score((typeInteraction[type] ?? 10) + 10 * h.interaction.length + 5 * h.emotional.length, [`Typ-Basis ${typeInteraction[type] ?? 10}`, list("Fragen/Listen", h.interaction)]);

  const monetization = score(gossip || h.highRisk.length ? 0 : (category ? 55 : 15) + 8 * h.product.length,
    [category ? `Produktkategorie denkbar: ${category}` : "Kein naheliegender Produktbezug", list("Produktbegriffe", h.product), gossip || h.highRisk.length ? "Kein Affiliate-Bezug bei sensiblen Themen" : ""]);

  const reputable = publishers.filter(host => publisherQuality(host) === "reputable").length;
  const boulevard = publishers.filter(host => publisherQuality(host) === "boulevard").length;
  const sourceQuality = !kinds.has("news")
    ? (kinds.has("calendar") || kinds.has("evergreen") ? score(80, ["Lokal berechnet bzw. kuratiert, keine externe Tatsachenbehauptung"]) : score(35, ["Nur Such-/Aufrufsignal, keine Faktenquelle"]))
    : score(reputable >= 2 ? 90 : reputable === 1 ? (publishers.length >= 2 ? 80 : 70) : publishers.length >= 2 ? 50 - 10 * boulevard : boulevard ? 25 : 35,
      [`${reputable} etablierte, ${boulevard} Boulevard-, ${publishers.length - reputable - boulevard} unbekannte Publisher`]);

  const virality = score(0.45 * trendStrength.score + 0.25 * emotionality.score + 0.15 * interaction.score + (["CURIOSITY", "SOCIAL_HYPE", "ENTERTAINMENT"].includes(type) ? 15 : 0),
    [`45 % Trendstärke (${trendStrength.score})`, `25 % Emotion (${emotionality.score})`, `15 % Interaktion (${interaction.score})`]);

  const scores: Record<ScoreKey, Score> = { freshness, trend_strength: trendStrength, brand_fit: brandFit, virality, utility, emotionality, visual, video_fit: videoFit,
    interaction, monetization, risk, source_quality: sourceQuality };

  const relevance = clamp(0.22 * freshness.score + 0.15 * trendStrength.score + 0.25 * brandFit.score + 0.15 * utility.score + 0.08 * virality.score
    + 0.15 * sourceQuality.score - 0.4 * Math.max(0, risk.score - 40));

  const suitableForVideo = videoFit.score >= 55 && risk.score < 50;
  const explanatory = ["PRACTICAL_LIFE", "EVERGREEN", "SEASONAL", "CURIOSITY", "EVENT", "PRODUCT_ADJACENT"].includes(type) || (type === "BREAKING_NEWS" && facts !== "unverified");
  const suitableForAvatar = explanatory && !sensitive && (utility.score >= 50 || interaction.score >= 50);
  const suggestedFormat: ContentFormat = suitableForAvatar && virality.score >= 65 ? "AVATAR_VIDEO"
    : suitableForVideo && virality.score >= 60 ? "STANDARD_VIDEO"
      : utility.score >= 60 && h.practical.length + h.process.length >= 2 ? "CAROUSEL"
        : visual.score >= 55 ? "SINGLE_IMAGE" : "TEXT";

  // Confidence = how well the candidate is backed, not how good it is.
  const confidence = clamp((facts === "multi_source" ? 85 : facts === "single_reputable_source" ? 70 : facts === "not_applicable" ? 75 : 35) + Math.min(10, 3 * (sources.size - 1)));
  return { scores, relevance, factStatus: facts, sensitive, gossip, category, suitableForVideo, suitableForAvatar, suggestedFormat, confidence, ageHours, daysUntilEvent };
}

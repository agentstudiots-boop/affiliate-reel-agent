import { COST_CLASS, FORMAT_LABEL, PLATFORM_LABEL, type ContentFormat } from "../formats/catalog";
import type { FormatDecision } from "../formats/router";
import type { PlatformVariant } from "../distribution/platforms/adapters";
import type { PublishPlanEntry } from "../distribution/publish";
import type { MasterContent } from "../distribution/master-content";
import type { TopicCandidate } from "../topics/schema";
import type { ProductionResult } from "../visual/types";
import type { ProductSuggestion } from "./product-coupling";
import type { TopicCopy } from "./copy";

// WhatsApp texts of the topic pipeline. Pure formatting; no decisions.

const TYPE_LABEL: Record<string, string> = { BREAKING_NEWS: "aktuelle Meldung", SOCIAL_HYPE: "Social Hype", ENTERTAINMENT: "Entertainment", SEASONAL: "saisonal",
  EVERGREEN: "Evergreen", SEARCH_TREND: "Suchtrend", EVENT: "Anlass/Ereignis", CURIOSITY: "Kurioses", PRACTICAL_LIFE: "Alltag", PRODUCT_ADJACENT: "produktnah" };

function planLine(format: ContentFormat, production: ProductionResult | null) {
  if (!production) return FORMAT_LABEL[format];
  if (production.carousel) return `${production.carousel.slide_count} Slides (${production.carousel.count_reason}), ${production.carousel.generated_images} davon mit generiertem Bild`;
  if (production.dryRun?.wouldUseAvatar) return `Avatar-Video über ${production.video?.provider ?? "Avatar-Anbieter"}`;
  if (production.dryRun?.wouldUseStandardVideo) return `Video über ${production.video?.provider ?? "Video-Anbieter"}`;
  if (production.dryRun?.wouldGenerateImages) return `${production.dryRun.wouldGenerateImages} generiertes Bild`;
  return FORMAT_LABEL[production.producedFormat];
}

export function proposalText(input: { candidate: TopicCandidate; decision: FormatDecision; copy: TopicCopy; production: ProductionResult | null; revision: number;
  product: { status: string; name?: string }; note?: string | null }) {
  const { candidate, decision, copy } = input;
  const format = input.production?.producedFormat ?? decision.format;
  const sources = candidate.source_signals.filter(signal => signal.url && signal.kind === "news").slice(0, 3)
    .map(signal => `• ${signal.publisher ?? "Quelle"}: ${signal.url}`);
  return [
    `Themenvorschlag${input.revision > 1 ? ` (Überarbeitung ${input.revision})` : ""} · ${input.product.status === "selected" ? "Affiliate-Post" : "Themen-Post"}`,
    "",
    `„${candidate.title}“ (${TYPE_LABEL[candidate.trend_type] ?? candidate.trend_type})`,
    `Warum jetzt: ${candidate.why_now}`,
    `Hook: ${copy.hook}`,
    `Format: ${FORMAT_LABEL[format]} · Kosten: ${COST_CLASS[format].label} · Entscheidung: ${decision.source === "manual" ? "dein Wunsch" : decision.source === "scout" ? "Scout-Empfehlung" : "Format-Router"}`,
    decision.manualNotHonoured ? `Hinweis: dein Formatwunsch ist gerade nicht umsetzbar (${decision.manualNotHonoured}).` : null,
    input.production?.fallbacks.length ? `Ausweichformat: ${input.production.fallbacks.map(item => `${FORMAT_LABEL[item.from]} → ${FORMAT_LABEL[item.to]} (${item.reason})`).join("; ")}` : null,
    `Plan: ${planLine(format, input.production)}`,
    `Text: ${copy.origin === "model" ? "KI-Modus (ein Modellaufruf, auf unbelegte Aussagen geprüft)" : "Referenzmodus (Regelvorlage aus den Scout-Daten, keine freie KI-Analyse)"}`,
    `Faktenlage: ${candidate.fact_status === "not_applicable" ? "keine externe Behauptung (Kalender/kuratiert)" : candidate.fact_status === "multi_source" ? "mehrere Quellen" : "eine etablierte Quelle"}`,
    sources.length ? `Quellen:\n${sources.join("\n")}` : null,
    input.product.status === "selected" ? `Produkt: ${input.product.name} (mit Affiliate-Link, Kennzeichnung „Werbung“)` : "Produkt: keins, kein Affiliate-Link",
    input.note ? `\n${input.note}` : null,
    "",
    "Antworte auf DIESE Nachricht mit „Freigeben“ (Produktion starten, noch keine Veröffentlichung), „Ablehnen“ oder einem Wunsch, z. B. „Nur Bild“, „Nur vier Slides“, „Kein Avatar“, „Lieber Video“, „Weniger werblich“, „Anderer Aufhänger“, „Neues Thema“, „Such mir dazu ein passendes Produkt“.",
  ].filter((line): line is string => line !== null).join("\n");
}

export function productSuggestionsText(topicTitle: string, suggestions: ProductSuggestion[]) {
  return [`Produktvorschläge zu „${topicTitle}“ (Produkt-Trendscout, noch nichts übernommen):`, "",
    ...suggestions.map((item, index) => `${index + 1}. ${item.name} – ${item.reason}`), "",
    "Antworte auf DIESE Nachricht mit „Produkt 1“, „Produkt 2“ oder „Produkt 3“, um es mit Affiliate-Link (Kennzeichnung „Werbung“) zu übernehmen, oder „Kein Produkt“.",
    "Ohne deine Auswahl bleibt es ein Themen-Post ohne Link. Die Amazon-Produktseite wird vor der Übernahme geprüft; veröffentlicht wird erst nach deiner separaten Freigabe."].join("\n");
}

export function publishApprovalText(master: MasterContent, variants: PlatformVariant[], plan: PublishPlanEntry[], version: number, liveEnabled: boolean) {
  const lines = [
    `Veröffentlichungsfreigabe · ${master.category === "affiliate" ? "Affiliate-Post" : "Themen-Post"}, ${FORMAT_LABEL[master.selected_format]} · Fassung ${version}`,
    "",
    `„${master.topic.title}“`,
    `Hook: ${master.hook}`,
    master.affiliate_data ? `Affiliate-Link: ${master.affiliate_data.affiliateUrl} (${master.affiliate_data.product.name})` : "Kein Affiliate-Link.",
    master.disclosures.length ? `Kennzeichnung: ${master.disclosures.join(" · ")}` : null,
    master.assets.length ? `Medien:\n${master.assets.filter(asset => asset.url).slice(0, 8).map(asset => `• ${asset.role}: ${asset.url}`).join("\n")}` : null,
    "",
    "Plattformen:",
    ...variants.map(variant => {
      const entry = plan.find(item => item.platform === variant.platform);
      return variant.publishable
        ? `• ${PLATFORM_LABEL[variant.platform]}: ${variant.mediaFormat}, Link: ${variant.linkStrategy}${variant.links.length ? ` (${variant.links[0]})` : ""}${entry && !entry.wouldPublish && !/Freigabe/.test(entry.reason) ? ` – ${entry.reason}` : ""}`
        : `• ${PLATFORM_LABEL[variant.platform]}: wird nicht veröffentlicht (${variant.skipReason})`;
    }),
    "",
    "Text (Facebook-Fassung):",
    (variants.find(variant => variant.platform === "facebook")?.text ?? master.caption).slice(0, 900),
    "",
    liveEnabled ? "Live-Veröffentlichung ist freigeschaltet: „Freigeben“ veröffentlicht genau diese Fassung." : "Live-Veröffentlichung ist ausgeschaltet: „Freigeben“ führt nur einen Probelauf (Dry-Run) aus, es wird nichts gepostet.",
    "Antworte auf DIESE Nachricht mit „Freigeben“ für genau diese Fassung, „Ablehnen“ oder einem Änderungswunsch. Jede Änderung erzeugt eine neue Fassung und braucht eine neue Freigabe.",
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

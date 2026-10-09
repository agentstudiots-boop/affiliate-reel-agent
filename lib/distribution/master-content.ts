import type { ContentFormat } from "../formats/catalog";
import { emitEvent } from "../observability/events";
import type { GeneratedAsset } from "../visual/types";

// Platform-neutral master content: the single basis for all platform adapters. Built after production.

export type AffiliateData = {
  product: { name: string; asin: string; sourceUrl: string };
  affiliateUrl: string;
  // Evidence of the operator's explicit WhatsApp choice. Without it no link exists anywhere downstream.
  approval: { channel: "whatsapp"; messageId: string };
};

export type MasterContent = {
  content_id: string;
  category: "topic" | "affiliate";
  topic: { topic_id: string; title: string; trend_type: string };
  selected_format: ContentFormat;
  hook: string;
  message: string;
  body: string;
  cta: string;
  caption: string;
  hashtags: string[];
  assets: { role: string; kind: GeneratedAsset["kind"]; url: string | null; sha256: string | null; mediaType: string; provider: string }[];
  carousel: { slide_count: number; slides: { slide_number: number; headline: string; asset_role: string }[] } | null;
  video: { script: string; provider: string | null; asset_role: string | null } | null;
  source_references: { title: string; url: string | null; publisher: string | null; published_at: string | null }[];
  campaign: { run_id: string | null; origin: string };
  affiliate_data: AffiliateData | null;
  disclosures: string[];
  // Affiliate posts of the existing product pipeline: the approved record whose own WhatsApp approval, caption and
  // bookkeeping the shared publishers must honour. Absent for topic posts.
  source_ref?: AffiliateSourceRef | null;
};

export type AffiliateSourceRef =
  | { kind: "facebook_publication"; publicationId: string; jobId: string }
  | { kind: "instagram_reel"; publicationId: string; jobId: string };

export const AFFILIATE_DISCLOSURE = "Werbung | Affiliate-Link";
export const AI_IMAGE_DISCLOSURE = "Bild mit KI erstellt";

export function buildMasterContent(input: {
  contentId: string; topic: { topic_id: string; title: string; trend_type: string };
  format: ContentFormat; copy: { hook: string; coreMessage: string; body: string; cta: string; caption: string; hashtags: string[]; videoScript: string };
  assets: { role: string; asset: GeneratedAsset }[];
  carousel?: { slide_count: number; slides: { slide_number: number; headline: string }[] } | null;
  video?: { script: string; provider: string | null } | null;
  sources: { title: string; url: string | null; publisher: string | null; published_at: string | null }[];
  runId: string | null; origin: string;
  affiliate?: AffiliateData | null;
  // Set by the orchestrator from productCouplingBlocked(): sensitive topics never carry affiliate data.
  affiliateBlocked?: boolean;
}): MasterContent {
  // Hard rule: a link exists only with the operator's explicit WhatsApp choice and never on a sensitive topic.
  const affiliate = input.affiliate && !input.affiliateBlocked && input.affiliate.approval?.channel === "whatsapp" && input.affiliate.approval.messageId
    && /^https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}\?tag=/.test(input.affiliate.affiliateUrl) ? input.affiliate : null;
  const generated = input.assets.some(item => item.asset.kind === "image" || (item.asset.kind === "video" && item.asset.provider !== "local_svg"));
  const disclosures = [...(affiliate ? [AFFILIATE_DISCLOSURE] : []), ...(generated ? [AI_IMAGE_DISCLOSURE] : [])];
  const master: MasterContent = {
    content_id: input.contentId, category: affiliate ? "affiliate" : "topic", topic: input.topic, selected_format: input.format,
    hook: input.copy.hook, message: input.copy.coreMessage, body: input.copy.body, cta: input.copy.cta, caption: input.copy.caption, hashtags: input.copy.hashtags,
    assets: input.assets.map(({ role, asset }) => ({ role, kind: asset.kind, url: asset.url, sha256: asset.sha256, mediaType: asset.mediaType, provider: asset.provider })),
    carousel: input.carousel ? { slide_count: input.carousel.slide_count, slides: input.carousel.slides.map(slide => ({ slide_number: slide.slide_number, headline: slide.headline, asset_role: `slide-${slide.slide_number}` })) } : null,
    video: input.video ? { script: input.video.script, provider: input.video.provider, asset_role: input.assets.find(item => item.role === "video") ? "video" : null } : null,
    source_references: input.sources.slice(0, 6), campaign: { run_id: input.runId, origin: input.origin }, affiliate_data: affiliate, disclosures,
  };
  emitEvent("master_content_created", { contentId: input.contentId, format: input.format, category: master.category, assets: master.assets.length, affiliate: !!affiliate });
  return master;
}

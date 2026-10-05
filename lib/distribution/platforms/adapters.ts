import { PLATFORM_LABEL, type ContentFormat, type Platform } from "../../formats/catalog";
import { emitEvent } from "../../observability/events";
import type { PublishableVariant } from "../../publishing/approval-gate";
import { linkPolicy, type LinkRule } from "../link-policy";
import { AFFILIATE_DISCLOSURE, type MasterContent } from "../master-content";

// One master content, five adapters. Each adapter transforms format, text length, title, CTA, hashtags, link
// strategy, media usage, aspect ratio and disclosure for its platform. It never generates media.

export type MediaFormat = "text" | "image" | "carousel" | "album" | "photo_slideshow" | "reel" | "video" | "short" | "text_with_images";
export type PlatformVariant = PublishableVariant & {
  platform: Platform;
  mediaFormat: MediaFormat | "none";
  aspectRatio: string | null;
  publishable: boolean;
  skipReason: string | null;
  hashtags: string[];
  linkStrategy: string;
};

type Limits = { text: number; hashtags: number; title: number | null; images: number };
const LIMITS: Record<Platform, Limits> = {
  instagram: { text: 2200, hashtags: 5, title: null, images: 10 },
  facebook: { text: 3000, hashtags: 3, title: null, images: 10 },
  tiktok: { text: 2200, hashtags: 5, title: null, images: 35 },
  youtube: { text: 5000, hashtags: 3, title: 100, images: 0 },
  x: { text: 280, hashtags: 2, title: null, images: 4 },
};

// Format transformation per platform: master format → what the platform actually gets (or a skip reason).
const TRANSFORM: Record<Platform, Record<ContentFormat, { media: MediaFormat | "none"; aspect: string | null; skip?: string }>> = {
  instagram: { TEXT: { media: "none", aspect: null, skip: "Instagram braucht ein Bild oder Video" }, SINGLE_IMAGE: { media: "image", aspect: "4:5" },
    CAROUSEL: { media: "carousel", aspect: "4:5" }, STANDARD_VIDEO: { media: "reel", aspect: "9:16" }, AVATAR_VIDEO: { media: "reel", aspect: "9:16" } },
  facebook: { TEXT: { media: "text", aspect: null }, SINGLE_IMAGE: { media: "image", aspect: "4:5" }, CAROUSEL: { media: "album", aspect: "4:5" },
    STANDARD_VIDEO: { media: "video", aspect: "9:16" }, AVATAR_VIDEO: { media: "video", aspect: "9:16" } },
  tiktok: { TEXT: { media: "none", aspect: null, skip: "TikTok braucht Video oder Bilder" }, SINGLE_IMAGE: { media: "photo_slideshow", aspect: "9:16" },
    CAROUSEL: { media: "photo_slideshow", aspect: "9:16" }, STANDARD_VIDEO: { media: "video", aspect: "9:16" }, AVATAR_VIDEO: { media: "video", aspect: "9:16" } },
  youtube: { TEXT: { media: "none", aspect: null, skip: "YouTube Shorts braucht ein Video" }, SINGLE_IMAGE: { media: "none", aspect: null, skip: "YouTube Shorts braucht ein Video" },
    CAROUSEL: { media: "none", aspect: null, skip: "Keine Videoableitung des Karussells vorhanden; nicht veröffentlichen" },
    STANDARD_VIDEO: { media: "short", aspect: "9:16" }, AVATAR_VIDEO: { media: "short", aspect: "9:16" } },
  x: { TEXT: { media: "text", aspect: null }, SINGLE_IMAGE: { media: "text_with_images", aspect: "4:5" }, CAROUSEL: { media: "text_with_images", aspect: "4:5" },
    STANDARD_VIDEO: { media: "video", aspect: "9:16" }, AVATAR_VIDEO: { media: "video", aspect: "9:16" } },
};

const cut = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;

function assetRefs(master: MasterContent, platform: Platform, media: MediaFormat | "none") {
  if (media === "none" || media === "text") return [];
  const limit = LIMITS[platform].images;
  if (["reel", "video", "short"].includes(media)) return master.assets.filter(item => item.kind === "video").map(item => item.role).slice(0, 1);
  const images = master.assets.filter(item => item.kind === "image" || item.kind === "text_graphic");
  // X gets at most 4 pictures: generated images first, then the slide order.
  const ordered = platform === "x" ? [...images.filter(item => item.kind === "image"), ...images.filter(item => item.kind !== "image")] : images;
  return ordered.slice(0, media === "image" ? 1 : limit).map(item => item.role);
}

function linksFor(master: MasterContent, rule: LinkRule): { links: string[]; cta: string; strategy: string } {
  const affiliate = master.affiliate_data;
  if (affiliate) {
    if (rule.directLinks && rule.affiliateInText) return { links: [affiliate.affiliateUrl], cta: rule.cta.affiliate, strategy: "affiliate_link_im_text" };
    return { links: [], cta: rule.cta.affiliate, strategy: rule.profileLink ? "profil_link" : "kein_link" };
  }
  const source = rule.sourceLinks ? master.source_references.find(item => item.url && !/news\.google\.com/.test(item.url))?.url ?? null : null;
  return { links: source ? [source] : [], cta: rule.cta.topic || master.cta, strategy: source ? "quellenlink" : "kein_link" };
}

export function renderForPlatform(master: MasterContent, platform: Platform): PlatformVariant {
  emitEvent("platform_render_started", { contentId: master.content_id, platform });
  try {
    const rule = linkPolicy(platform);
    const limits = LIMITS[platform];
    const transform = TRANSFORM[platform][master.selected_format];
    const { links, cta, strategy } = linksFor(master, rule);
    const media = transform.media;
    const refs = assetRefs(master, platform, media);
    // A video/image format whose asset is missing (e.g. still in production) is not publishable.
    const missingMedia = media !== "none" && media !== "text" && refs.length === 0;
    const disclosure = master.affiliate_data && rule.disclosureRequired ? AFFILIATE_DISCLOSURE : null;
    const hashtags = master.hashtags.slice(0, limits.hashtags);
    const extra = master.disclosures.filter(item => item !== AFFILIATE_DISCLOSURE);
    let text: string;
    if (platform === "x") {
      // 280 characters, a link counts as 23 (t.co). Disclosure first, then hook, CTA/link, hashtags.
      const linkPart = links.length ? ` ${links[0]}` : "";
      const head = disclosure ? `${disclosure}: ` : "";
      const tail = `${cta ? ` ${cta}` : ""}${linkPart}${hashtags.length ? ` ${hashtags.join(" ")}` : ""}`;
      const budget = limits.text - head.length - (tail.length - linkPart.length + (linkPart ? 24 : 0));
      text = `${head}${cut(master.hook, Math.max(40, budget))}${tail}`;
    } else {
      const parts = [disclosure, master.hook, "", cut(master.body, platform === "facebook" ? 1500 : 900), "", cta + (links.length ? ` ${links[0]}` : ""),
        extra.length ? extra.join(" · ") : null, "", hashtags.join(" ")].filter((part): part is string => part !== null);
      text = cut(parts.join("\n").replace(/\n{3,}/g, "\n\n").trim(), limits.text);
    }
    const title = limits.title ? cut(`${master.hook}`, limits.title) : null;
    const publishable = !transform.skip && !missingMedia;
    const variant: PlatformVariant = { platform, title, text, links, assetRefs: refs, mediaFormat: media, disclosure, aspectRatio: transform.aspect, publishable,
      skipReason: transform.skip ?? (missingMedia ? "Medium noch nicht vorhanden" : null), hashtags, linkStrategy: strategy };
    emitEvent("platform_render_completed", { contentId: master.content_id, platform, media, publishable, strategy });
    return variant;
  } catch (error) {
    emitEvent("platform_render_failed", { contentId: master.content_id, platform, failure: error instanceof Error ? error.name : "unknown" }, "error");
    return { platform, title: null, text: "", links: [], assetRefs: [], mediaFormat: "none", disclosure: null, aspectRatio: null, publishable: false,
      skipReason: `Darstellung für ${PLATFORM_LABEL[platform]} fehlgeschlagen`, hashtags: [], linkStrategy: "kein_link" };
  }
}

// Adapter objects (one per platform) for registries and later extension.
export type PlatformAdapter = { platform: Platform; label: string; render(master: MasterContent): PlatformVariant };
const adapter = (platform: Platform): PlatformAdapter => ({ platform, label: PLATFORM_LABEL[platform], render: master => renderForPlatform(master, platform) });
export const InstagramAdapter = adapter("instagram");
export const FacebookAdapter = adapter("facebook");
export const TikTokAdapter = adapter("tiktok");
export const YouTubeAdapter = adapter("youtube");
export const XAdapter = adapter("x");
export const PLATFORM_ADAPTERS: PlatformAdapter[] = [InstagramAdapter, FacebookAdapter, TikTokAdapter, YouTubeAdapter, XAdapter];

import type { Platform } from "../formats/catalog";

// Central, configurable link strategy per platform. Adapters read it; nothing about links is decided elsewhere.
// Assumption-free defaults: links in Instagram/TikTok/YouTube Shorts captions are not reliably clickable, so those
// platforms point to the profile link (landing page) instead of putting a link in the text.

export type LinkRule = {
  directLinks: boolean;          // a URL in the post text is clickable
  profileLink: boolean;          // CTA refers to the link in the profile / bio
  affiliateInText: boolean;      // an affiliate URL may appear in the post text
  sourceLinks: boolean;          // news sources may be linked in the text
  disclosureRequired: boolean;   // affiliate posts need a visible "Werbung" label
  cta: { topic: string; affiliate: string };
};

const DEFAULTS: Record<Platform, LinkRule> = {
  instagram: { directLinks: false, profileLink: true, affiliateInText: false, sourceLinks: false, disclosureRequired: true,
    cta: { topic: "Speichern für später", affiliate: "Mehr dazu über den Link im Profil" } },
  facebook: { directLinks: true, profileLink: false, affiliateInText: true, sourceLinks: true, disclosureRequired: true,
    cta: { topic: "Teilen, wenn es hilft", affiliate: "Zum Produkt:" } },
  tiktok: { directLinks: false, profileLink: true, affiliateInText: false, sourceLinks: false, disclosureRequired: true,
    cta: { topic: "Folgen für mehr Alltagstipps", affiliate: "Link im Profil" } },
  youtube: { directLinks: false, profileLink: true, affiliateInText: false, sourceLinks: false, disclosureRequired: true,
    cta: { topic: "Abonnieren für mehr Alltagstipps", affiliate: "Link im Kanal" } },
  x: { directLinks: true, profileLink: false, affiliateInText: true, sourceLinks: true, disclosureRequired: true,
    cta: { topic: "", affiliate: "Zum Produkt:" } },
};

// Optional override: TOPIC_LINK_POLICY='{"instagram":{"directLinks":true}}' (validated; unknown keys ignored).
export function linkPolicy(platform: Platform): LinkRule {
  const base = DEFAULTS[platform];
  try {
    const raw = process.env.TOPIC_LINK_POLICY ? JSON.parse(process.env.TOPIC_LINK_POLICY) : null;
    const patch = raw && typeof raw === "object" ? raw[platform] : null;
    if (!patch || typeof patch !== "object") return base;
    const bool = (key: keyof LinkRule) => typeof patch[key] === "boolean" ? patch[key] : base[key];
    return { ...base, directLinks: bool("directLinks") as boolean, profileLink: bool("profileLink") as boolean, affiliateInText: bool("affiliateInText") as boolean,
      sourceLinks: bool("sourceLinks") as boolean, disclosureRequired: true /* never configurable off */ };
  } catch { return base; }
}

// Landing page used as the profile link target (existing /produkte page). Only https URLs are accepted.
export function landingPageUrl(): string | null {
  const value = process.env.TOPIC_LANDING_URL?.trim();
  return value && /^https:\/\/[^\s]+$/.test(value) ? value : null;
}

// Pure catalog of the producible content formats. No provider code here: the topic scout may import this
// to *recommend* a format; only the format router decides and only the visual engine produces.

export const CONTENT_FORMATS = ["TEXT", "SINGLE_IMAGE", "CAROUSEL", "STANDARD_VIDEO", "AVATAR_VIDEO"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

// Relative production cost classes (not euro amounts). Used to prefer the cheaper format at comparable value.
export const COST_CLASS: Record<ContentFormat, { label: string; units: number }> = {
  TEXT: { label: "sehr niedrig", units: 1 },
  SINGLE_IMAGE: { label: "niedrig", units: 2 },
  CAROUSEL: { label: "niedrig bis mittel", units: 4 },
  STANDARD_VIDEO: { label: "mittel", units: 7 },
  AVATAR_VIDEO: { label: "mittel bis hoch", units: 10 },
};

export const FORMAT_LABEL: Record<ContentFormat, string> = {
  TEXT: "Text", SINGLE_IMAGE: "Einzelbild", CAROUSEL: "Karussell", STANDARD_VIDEO: "Video", AVATAR_VIDEO: "Avatar-Video",
};

// Degradation order when a format cannot be produced (provider down, quota, budget). Never escalates in cost.
export const FALLBACK_CHAIN: Record<ContentFormat, ContentFormat[]> = {
  AVATAR_VIDEO: ["STANDARD_VIDEO", "CAROUSEL", "SINGLE_IMAGE", "TEXT"],
  STANDARD_VIDEO: ["CAROUSEL", "SINGLE_IMAGE", "TEXT"],
  CAROUSEL: ["SINGLE_IMAGE", "TEXT"],
  SINGLE_IMAGE: ["TEXT"],
  TEXT: [],
};

export const PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts", x: "X" };

export const CAROUSEL_MIN_SLIDES = 3;
export const CAROUSEL_MAX_SLIDES = 7;

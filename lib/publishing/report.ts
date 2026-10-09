// Architecture: this module makes NO decisions. It does not decide whether, where or what is published, does not
// retry, does not classify content and does not judge links. It only collects the outcomes the existing routers
// and adapters already determined (category, format, per-platform status, platform-returned URL), normalizes them
// and formats one consistent orchestrator WhatsApp message. Decisions stay with the routers, adapters and the
// approval gate.
//
// Structured WhatsApp feedback after every publish. Always two separate classifications in the headline:
// content category (Themen-Post | Affiliate-Post) and content format (Bild | Karussell | Video | Text).
// Below: one line per platform that is really live (name, status, direct link), then the platforms that are not.
// A link is shown only if it is a post URL on the platform's own domain as returned by the platform API;
// otherwise "Link nicht verfügbar". Nothing is guessed or constructed.

export type ContentCategory = "topic" | "affiliate";
export type ReportFormat = "TEXT" | "SINGLE_IMAGE" | "CAROUSEL" | "STANDARD_VIDEO" | "AVATAR_VIDEO";
export type PlatformOutcomeStatus = "published" | "failed" | "unknown" | "processing" | "blocked" | "skipped";
export type PlatformOutcome = { platform: string; status: PlatformOutcomeStatus; url?: string | null; detail?: string | null };

export const CATEGORY_LABEL: Record<ContentCategory, string> = { topic: "Themen-Post", affiliate: "Affiliate-Post" };
export const REPORT_FORMAT_LABEL: Record<ReportFormat, string> = { TEXT: "Text", SINGLE_IMAGE: "Bild", CAROUSEL: "Karussell", STANDARD_VIDEO: "Video", AVATAR_VIDEO: "Video (Avatar)" };
const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts", x: "X" };
const POST_HOSTS: Record<string, string[]> = {
  instagram: ["instagram.com"], facebook: ["facebook.com", "fb.com", "fb.watch"], tiktok: ["tiktok.com"], youtube: ["youtube.com", "youtu.be"], x: ["x.com", "twitter.com"],
};
const STATUS_LABEL: Record<PlatformOutcomeStatus, string> = {
  published: "veröffentlicht", failed: "fehlgeschlagen", unknown: "Ergebnis unklar – bitte auf der Plattform prüfen, es wird nicht erneut gepostet",
  processing: "wird noch verarbeitet, noch nicht live", blocked: "blockiert (keine gültige Freigabe für diese Fassung)", skipped: "nicht veröffentlicht",
};

// Only an https URL on the platform's own domain, without credentials, with a real path (not just the homepage).
export function reliablePostUrl(platform: string, url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
    const allowed = POST_HOSTS[platform] ?? [];
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname.length < 2) return null;
    return allowed.some(domain => host === domain || host.endsWith(`.${domain}`)) ? parsed.toString() : null;
  } catch { return null; }
}

export function publishHeadline(category: ContentCategory, format: ReportFormat, outcomes: PlatformOutcome[]) {
  const live = outcomes.filter(item => item.status === "published").length;
  const state = live && live === outcomes.length ? "veröffentlicht" : live ? "teilweise veröffentlicht"
    : outcomes.some(item => item.status === "processing" || item.status === "unknown") ? "noch nicht bestätigt veröffentlicht" : "nicht veröffentlicht";
  return `${CATEGORY_LABEL[category]}, ${REPORT_FORMAT_LABEL[format]} ${state}`;
}

export function formatPublishReport(input: { category: ContentCategory; format: ReportFormat; outcomes: PlatformOutcome[]; note?: string | null }) {
  const name = (platform: string) => PLATFORM_NAME[platform] ?? platform;
  const clean = (detail: string | null | undefined) => detail ? ` (${detail.replace(/https?:\/\/\S+/g, "[URL]").replace(/\s+/g, " ").slice(0, 120)})` : "";
  const live = input.outcomes.filter(item => item.status === "published");
  const notLive = input.outcomes.filter(item => item.status !== "published");
  const lines = [publishHeadline(input.category, input.format, input.outcomes)];
  if (live.length) {
    lines.push("", notLive.length ? "Erfolgreich (live):" : "Live:");
    for (const item of live) lines.push(`• ${name(item.platform)} – veröffentlicht – ${reliablePostUrl(item.platform, item.url) ?? "Link nicht verfügbar"}`);
  }
  if (notLive.length) {
    lines.push("", live.length ? "Nicht erfolgreich (nicht live):" : "Nicht live:");
    for (const item of notLive) lines.push(`• ${name(item.platform)} – ${STATUS_LABEL[item.status]}${item.status === "failed" || item.status === "blocked" ? clean(item.detail) : ""}`);
  }
  if (input.note?.trim()) lines.push("", input.note.trim());
  return lines.join("\n");
}

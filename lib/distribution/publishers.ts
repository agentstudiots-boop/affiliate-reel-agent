import { FacebookPublishFailure, publishFacebookPhoto } from "../meta/publisher";
import type { Platform } from "../formats/catalog";
import { PlatformPublishError, type PlatformPublisher } from "./publish";

// Live publishers for the topic pipeline. Only reuse of an existing, tested API is implemented (Facebook photo via
// lib/meta/publisher.ts). All other platforms have complete adapters and dry runs, but no live API client yet:
// their publisher reports the missing access instead of guessing an integration.

export const facebookPhotoPublisher = (publish: typeof publishFacebookPhoto = publishFacebookPhoto): PlatformPublisher => ({
  platform: "facebook",
  configured() {
    const missing = [!process.env.META_SYSTEM_USER_TOKEN && !process.env.META_PAGE_ACCESS_TOKEN && "META_SYSTEM_USER_TOKEN oder META_PAGE_ACCESS_TOKEN", !process.env.META_PAGE_ID && "META_PAGE_ID"].filter(Boolean) as string[];
    return { ok: !missing.length, missing };
  },
  supports: variant => variant.mediaFormat === "image" && variant.assetRefs.length === 1,
  async publish(variant, master) {
    const asset = master.assets.find(item => item.role === variant.assetRefs[0]);
    if (!asset?.url || asset.mediaType !== "image/png") throw new PlatformPublishError(true, "Bild nicht als PNG im Blob-Store vorhanden");
    try {
      const posted = await publish(asset.url, variant.text);
      return { externalId: posted.id, url: posted.permalink };
    } catch (error) {
      // Only a definite Graph 4xx rejection means nothing was published.
      const definite = error instanceof FacebookPublishFailure && (error.phase === "image" || error.phase === "connection" || (error.httpStatus >= 400 && error.httpStatus < 500));
      throw new PlatformPublishError(definite, error instanceof FacebookPublishFailure ? `${error.phase}:${error.detail}` : "Ergebnis unklar");
    }
  },
});

// Required access per platform that has no live client yet (documented as PENDING_USER_INPUT).
export const MISSING_LIVE_ACCESS: Record<Exclude<Platform, "facebook">, string[]> = {
  instagram: ["Instagram-Publisher für Karussell/Reel der Themen-Pipeline (META_INSTAGRAM_USER_ID vorhanden, Client noch nicht angebunden)"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN (Content Posting API, App-Prüfung)"],
  youtube: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN (YouTube Data API v3, Upload-Scope)"],
  x: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET (X API mit Schreibrechten)"],
};

const unavailable = (platform: Exclude<Platform, "facebook">): PlatformPublisher => ({
  platform,
  configured: () => ({ ok: false, missing: MISSING_LIVE_ACCESS[platform] }),
  supports: () => false,
  async publish() { throw new PlatformPublishError(true, "Kein Live-Client"); },
});

export function defaultPublishers(): PlatformPublisher[] {
  return [facebookPhotoPublisher(), unavailable("instagram"), unavailable("tiktok"), unavailable("youtube"), unavailable("x")];
}

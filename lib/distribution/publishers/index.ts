import type { PlatformPublisher } from "../publish";
import { facebookPublisher, instagramPublisher } from "./meta";
import type { LegacyAffiliateDeps } from "./legacy-affiliate";
import { tiktokPublisher } from "./tiktok";
import { xPublisher } from "./x";
import { youtubePublisher } from "./youtube";

// All five platform publishers. Constructing them makes no network call; every live call needs the publish gate's
// permit, TOPIC_LIVE_PUBLISHING=true, the platform in TOPIC_PLATFORMS and its credentials. Topic and affiliate posts use
// this same set; `affiliate` only injects the product pipeline's record access (tests, request-scoped database).
export function defaultPublishers(affiliate: LegacyAffiliateDeps = {}): PlatformPublisher[] {
  return [instagramPublisher({ affiliate }), facebookPublisher({ affiliate }), tiktokPublisher(), youtubePublisher(), xPublisher()];
}

export type { LegacyAffiliateDeps };
export { facebookPublisher, instagramPublisher, tiktokPublisher, xPublisher, youtubePublisher };

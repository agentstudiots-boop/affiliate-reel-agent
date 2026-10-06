import type { PlatformPublisher } from "../publish";
import { facebookPublisher, instagramPublisher } from "./meta";
import { tiktokPublisher } from "./tiktok";
import { xPublisher } from "./x";
import { youtubePublisher } from "./youtube";

// All five platform publishers. Constructing them makes no network call; every live call needs the publish gate's
// permit, TOPIC_LIVE_PUBLISHING=true, the platform in TOPIC_PLATFORMS and its credentials.
export function defaultPublishers(): PlatformPublisher[] {
  return [instagramPublisher(), facebookPublisher(), tiktokPublisher(), youtubePublisher(), xPublisher()];
}

export { facebookPublisher, instagramPublisher, tiktokPublisher, xPublisher, youtubePublisher };

import type { ProviderAvailability } from "../formats/router";
import { avatarQuotaRemaining, type RenderContext } from "./renderers";

// Translates the configured providers (and the local HeyGen quota counter) into plain data for the format router.
// The router itself never imports providers.
export async function providerAvailability(context: RenderContext, now = new Date()): Promise<ProviderAvailability> {
  const image = context.imageProvider ? context.imageProvider.available() : { ok: false, reason: "kein Bildprovider" };
  const standard = context.standardVideoProvider ? context.standardVideoProvider.available() : { ok: false, reason: "kein Video-Provider" };
  const avatar = context.avatarProvider ? context.avatarProvider.available() : { ok: false, reason: "kein Avatar-Provider" };
  let quotaRemaining: number | null = null;
  if (avatar.ok && context.avatarQuota) {
    try { quotaRemaining = await avatarQuotaRemaining(context.avatarQuota, context.avatarProvider!.name, now); }
    catch { quotaRemaining = 0; } // unreadable counter: treat as exhausted, never spend blindly
  }
  return {
    image: { available: image.ok, reason: image.reason },
    standardVideo: { available: standard.ok, reason: standard.reason },
    avatarVideo: { available: avatar.ok && !!context.avatarQuota, quotaRemaining, reason: avatar.ok && !context.avatarQuota ? "Avatar-Kontingent nicht konfiguriert" : avatar.reason },
  };
}

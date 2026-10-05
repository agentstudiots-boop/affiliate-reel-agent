import type { Database } from "../memory/db";
import type { Platform } from "../formats/catalog";
import { emitEvent } from "../observability/events";
import { assertPermitMatches, authorizePublish, completePublishAttempt, previewPublish, PublishBlockedError, type PublishableContent, type PublishPermit } from "../publishing/approval-gate";
import type { PlatformOutcome } from "../publishing/report";
import type { MasterContent } from "./master-content";
import type { PlatformVariant } from "./platforms/adapters";

// Multi-platform publishing. Every platform runs isolated; one platform failing never stops the others.
// Every live attempt passes the central approval gate (authorizePublish + assertPermitMatches). Live publishing is
// additionally switched off unless TOPIC_LIVE_PUBLISHING=true; the default is a dry run.

export type PublisherResult = { externalId: string; url: string | null };
export class PlatformPublishError extends Error {
  // definite: the platform rejected the request (nothing published) → a later retry of the same approved version is allowed.
  constructor(public readonly definite: boolean, public readonly detail: string) { super(`platform_publish_${definite ? "rejected" : "unknown"}`); this.name = "PlatformPublishError"; }
}
export interface PlatformPublisher {
  readonly platform: Platform;
  configured(): { ok: boolean; missing: string[] };
  supports(variant: PlatformVariant): boolean;
  publish(variant: PlatformVariant, master: MasterContent, permit: PublishPermit): Promise<PublisherResult>;
}

export function publishableContent(master: MasterContent, variants: PlatformVariant[]): PublishableContent {
  return {
    contentId: master.content_id, hook: master.hook, caption: master.caption, body: master.body, cta: master.cta,
    links: [...new Set([...(master.affiliate_data ? [master.affiliate_data.affiliateUrl] : []), ...variants.flatMap(variant => variant.links)])].sort(),
    assets: master.assets.map(asset => ({ role: asset.role, kind: asset.kind, url: asset.url, sha256: asset.sha256 })),
    disclosures: master.disclosures,
    variants: variants.filter(variant => variant.publishable).map(variant => ({ platform: variant.platform, title: variant.title, text: variant.text, links: variant.links,
      assetRefs: variant.assetRefs, mediaFormat: variant.mediaFormat, disclosure: variant.disclosure })),
  };
}

export const liveTopicPublishingEnabled = () => process.env.TOPIC_LIVE_PUBLISHING === "true";

export type PublishPlanEntry = { platform: Platform; publishable: boolean; mediaFormat: string; linkStrategy: string; links: string[]; wouldPublish: boolean; reason: string };
export type PublishRun = { dryRun: boolean; outcomes: PlatformOutcome[]; plan: PublishPlanEntry[] };

export async function publishAll(db: Database, input: { master: MasterContent; variants: PlatformVariant[]; publishers: PlatformPublisher[]; origin: string; dryRun?: boolean }): Promise<PublishRun> {
  const content = publishableContent(input.master, input.variants);
  const dryRun = input.dryRun ?? !liveTopicPublishingEnabled();
  const outcomes: PlatformOutcome[] = [];
  const plan: PublishPlanEntry[] = [];
  for (const variant of input.variants) {
    const base = { platform: variant.platform, publishable: variant.publishable, mediaFormat: variant.mediaFormat, linkStrategy: variant.linkStrategy, links: variant.links };
    if (!variant.publishable) {
      plan.push({ ...base, wouldPublish: false, reason: variant.skipReason ?? "nicht veröffentlichbar" });
      emitEvent("platform_publish_skipped", { contentId: content.contentId, platform: variant.platform, reason: variant.skipReason });
      continue; // a deliberately skipped platform (e.g. carousel on YouTube) is not a failed one
    }
    const publisher = input.publishers.find(item => item.platform === variant.platform);
    if (dryRun) {
      const gate = await previewPublish(db, content, variant.platform).catch(() => ({ allowed: false, reason: "no_content_version" as const }));
      const missing = !publisher ? ["Publisher fehlt"] : publisher.configured().missing;
      plan.push({ ...base, wouldPublish: gate.allowed && !missing.length, reason: !gate.allowed ? `Freigabe: ${gate.reason}` : missing.length ? `Zugang fehlt: ${missing.join(", ")}` : "würde live veröffentlicht" });
      continue;
    }
    try {
      if (!publisher) throw new PlatformPublishError(true, "Kein Publisher für diese Plattform eingerichtet");
      const configured = publisher.configured();
      if (!configured.ok) throw new PlatformPublishError(true, `Zugangsdaten fehlen: ${configured.missing.join(", ")}`);
      if (!publisher.supports(variant)) throw new PlatformPublishError(true, `Format ${variant.mediaFormat} wird live noch nicht unterstützt`);
      const permit = await authorizePublish(db, { content, platform: variant.platform, origin: input.origin });
      try {
        assertPermitMatches(permit, content, variant.platform);
        const result = await publisher.publish(variant, input.master, permit);
        await completePublishAttempt(db, permit, "published", { externalId: result.externalId });
        emitEvent("platform_publish_completed", { contentId: content.contentId, platform: variant.platform, hasUrl: !!result.url });
        outcomes.push({ platform: variant.platform, status: "published", url: result.url });
      } catch (error) {
        const definite = error instanceof PlatformPublishError ? error.definite : error instanceof PublishBlockedError;
        await completePublishAttempt(db, permit, definite ? "failed" : "unknown", { reason: error instanceof Error ? error.message : "unknown" });
        throw error;
      }
    } catch (error) {
      const blocked = error instanceof PublishBlockedError;
      const definite = blocked || (error instanceof PlatformPublishError && error.definite);
      const detail = error instanceof PlatformPublishError ? error.detail : blocked ? error.reason : "Ergebnis unklar";
      emitEvent("platform_publish_failed", { contentId: content.contentId, platform: variant.platform, blocked, definite, detail }, "warn");
      outcomes.push({ platform: variant.platform, status: blocked ? "blocked" : definite ? "failed" : "unknown", detail });
    }
  }
  return { dryRun, outcomes, plan };
}

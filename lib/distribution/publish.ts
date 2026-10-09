import type { Database } from "../memory/db";
import type { Platform } from "../formats/catalog";
import { emitEvent } from "../observability/events";
import { assertPermitMatches, authorizePublish, completePublishAttempt, openAttempts, platformAttempt, previewPublish, PublishBlockedError, recordRemoteId, settleAttempt, type PublishableContent, type PublishPermit } from "../publishing/approval-gate";
import { livePublishCapability, liveSwitchOn, type ContentOrigin } from "../capabilities";
import type { PlatformOutcome } from "../publishing/report";
import type { MasterContent } from "./master-content";
import type { PlatformVariant } from "./platforms/adapters";

// Multi-platform publishing. Every platform runs isolated; one platform failing never stops the others.
// Every live attempt passes the central approval gate (authorizePublish + assertPermitMatches). Live publishing is
// additionally switched off unless TOPIC_LIVE_PUBLISHING=true; the default is a dry run.

// Contract of every platform publisher. Upload/preparation, publish and status are separate steps inside each
// adapter; the remote id of every created object is reported immediately (onRemoteId) so an interrupted publish can
// be reconciled by status() instead of being repeated.
export type PublisherResult = { state: "published" | "processing"; externalId: string; url: string | null };
export type RemoteStatus = { state: "published" | "processing" | "failed" | "unknown"; externalId?: string; url?: string | null; detail?: string };
export type PublishContext = { permit: PublishPermit; onRemoteId: (remoteId: string) => Promise<void> };
export class PlatformPublishError extends Error {
  // definite: the platform rejected the request (nothing published) → a later retry of the same approved version is allowed.
  // Not definite: the result is unknown (maybe published) → never retried automatically.
  constructor(public readonly definite: boolean, public readonly detail: string, public readonly httpStatus = 0) { super(`platform_publish_${definite ? "rejected" : "unknown"}`); this.name = "PlatformPublishError"; }
}
export interface PlatformPublisher {
  readonly platform: Platform;
  configured(): { ok: boolean; missing: string[] };
  supports(variant: PlatformVariant): boolean;
  publish(variant: PlatformVariant, master: MasterContent, context: PublishContext): Promise<PublisherResult>;
  status?(remoteId: string): Promise<RemoteStatus>;
}

// Affiliate posts of the product pipeline carry a source_ref to their approved record; everything else is a topic post.
export const contentOrigin = (master: MasterContent): ContentOrigin => master.source_ref ? "product_pipeline" : "topic_pipeline";

export function publishableContent(master: MasterContent, variants: PlatformVariant[]): PublishableContent {
  return {
    contentId: master.content_id, ...(master.source_ref ? { origin: contentOrigin(master) } : {}), hook: master.hook, caption: master.caption, body: master.body, cta: master.cta,
    links: [...new Set([...(master.affiliate_data ? [master.affiliate_data.affiliateUrl] : []), ...variants.flatMap(variant => variant.links)])].sort(),
    assets: master.assets.map(asset => ({ role: asset.role, kind: asset.kind, url: asset.url, sha256: asset.sha256 })),
    disclosures: master.disclosures,
    variants: variants.filter(variant => variant.publishable).map(variant => ({ platform: variant.platform, title: variant.title, text: variant.text, links: variant.links,
      assetRefs: variant.assetRefs, mediaFormat: variant.mediaFormat, disclosure: variant.disclosure })),
  };
}

export const liveTopicPublishingEnabled = () => liveSwitchOn();

export type PublishPlanEntry = { platform: Platform; publishable: boolean; mediaFormat: string; linkStrategy: string; links: string[]; wouldPublish: boolean; reason: string };
export type PublishOutcome = PlatformOutcome & { externalId?: string | null; reused?: boolean; blockReason?: string };
export type PublishRun = { dryRun: boolean; outcomes: PublishOutcome[]; plan: PublishPlanEntry[] };

const GATE_REASON: Record<string, string> = {
  approval_pending: "Freigabe steht aus", no_content_version: "keine registrierte Fassung", approval_rejected: "abgelehnt", changes_requested: "Änderung gewünscht",
  approval_invalidated: "Freigabe ungültig (Inhalt geändert)", content_changed_since_approval: "Inhalt nach Freigabe geändert", already_attempted: "bereits veröffentlicht/versucht",
  live_publishing_disabled: "Live-Veröffentlichung aus (TOPIC_LIVE_PUBLISHING)", platform_not_enabled: "Plattform nicht aktiviert (TOPIC_PLATFORMS)", credentials_missing: "Zugangsdaten fehlen",
  platform_not_in_approved_version: "nicht Teil der freigegebenen Fassung", authority_inactive: "keine aktive Freigabeinstanz", approved: "würde live veröffentlicht",
};

// Publishes every publishable variant, each platform fully isolated. Results are stored per platform in
// publish_attempts (status, remote ids, external id, link). Platforms already published, still processing or with an
// unclear result for this version are never published again; only definitely failed platforms can be retried
// (pass `only` to retry exactly those). Dry run is the default unless TOPIC_LIVE_PUBLISHING=true.
export async function publishAll(db: Database, input: { master: MasterContent; variants: PlatformVariant[]; publishers: PlatformPublisher[]; origin: string;
  dryRun?: boolean; only?: Platform[] }): Promise<PublishRun> {
  const content = publishableContent(input.master, input.variants);
  const origin = contentOrigin(input.master);
  // A caller can only make the run safer: dryRun=false never overrides a switched-off live switch.
  // Topic posts: the whole run is live only with TOPIC_LIVE_PUBLISHING=true. Affiliate posts additionally keep their
  // existing live channels (Facebook/Instagram after the product pipeline's own approval); every other platform of an
  // affiliate post follows the topic rules. The decision is made per platform by the same capability check the gate uses.
  const switchOn = liveTopicPublishingEnabled();
  const runLive = input.dryRun !== true && (switchOn || origin === "product_pipeline");
  const liveFor = (platform: Platform) => runLive && (switchOn || livePublishCapability(platform, process.env, origin).ok);
  let liveAttempts = 0;
  const outcomes: PublishOutcome[] = [];
  const plan: PublishPlanEntry[] = [];
  for (const variant of input.variants) {
    if (input.only && !input.only.includes(variant.platform)) continue;
    const base = { platform: variant.platform, publishable: variant.publishable, mediaFormat: variant.mediaFormat, linkStrategy: variant.linkStrategy, links: variant.links };
    if (!variant.publishable) {
      plan.push({ ...base, wouldPublish: false, reason: variant.skipReason ?? "nicht veröffentlichbar" });
      emitEvent("platform_publish_skipped", { contentId: content.contentId, platform: variant.platform, reason: variant.skipReason });
      continue; // a deliberately skipped platform (e.g. carousel on YouTube) is not a failed one
    }
    const publisher = input.publishers.find(item => item.platform === variant.platform);
    if (!liveFor(variant.platform)) {
      const gate = await previewPublish(db, content, variant.platform).catch(() => ({ allowed: false, reason: "no_content_version" as const }));
      const capability = livePublishCapability(variant.platform, process.env, origin);
      const missing = capability.ok ? [] : capability.missing;
      const supported = publisher ? publisher.supports(variant) : false;
      const reason = !supported ? `Format ${variant.mediaFormat} vom Publisher nicht unterstützt` : missing.length ? `Zugang fehlt: ${missing.join(", ")}`
        : !gate.allowed ? `Freigabe/Schalter: ${GATE_REASON[gate.reason] ?? gate.reason}` : "würde live veröffentlicht";
      plan.push({ ...base, wouldPublish: gate.allowed && supported && !missing.length, reason });
      continue;
    }
    liveAttempts++;
    // Already handled for this version? Report the stored result, never publish twice.
    const existing = await platformAttempt(db, content.contentId, variant.platform).catch(() => null);
    if (existing && ["published", "processing", "unknown", "claimed"].includes(existing.status)) {
      outcomes.push({ platform: variant.platform, status: existing.status === "claimed" ? "unknown" : existing.status as PublishOutcome["status"], url: existing.url, externalId: existing.externalId, reused: true,
        detail: existing.status === "unknown" ? "Ergebnis unklar; nicht erneut gepostet" : null });
      continue;
    }
    let permit: PublishPermit | null = null;
    try {
      if (!publisher) throw new PlatformPublishError(true, "Kein Publisher für diese Plattform eingerichtet");
      permit = await authorizePublish(db, { content, platform: variant.platform, origin: input.origin });
      if (!publisher.supports(variant)) throw new PlatformPublishError(true, `Format ${variant.mediaFormat} wird live nicht unterstützt`);
      assertPermitMatches(permit, content, variant.platform);
      const claimed = permit;
      const result = await publisher.publish(variant, input.master, { permit: claimed, onRemoteId: remoteId => recordRemoteId(db, claimed, remoteId) });
      await completePublishAttempt(db, claimed, result.state, { externalId: result.externalId, url: result.state === "published" ? result.url : null });
      emitEvent(result.state === "published" ? "platform_publish_completed" : "platform_publish_started", { contentId: content.contentId, platform: variant.platform, state: result.state, hasUrl: !!result.url });
      outcomes.push({ platform: variant.platform, status: result.state, url: result.state === "published" ? result.url : null, externalId: result.externalId });
    } catch (error) {
      const blocked = error instanceof PublishBlockedError;
      const definite = blocked || (error instanceof PlatformPublishError && error.definite);
      const detail = error instanceof PlatformPublishError ? error.detail : blocked ? GATE_REASON[error.reason] ?? error.reason : "Ergebnis unklar";
      if (permit) await completePublishAttempt(db, permit, definite ? "failed" : "unknown", { reason: detail }).catch(() => undefined);
      emitEvent("platform_publish_failed", { contentId: content.contentId, platform: variant.platform, blocked, definite, detail }, "warn");
      outcomes.push({ platform: variant.platform, status: blocked ? "blocked" : definite ? "failed" : "unknown", detail, ...(blocked ? { blockReason: error.reason } : {}) });
    }
  }
  return { dryRun: origin === "product_pipeline" ? liveAttempts === 0 : !runLive, outcomes, plan };
}

// Asks the platforms about attempts that are still processing (or unclear but with a remote id). Never publishes
// anew; it only completes what the platform confirms. Each platform isolated.
export async function reconcilePublishing(db: Database, publishers: PlatformPublisher[]) {
  const settled: { contentId: string; platform: string; status: string }[] = [];
  for (const attempt of await openAttempts(db)) {
    const publisher = publishers.find(item => item.platform === attempt.platform);
    const remoteId = attempt.externalId ?? attempt.remoteIds.at(-1);
    const origin: ContentOrigin = attempt.origin === "product_pipeline" ? "product_pipeline" : "topic_pipeline";
    if (!publisher?.status || !remoteId || !livePublishCapability(attempt.platform, process.env, origin).ok) continue;
    try {
      const status = await publisher.status(remoteId);
      if (status.state === "processing" || (status.state === "unknown" && attempt.status === "unknown")) continue;
      // A previously unclear attempt becomes published only on confirmation; "failed" never re-opens a claim on its own.
      await settleAttempt(db, attempt.id, status.state === "published" ? "published" : status.state === "unknown" || attempt.status === "unknown" ? "unknown" : "failed",
        { externalId: status.externalId, url: status.url ?? null, reason: status.detail });
      settled.push({ contentId: attempt.contentId, platform: attempt.platform, status: status.state });
      emitEvent(status.state === "published" ? "platform_publish_completed" : "platform_publish_failed", { contentId: attempt.contentId, platform: attempt.platform, via: "reconcile" });
    } catch { emitEvent("platform_publish_failed", { contentId: attempt.contentId, platform: attempt.platform, via: "reconcile", detail: "status_unavailable" }, "warn"); }
  }
  return settled;
}

// Per-platform result of the latest version, for reports after retries or reconciliation.
export async function storedOutcomes(db: Database, master: MasterContent, variants: PlatformVariant[]): Promise<PublishOutcome[]> {
  const outcomes: PublishOutcome[] = [];
  for (const variant of variants.filter(item => item.publishable)) {
    const attempt = await platformAttempt(db, master.content_id, variant.platform);
    if (!attempt) continue;
    const status = attempt.status === "claimed" ? "unknown" : attempt.status as PublishOutcome["status"];
    outcomes.push({ platform: variant.platform, status, url: attempt.url, externalId: attempt.externalId, detail: attempt.reason });
  }
  return outcomes;
}

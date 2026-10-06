import { getDatabase, type Database } from "../../memory/db";
import { publicationRepository } from "../../meta/publication-gate";
import { publishFacebookPhoto } from "../../meta/publisher";
import { publishInstagramImage } from "../../meta/instagram-image";
import { instagramReelRepository } from "../../meta/instagram-reel";
import { advanceInstagram } from "../../meta/advance-instagram";
import type { MasterContent } from "../master-content";
import type { PlatformVariant } from "../platforms/adapters";
import { PlatformPublishError, type PublisherResult, type RemoteStatus } from "../publish";

// Affiliate posts of the existing product pipeline inside the shared Facebook/Instagram publishers.
//
// The product pipeline keeps its own approved records (publication_requests, instagram_image_posts) with their claims,
// caption checks and "never repeat an unclear result" rules. These steps are reused unchanged as the platform-specific
// upload/publish part of the shared publishers; the decision whether a platform may publish at all is made beforehand
// by the shared multi-publisher and the central approval gate, exactly as for topic posts.

type FacebookRecord = { id: string; imageUrl: string | null; caption: string };
export type LegacyAffiliateDeps = {
  db?: () => Database;
  publications?: () => { claimPublish(id: string): Promise<FacebookRecord>; published(id: string, postId: string, permalink: string): Promise<unknown>; markUnknown(id: string): Promise<unknown> };
  photo?: (imageUrl: string, caption: string) => Promise<{ id: string; permalink: string }>;
  instagramImage?: (publicationId: string) => Promise<{ status: string; detail?: string; permalink?: string | null }>;
  reel?: (jobId: string) => Promise<unknown>;
  reels?: () => { get(jobId: string): Promise<{ status: string; mediaId: string | null; permalink: string | null } | null> };
};

const database = (deps: LegacyAffiliateDeps) => deps.db ? deps.db() : getDatabase();
const reelRepository = (deps: LegacyAffiliateDeps) => deps.reels ? deps.reels() : instagramReelRepository(database(deps));

// Facebook photo of an approved affiliate image post: claim the approved record, post exactly the approved caption and
// image, persist. Any error after the claim leaves the record "unknown" and is never retried (existing rule).
export async function legacyFacebookPublish(master: MasterContent, deps: LegacyAffiliateDeps): Promise<PublisherResult> {
  const ref = master.source_ref;
  if (ref?.kind !== "facebook_publication") throw new PlatformPublishError(true, "Kein Facebook-Bildauftrag der Produkt-Pipeline");
  const repo = deps.publications ? deps.publications() : publicationRepository(database(deps));
  const photo = deps.photo ?? publishFacebookPhoto;
  let claimed: FacebookRecord;
  try { claimed = await repo.claimPublish(ref.publicationId); }
  catch (error) { throw new PlatformPublishError(true, `Produkt-Freigabe nicht beanspruchbar: ${error instanceof Error ? error.message.slice(0, 120) : "unbekannt"}`); }
  try {
    const posted = await photo(claimed.imageUrl!, claimed.caption);
    await repo.published(claimed.id, posted.id, posted.permalink);
    return { state: "published", externalId: posted.id, url: posted.permalink };
  } catch {
    await repo.markUnknown(claimed.id).catch(() => undefined);
    throw new PlatformPublishError(false, "Ergebnis unklar; nicht erneut gepostet");
  }
}

// Instagram for affiliate posts: feed image under the same approval, or the separately approved Reel (container step;
// the existing continuation polls and publishes it once).
export async function legacyInstagramPublish(master: MasterContent, variant: PlatformVariant, deps: LegacyAffiliateDeps): Promise<PublisherResult> {
  const ref = master.source_ref!;
  if (ref.kind === "facebook_publication") {
    if (variant.mediaFormat !== "image") throw new PlatformPublishError(true, `Format ${variant.mediaFormat} für diesen Auftrag nicht vorgesehen`);
    const run = deps.instagramImage ?? ((id: string) => publishInstagramImage(id, { db: database(deps), send: async () => "report_via_distribution" }));
    let result: { status: string; detail?: string; permalink?: string | null };
    try { result = await run(ref.publicationId); }
    catch { throw new PlatformPublishError(true, "Instagram-Auftrag nicht gestartet"); }
    if (result.status === "skipped") {
      // An earlier Instagram attempt of this record exists: report its stored result, never start a second one.
      const earlier = await legacyInstagramStatus(`legacy-ig:${ref.publicationId}`, deps).catch(() => null);
      if (earlier?.state === "published") return { state: "published", externalId: earlier.externalId ?? `legacy-ig:${ref.publicationId}`, url: earlier.url ?? null };
      if (earlier?.state === "failed") throw new PlatformPublishError(true, "Instagram hat abgelehnt; kein zweiter Versuch");
      const exists = await database(deps).query("SELECT 1 FROM instagram_image_posts WHERE publication_id=$1", [ref.publicationId]).then(rows => rows.rows.length > 0, () => true);
      if (!exists) throw new PlatformPublishError(true, "Keine gültige Produkt-Freigabe für Instagram");
    }
    if (result.status === "published") return { state: "published", externalId: `legacy-ig:${ref.publicationId}`, url: result.permalink ?? null };
    if (result.status === "processing") return { state: "processing", externalId: `legacy-ig:${ref.publicationId}`, url: null };
    if (result.status === "failed") throw new PlatformPublishError(true, result.detail ?? "Instagram hat abgelehnt");
    throw new PlatformPublishError(false, result.status === "skipped" ? "Instagram-Versuch existiert bereits; nicht erneut gestartet" : "Ergebnis unklar; nicht erneut gepostet");
  }
  if (variant.mediaFormat !== "reel") throw new PlatformPublishError(true, `Format ${variant.mediaFormat} für diesen Auftrag nicht vorgesehen`);
  const reels = reelRepository(deps);
  const advance = deps.reel ?? ((jobId: string) => advanceInstagram(jobId, "publish", instagramReelRepository(database(deps))));
  try { await advance(ref.jobId); }
  catch {
    // The existing step marks the Reel "unknown" once a container write may have happened; before that nothing is visible.
    const current = await reels.get(ref.jobId).catch(() => null);
    throw new PlatformPublishError(current?.status !== "unknown", current?.status === "unknown" ? "Ergebnis unklar; nicht erneut gepostet" : "Instagram-Container nicht angelegt");
  }
  return { state: "processing", externalId: `legacy-reel:${ref.jobId}`, url: null };
}

// Read-only status of an affiliate Instagram attempt. Completing a processing container stays with the existing
// continuation (Reel) or Status command (image), which also publish exactly once.
export async function legacyInstagramStatus(remoteId: string, deps: LegacyAffiliateDeps): Promise<RemoteStatus | null> {
  if (remoteId.startsWith("legacy-reel:")) {
    const reel = await reelRepository(deps).get(remoteId.slice("legacy-reel:".length));
    if (reel?.status === "published") return { state: "published", externalId: reel.mediaId ?? remoteId, url: reel.permalink };
    if (reel?.status === "unknown") return { state: "unknown" };
    return { state: "processing" };
  }
  if (remoteId.startsWith("legacy-ig:")) {
    const db = database(deps);
    const row = (await db.query("SELECT status,media_id,permalink FROM instagram_image_posts WHERE publication_id=$1", [remoteId.slice("legacy-ig:".length)])).rows[0];
    if (row?.status === "published") return { state: "published", externalId: row.media_id ? String(row.media_id) : remoteId, url: row.permalink ? String(row.permalink) : null };
    if (row?.status === "failed") return { state: "failed", detail: "Instagram hat abgelehnt" };
    if (row?.status === "unknown") return { state: "unknown" };
    return { state: "processing" };
  }
  return null;
}

import { getDatabase, type Database } from "../memory/db";
import type { Platform } from "../formats/catalog";
import { emitEvent } from "../observability/events";
import { adoptProductApproval } from "../publishing/product-approval";
import type { DecisionEvidence } from "../publishing/authority";
import { formatPublishReport, type ReportFormat } from "../publishing/report";
import { AFFILIATE_DISCLOSURE, type AffiliateSourceRef, type MasterContent } from "./master-content";
import type { PlatformVariant } from "./platforms/adapters";
import { publishableContent, publishAll, type PlatformPublisher, type PublishRun } from "./publish";
import { defaultPublishers, type LegacyAffiliateDeps } from "./publishers";

// Affiliate posts of the existing product pipeline on the shared distribution layer.
//
// After the product pipeline's second (publication) approval, an affiliate post becomes master content + platform
// variants and is published by the same multi-publisher (publishAll), the same central approval gate and the same
// platform publishers as a topic post. What stays affiliate-specific is only content: the exactly approved caption with
// its existing link and disclosure rules, the approved image/video and the approved record (source_ref).
//
// Approval scope is unchanged: the product pipeline's WhatsApp request shows Facebook (+ Instagram feed image under the
// same approval) or the Instagram Reel. Only those platforms are part of the approved version. TikTok, YouTube Shorts and
// X stay reachable through the same publishers but need their own approved version; they are never published under an
// approval that did not name them.

export type AffiliateDistributionDeps = { db?: Database; publishers?: PlatformPublisher[]; affiliate?: LegacyAffiliateDeps; send?: (text: string) => Promise<unknown>; trustedWaId?: string };

const ALL_PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok", "youtube", "x"];
const SCOPE_NOTE = "Nicht Teil dieser Produkt-Freigabe; braucht eine eigene Freigabe";
const urls = (text: string) => [...new Set(text.match(/https:\/\/[^\s)]+/g) ?? [])].sort();

function variant(platform: Platform, text: string, mediaFormat: "image" | "reel", role: string): PlatformVariant {
  return { platform, title: null, text, links: urls(text), assetRefs: [role], mediaFormat, disclosure: AFFILIATE_DISCLOSURE, aspectRatio: mediaFormat === "reel" ? "9:16" : "4:5",
    publishable: true, skipReason: null, hashtags: [], linkStrategy: "affiliate_link_im_text" };
}
function outOfScope(platform: Platform): PlatformVariant {
  return { platform, title: null, text: "", links: [], assetRefs: [], mediaFormat: "none", disclosure: null, aspectRatio: null, publishable: false, skipReason: SCOPE_NOTE, hashtags: [], linkStrategy: "kein_link" };
}

function affiliateMaster(input: { ref: AffiliateSourceRef; format: "SINGLE_IMAGE" | "STANDARD_VIDEO"; caption: string; productName: string; media: { role: string; kind: "image" | "video"; url: string; mediaType: string } }): MasterContent {
  const hook = input.caption.split("\n").find(line => line.trim())?.trim() ?? input.productName;
  return {
    content_id: `aff_${input.ref.kind === "facebook_publication" ? "img" : "reel"}_${input.ref.publicationId}`,
    category: "affiliate", topic: { topic_id: input.ref.jobId, title: input.productName, trend_type: "product" }, selected_format: input.format,
    hook, message: hook, body: input.caption, cta: "", caption: input.caption, hashtags: [],
    assets: [{ role: input.media.role, kind: input.media.kind, url: input.media.url, sha256: null, mediaType: input.media.mediaType, provider: "product_pipeline" }],
    carousel: null, video: input.format === "STANDARD_VIDEO" ? { script: "", provider: "product_pipeline", asset_role: input.media.role } : null,
    source_references: [], campaign: { run_id: input.ref.jobId, origin: "product_pipeline" },
    // Link and disclosure live in the approved caption (existing affiliate rules); no second link source is added.
    affiliate_data: null, disclosures: [AFFILIATE_DISCLOSURE], source_ref: input.ref,
  };
}

// The operator's approving reply to exactly this product-pipeline request, as stored by the existing webhook.
async function approvalEvidence(db: Database, requestMessageId: string): Promise<DecisionEvidence | null> {
  const row = (await db.query(`SELECT message_id,wa_id,reply_to_message_id,body FROM whatsapp_events
    WHERE reply_to_message_id=$1 AND intent='approve' ORDER BY received_at ASC, message_id ASC LIMIT 1`, [requestMessageId])).rows[0];
  return row ? { channel: "whatsapp", messageId: String(row.message_id), replyToMessageId: String(row.reply_to_message_id), senderWaId: String(row.wa_id), body: String(row.body) } : null;
}

async function distribute(db: Database, master: MasterContent, variants: PlatformVariant[], requestMessageId: string, deps: AffiliateDistributionDeps): Promise<PublishRun | null> {
  const evidence = await approvalEvidence(db, requestMessageId);
  if (!evidence) { emitEvent("platform_publish_skipped", { contentId: master.content_id, reason: "product_approval_evidence_missing" }, "warn"); return null; }
  await adoptProductApproval(db, { content: publishableContent(master, variants), requestMessageId, evidence, trustedWaId: deps.trustedWaId ?? process.env.WHATSAPP_APPROVER_WA_ID ?? "" });
  return publishAll(db, { master, variants, publishers: deps.publishers ?? defaultPublishers({ db: () => db, ...deps.affiliate }), origin: "product_pipeline" });
}

// Only what this run newly did is reported; a redelivered approval that finds the platforms already handled stays silent.
async function report(run: PublishRun, format: ReportFormat, send: ((text: string) => Promise<unknown>) | undefined, contentId: string) {
  const outcomes = run.outcomes.filter(item => !item.reused && item.blockReason !== "already_attempted");
  if (!outcomes.length || !send) return;
  try { await send(formatPublishReport({ category: "affiliate", format, outcomes })); }
  catch { emitEvent("platform_publish_failed", { contentId, detail: "report_unsent" }, "warn"); }
}

// Second approval of an affiliate image post ("Freigeben" on the publication request) → shared distribution.
export async function publishApprovedAffiliateImage(publicationId: string, deps: AffiliateDistributionDeps = {}) {
  const db = deps.db ?? getDatabase();
  const row = (await db.query(`SELECT p.id,p.job_id,p.caption,p.image_url,p.whatsapp_message_id,j.snapshot->'opportunity'->'product'->>'name' AS product
    FROM publication_requests p JOIN content_jobs j ON j.id=p.job_id WHERE p.id=$1 AND p.platform='facebook'`, [publicationId])).rows[0];
  if (!row?.image_url || !row.whatsapp_message_id) return null;
  const ref: AffiliateSourceRef = { kind: "facebook_publication", publicationId: String(row.id), jobId: String(row.job_id) };
  const caption = String(row.caption);
  const master = affiliateMaster({ ref, format: "SINGLE_IMAGE", caption, productName: String(row.product ?? ""), media: { role: "image", kind: "image", url: String(row.image_url), mediaType: "image/png" } });
  // Facebook first, then the Instagram feed image under the same approval; each isolated by the multi-publisher.
  const variants = [variant("facebook", caption, "image", "image"), variant("instagram", caption, "image", "image"), ...ALL_PLATFORMS.slice(2).map(outOfScope)];
  const run = await distribute(db, master, variants, String(row.whatsapp_message_id), deps);
  if (run) await report(run, "SINGLE_IMAGE", deps.send, master.content_id);
  return run;
}

// Separately approved affiliate Reel → shared distribution. The publisher creates the container once; the existing
// continuation polls and publishes it exactly once and sends the final report.
export async function publishApprovedAffiliateReel(jobId: string, deps: AffiliateDistributionDeps = {}) {
  const db = deps.db ?? getDatabase();
  const row = (await db.query(`SELECT p.id,p.job_id,p.caption,p.video_url,p.whatsapp_message_id,p.status,j.snapshot->'opportunity'->'product'->>'name' AS product
    FROM publication_requests p JOIN content_jobs j ON j.id=p.job_id WHERE p.job_id=$1 AND p.platform='instagram' ORDER BY p.revision DESC LIMIT 1`, [jobId])).rows[0];
  if (!row || row.status !== "approved" || !row.video_url || !row.whatsapp_message_id) return null;
  const ref: AffiliateSourceRef = { kind: "instagram_reel", publicationId: String(row.id), jobId: String(row.job_id) };
  const caption = String(row.caption);
  const master = affiliateMaster({ ref, format: "STANDARD_VIDEO", caption, productName: String(row.product ?? ""), media: { role: "video", kind: "video", url: String(row.video_url), mediaType: "video/mp4" } });
  const variants = [variant("instagram", caption, "reel", "video"), ...ALL_PLATFORMS.filter(platform => platform !== "instagram").map(outOfScope)];
  const run = await distribute(db, master, variants, String(row.whatsapp_message_id), deps);
  const problem = run?.outcomes.find(item => (item.status === "blocked" && item.blockReason !== "already_attempted") || item.status === "failed");
  // Same as before: a blocked or failed container step is logged by the continuation and retried on its next tick.
  if (problem) throw new Error(`affiliate_reel_${problem.status}:${problem.blockReason ?? problem.detail ?? ""}`.slice(0, 160));
  return run;
}

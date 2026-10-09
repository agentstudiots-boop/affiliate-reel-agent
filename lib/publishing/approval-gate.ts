import { createHash, randomUUID } from "node:crypto";
import type { Database, Sql } from "../memory/db";
import { classifyWhatsAppReply } from "../whatsapp/intent";
import { emitEvent } from "../observability/events";
import { isActiveAuthority, type ApprovalAuthorityKind, type DecisionEvidence } from "./authority";
import { livePublishCapability, type ContentOrigin } from "../capabilities";

// Central publish barrier (hard invariant).
//
//   No publish request of the topic / multi-format pipeline can reach a platform unless an active approval
//   authority explicitly approved exactly this content id, version and fingerprint.
//
// - Approval is bound to (content_id, version, fingerprint). The fingerprint covers hook, caption, body, CTA,
//   links, assets (url + hash), disclosures and every platform variant.
// - Any change produces a new version and invalidates all earlier pending/approved decisions (also in the DB).
// - Reject, change request, missing answer (pending), invalidated, unknown authority → blocked.
// - Publishers can only obtain a PublishPermit from authorizePublish(); a permit is re-verified against the
//   exact outgoing payload immediately before the network call (assertPermitMatches).
// - Each (content, version, platform) can be claimed once; cron runs, retries and fallbacks cannot double-post.

export type PublishableAsset = { role: string; kind: string; url: string | null; sha256: string | null };
export type PublishableVariant = { platform: string; title: string | null; text: string; links: string[]; assetRefs: string[]; mediaFormat: string; disclosure: string | null };
export type PublishableContent = {
  contentId: string;
  // Which pipeline produced and approved the content (part of the fingerprint). Absent = topic pipeline.
  origin?: ContentOrigin;
  hook: string;
  caption: string;
  body: string;
  cta: string;
  links: string[];
  assets: PublishableAsset[];
  disclosures: string[];
  variants: PublishableVariant[];
};

export class PublishBlockedError extends Error {
  constructor(public readonly reason: PublishBlockReason, public readonly contentId: string, public readonly platform: string | null = null) {
    super(`publish_blocked:${reason}`);
    this.name = "PublishBlockedError";
  }
}
export type PublishBlockReason = "no_content_version" | "no_approval" | "approval_pending" | "approval_rejected" | "changes_requested" | "approval_invalidated"
  | "content_changed_since_approval" | "authority_inactive" | "approval_incomplete" | "platform_not_in_approved_version" | "already_attempted" | "permit_mismatch" | "permit_forged"
  | "live_publishing_disabled" | "platform_not_enabled" | "credentials_missing" | "non_production_environment";

export class ApprovalDecisionError extends Error {
  constructor(public readonly reason: string) { super(`approval_decision_refused:${reason}`); this.name = "ApprovalDecisionError"; }
}

// Canonical JSON: key order never changes the fingerprint; any value change does.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as object).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value ?? null;
}
export function contentFingerprint(content: PublishableContent): string {
  const variants = [...content.variants].sort((a, b) => a.platform.localeCompare(b.platform));
  return createHash("sha256").update(JSON.stringify(canonical({ ...content, variants }))).digest("hex");
}
export function variantFingerprint(content: PublishableContent, platform: string): string | null {
  const variant = content.variants.find(item => item.platform === platform);
  return variant ? createHash("sha256").update(JSON.stringify(canonical({ contentFingerprint: contentFingerprint(content), variant }))).digest("hex") : null;
}

type VersionRow = { version: number; fingerprint: string; platforms: string[] };
async function latestVersion(sql: Sql, contentId: string): Promise<VersionRow | null> {
  const result = await sql.query("SELECT version,fingerprint,platforms FROM content_versions WHERE content_id=$1 ORDER BY version DESC LIMIT 1", [contentId]);
  const row = result.rows[0];
  return row ? { version: Number(row.version), fingerprint: String(row.fingerprint), platforms: (row.platforms as string[]) ?? [] } : null;
}

// Registers the current content. Unchanged content keeps its version (and approval); any change creates the next
// version with a fresh pending approval and invalidates every earlier pending/approved decision.
export async function registerContentVersion(db: Database, content: PublishableContent) {
  const fingerprint = contentFingerprint(content);
  const platforms = [...new Set(content.variants.map(variant => variant.platform))].sort();
  return db.transaction(async sql => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`content:${content.contentId}`]);
    const latest = await latestVersion(sql, content.contentId);
    if (latest && latest.fingerprint === fingerprint) return { contentId: content.contentId, version: latest.version, fingerprint, changed: false };
    const version = (latest?.version ?? 0) + 1;
    const invalidated = await sql.query(`UPDATE publish_approvals SET status='invalidated', reason='content_changed', updated_at=now()
      WHERE content_id=$1 AND status IN ('pending','approved') RETURNING version`, [content.contentId]);
    await sql.query("INSERT INTO content_versions(content_id,version,fingerprint,platforms) VALUES($1,$2,$3,$4)", [content.contentId, version, fingerprint, platforms]);
    await sql.query("INSERT INTO publish_approvals(content_id,version,fingerprint,status) VALUES($1,$2,$3,'pending')", [content.contentId, version, fingerprint]);
    if (invalidated.rows.length) emitEvent("platform_publish_skipped", { contentId: content.contentId, reason: "approval_invalidated_by_change", versions: invalidated.rows.map(row => Number(row.version)) });
    return { contentId: content.contentId, version, fingerprint, changed: !!latest };
  });
}

// Binds the WhatsApp approval request message to the pending version. Only that message can be answered.
export async function bindApprovalRequest(db: Sql, contentId: string, version: number, requestMessageId: string) {
  const result = await db.query(`UPDATE publish_approvals SET request_message_id=$3, updated_at=now()
    WHERE content_id=$1 AND version=$2 AND status='pending' AND request_message_id IS NULL RETURNING content_id`, [contentId, version, requestMessageId]);
  if (!result.rows.length) throw new ApprovalDecisionError("request_not_bindable");
}

export type DecisionKind = "approved" | "rejected" | "changes_requested";

// Records a decision for the version whose approval request the operator replied to. Approval requires an active
// authority, the trusted sender, a reply to exactly this request and the literal approval word.
export async function recordApprovalDecision(db: Database, input: { authority: ApprovalAuthorityKind; evidence: DecisionEvidence; trustedWaId: string; reason?: string }) {
  const { evidence } = input;
  if (!isActiveAuthority(input.authority)) throw new ApprovalDecisionError("authority_inactive");
  if (evidence.channel !== "whatsapp" || !evidence.messageId || !evidence.replyToMessageId) throw new ApprovalDecisionError("evidence_incomplete");
  const trusted = input.trustedWaId.replace(/\D/g, "");
  if (!trusted || evidence.senderWaId.replace(/\D/g, "") !== trusted) throw new ApprovalDecisionError("untrusted_sender");
  const intent = classifyWhatsAppReply(evidence.body).intent;
  const decision: DecisionKind = intent === "approve" ? "approved" : intent === "reject" ? "rejected" : "changes_requested";
  return db.transaction(async sql => {
    const row = (await sql.query("SELECT content_id,version,fingerprint,status FROM publish_approvals WHERE request_message_id=$1 FOR UPDATE", [evidence.replyToMessageId])).rows[0];
    if (!row) throw new ApprovalDecisionError("unknown_request");
    const contentId = String(row.content_id), version = Number(row.version);
    if (row.status !== "pending") throw new ApprovalDecisionError(`not_pending:${row.status}`);
    const latest = await latestVersion(sql, contentId);
    if (!latest || latest.version !== version || latest.fingerprint !== row.fingerprint) {
      await sql.query("UPDATE publish_approvals SET status='invalidated', reason='superseded', updated_at=now() WHERE content_id=$1 AND version=$2", [contentId, version]);
      throw new ApprovalDecisionError("superseded_version");
    }
    await sql.query(`UPDATE publish_approvals SET status=$3, authority=$4, decision_message_id=$5, decided_at=now(), reason=$6, updated_at=now()
      WHERE content_id=$1 AND version=$2 AND status='pending'`, [contentId, version, decision, input.authority, evidence.messageId, (input.reason ?? (decision === "approved" ? "" : evidence.body)).slice(0, 500)]);
    return { contentId, version, decision, fingerprint: String(row.fingerprint) };
  });
}

// Permits are registered by identity: copies, spreads or hand-built objects are never valid permits.
const ISSUED = new WeakSet<object>();
export type PublishPermit = { readonly contentId: string; readonly version: number; readonly platform: string; readonly fingerprint: string;
  readonly variantFingerprint: string; readonly attemptId: string };

async function blocked(db: Sql, contentId: string, version: number | null, platform: string, origin: string, reason: PublishBlockReason): Promise<never> {
  await db.query("INSERT INTO publish_attempts(id,content_id,version,platform,origin,status,reason) VALUES($1,$2,$3,$4,$5,'blocked',$6)",
    [randomUUID(), contentId, version, platform, origin.slice(0, 60), reason]).catch(() => undefined);
  emitEvent("platform_publish_skipped", { contentId, version, platform, origin, reason }, "warn");
  throw new PublishBlockedError(reason, contentId, platform);
}

// The only way to obtain a PublishPermit. Deterministic: the same state always yields the same answer.
export async function authorizePublish(db: Database, input: { content: PublishableContent; platform: string; origin: string }): Promise<PublishPermit> {
  const { content, platform, origin } = input;
  const fingerprint = contentFingerprint(content);
  const variant = variantFingerprint(content, platform);
  const outcome = await db.transaction(async sql => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`content:${content.contentId}`]);
    const latest = await latestVersion(sql, content.contentId);
    if (!latest) return { block: "no_content_version" as const, version: null };
    // The content about to be sent differs from the latest registered version: whatever was approved is void.
    if (latest.fingerprint !== fingerprint) {
      // An approval never covers different content: the approved latest version is voided. A pending request of a
      // newer version stays untouched (a stale payload must not cancel the operator's open request).
      await sql.query("UPDATE publish_approvals SET status='invalidated', reason='content_changed', updated_at=now() WHERE content_id=$1 AND status='approved'", [content.contentId]);
      return { block: "content_changed_since_approval" as const, version: latest.version };
    }
    const approval = (await sql.query("SELECT * FROM publish_approvals WHERE content_id=$1 AND version=$2", [content.contentId, latest.version])).rows[0];
    if (!approval) return { block: "no_approval" as const, version: latest.version };
    const status = String(approval.status);
    if (status === "pending") return { block: "approval_pending" as const, version: latest.version };
    if (status === "rejected") return { block: "approval_rejected" as const, version: latest.version };
    if (status === "changes_requested") return { block: "changes_requested" as const, version: latest.version };
    if (status !== "approved") return { block: "approval_invalidated" as const, version: latest.version };
    if (!isActiveAuthority(approval.authority)) return { block: "authority_inactive" as const, version: latest.version };
    if (approval.fingerprint !== fingerprint || !approval.request_message_id || !approval.decision_message_id || !approval.decided_at) return { block: "approval_incomplete" as const, version: latest.version };
    if (!variant || !latest.platforms.includes(platform)) return { block: "platform_not_in_approved_version" as const, version: latest.version };
    // Live switch, platform activation and credentials are part of the invariant, not a caller convention.
    const live = livePublishCapability(platform, process.env, content.origin);
    if (!live.ok) return { block: live.reason, version: latest.version };
    const earlier = await sql.query("SELECT 1 FROM publish_attempts WHERE content_id=$1 AND platform=$2 AND status IN ('claimed','processing','published','unknown') LIMIT 1", [content.contentId, platform]);
    if (earlier.rows.length) return { block: "already_attempted" as const, version: latest.version };
    const attemptId = randomUUID();
    const claimed = await sql.query(`INSERT INTO publish_attempts(id,content_id,version,platform,origin,status) VALUES($1,$2,$3,$4,$5,'claimed')
      ON CONFLICT (content_id, version, platform) WHERE status IN ('claimed','processing','published','unknown') DO NOTHING RETURNING id`,
      [attemptId, content.contentId, latest.version, platform, origin.slice(0, 60)]);
    if (!claimed.rows.length) return { block: "already_attempted" as const, version: latest.version };
    return { permit: { contentId: content.contentId, version: latest.version, platform, fingerprint, variantFingerprint: variant, attemptId } as PublishPermit };
  });
  if ("block" in outcome) return blocked(db, content.contentId, outcome.version ?? null, platform, origin, outcome.block!);
  const permit = Object.freeze(outcome.permit);
  ISSUED.add(permit);
  emitEvent("platform_publish_started", { contentId: content.contentId, version: permit.version, platform, origin });
  return permit;
}

// Called by every publisher immediately before the network request with the exact outgoing content.
export function assertPermitMatches(permit: PublishPermit, content: PublishableContent, platform: string) {
  if (!permit || typeof permit !== "object" || !ISSUED.has(permit)) throw new PublishBlockedError("permit_forged", content.contentId, platform);
  if (permit.contentId !== content.contentId || permit.platform !== platform || permit.fingerprint !== contentFingerprint(content)
    || permit.variantFingerprint !== variantFingerprint(content, platform)) throw new PublishBlockedError("permit_mismatch", content.contentId, platform);
}

// failed = definite rejection by the platform, nothing published → the same approved version may be tried again.
// unknown = may have been published → never retried automatically. processing = accepted, platform still working.
export async function completePublishAttempt(db: Sql, permit: PublishPermit, status: "published" | "processing" | "failed" | "unknown",
  detail: { externalId?: string; url?: string | null; reason?: string } = {}) {
  await db.query("UPDATE publish_attempts SET status=$2, external_id=$3, url=$4, reason=$5, updated_at=now() WHERE id=$1 AND status='claimed'",
    [permit.attemptId, status, detail.externalId ?? null, detail.url ?? null, (detail.reason ?? "").slice(0, 200) || null]);
}

// Every remote object created during a publish (container, upload, post) is recorded immediately, so an
// interrupted attempt can be reconciled by asking the platform instead of publishing again.
export async function recordRemoteId(db: Sql, permit: PublishPermit, remoteId: string) {
  await db.query("UPDATE publish_attempts SET remote_ids=remote_ids||$2::jsonb, updated_at=now() WHERE id=$1 AND status='claimed'", [permit.attemptId, JSON.stringify([remoteId.slice(0, 200)])]);
}

export type AttemptRecord = { id: string; contentId: string; version: number; platform: string; origin: string; status: string; externalId: string | null; url: string | null; remoteIds: string[]; reason: string | null };
const attemptRow = (row: Record<string, unknown>): AttemptRecord => ({ id: String(row.id), contentId: String(row.content_id), version: Number(row.version), platform: String(row.platform), origin: String(row.origin ?? ""),
  status: String(row.status), externalId: row.external_id ? String(row.external_id) : null, url: row.url ? String(row.url) : null, remoteIds: (row.remote_ids as string[]) ?? [], reason: row.reason ? String(row.reason) : null });

// The live (non-blocked) attempt of a platform for the latest version: published, processing, unknown or the last failed one.
// The platform's relevant attempt for this content: a live one (claimed/processing/published/unknown) from ANY version
// wins, so a later version (e.g. adding platforms) never republishes a platform; otherwise the latest failed one.
export async function platformAttempt(db: Sql, contentId: string, platform: string): Promise<AttemptRecord | null> {
  const latest = await latestVersion(db, contentId);
  if (!latest) return null;
  const row = (await db.query(`SELECT * FROM publish_attempts WHERE content_id=$1 AND platform=$3 AND status<>'blocked'
    AND (status IN ('claimed','processing','published','unknown') OR version=$2)
    ORDER BY (status IN ('claimed','processing','published','unknown')) DESC, created_at DESC LIMIT 1`, [contentId, latest.version, platform])).rows[0];
  return row ? attemptRow(row) : null;
}

export async function openAttempts(db: Sql, limit = 20): Promise<AttemptRecord[]> {
  const rows = await db.query("SELECT * FROM publish_attempts WHERE status IN ('processing','unknown') AND jsonb_array_length(remote_ids)+(CASE WHEN external_id IS NULL THEN 0 ELSE 1 END)>0 AND updated_at>now()-interval '7 days' ORDER BY updated_at LIMIT $1", [limit]);
  return rows.rows.map(attemptRow);
}

// Reconciliation after asking the platform: processing → published/failed/unknown; unknown → published only when the
// platform confirms the post. Never re-opens a published attempt.
export async function settleAttempt(db: Sql, attemptId: string, status: "published" | "failed" | "unknown" | "processing", detail: { externalId?: string; url?: string | null; reason?: string } = {}) {
  const from = status === "published" ? ["processing", "unknown"] : ["processing"];
  await db.query(`UPDATE publish_attempts SET status=$2, external_id=COALESCE($3,external_id), url=COALESCE($4,url), reason=COALESCE($5,reason), updated_at=now()
    WHERE id=$1 AND status = ANY($6::text[])`, [attemptId, status, detail.externalId ?? null, detail.url ?? null, detail.reason ?? null, from]);
}

export async function approvalState(db: Sql, contentId: string) {
  const latest = await latestVersion(db, contentId);
  if (!latest) return null;
  const approval = (await db.query("SELECT status,authority,request_message_id,decided_at FROM publish_approvals WHERE content_id=$1 AND version=$2", [contentId, latest.version])).rows[0];
  return { version: latest.version, fingerprint: latest.fingerprint, status: String(approval?.status ?? "none"), authority: approval?.authority ?? null,
    requestMessageId: approval?.request_message_id ?? null, decidedAt: approval?.decided_at ?? null };
}

// Read-only preview for dry runs and status: would this exact content be publishable on this platform right now?
// Never claims an attempt and never changes state.
export async function previewPublish(db: Sql, content: PublishableContent, platform: string): Promise<{ allowed: boolean; reason: PublishBlockReason | "approved" }> {
  const latest = await latestVersion(db, content.contentId);
  if (!latest) return { allowed: false, reason: "no_content_version" };
  if (latest.fingerprint !== contentFingerprint(content)) return { allowed: false, reason: "content_changed_since_approval" };
  const approval = (await db.query("SELECT status,authority,decision_message_id FROM publish_approvals WHERE content_id=$1 AND version=$2", [content.contentId, latest.version])).rows[0];
  const status = String(approval?.status ?? "");
  if (status === "pending") return { allowed: false, reason: "approval_pending" };
  if (status === "rejected") return { allowed: false, reason: "approval_rejected" };
  if (status === "changes_requested") return { allowed: false, reason: "changes_requested" };
  if (status !== "approved") return { allowed: false, reason: approval ? "approval_invalidated" : "no_approval" };
  if (!isActiveAuthority(approval.authority)) return { allowed: false, reason: "authority_inactive" };
  if (!latest.platforms.includes(platform)) return { allowed: false, reason: "platform_not_in_approved_version" };
  const attempt = await db.query("SELECT 1 FROM publish_attempts WHERE content_id=$1 AND version=$2 AND platform=$3 AND status IN ('claimed','processing','published','unknown') LIMIT 1", [content.contentId, latest.version, platform]);
  if (attempt.rows.length) return { allowed: false, reason: "already_attempted" };
  const live = livePublishCapability(platform, process.env, content.origin);
  return live.ok ? { allowed: true, reason: "approved" } : { allowed: false, reason: live.reason };
}

export async function contentIdForRequestMessage(db: Sql, requestMessageId: string): Promise<{ contentId: string; version: number } | null> {
  const row = (await db.query("SELECT content_id,version FROM publish_approvals WHERE request_message_id=$1", [requestMessageId])).rows[0];
  return row ? { contentId: String(row.content_id), version: Number(row.version) } : null;
}

// An accepted operator change to a draft voids every open or granted approval of that content immediately, even
// before the new version is produced (and even if producing it fails).
export async function invalidateApprovals(db: Sql, contentId: string, reason: string) {
  const result = await db.query("UPDATE publish_approvals SET status='invalidated', reason=$2, updated_at=now() WHERE content_id=$1 AND status IN ('pending','approved') RETURNING version",
    [contentId, reason.slice(0, 120)]);
  return result.rows.map(row => Number(row.version));
}

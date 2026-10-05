import { createHash, randomUUID } from "node:crypto";
import type { Database, Sql } from "../memory/db";
import { classifyWhatsAppReply } from "../whatsapp/intent";
import { emitEvent } from "../observability/events";
import { isActiveAuthority, type ApprovalAuthorityKind, type DecisionEvidence } from "./authority";

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
  | "content_changed_since_approval" | "authority_inactive" | "approval_incomplete" | "platform_not_in_approved_version" | "already_attempted" | "permit_mismatch" | "permit_forged";

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
    const attemptId = randomUUID();
    const claimed = await sql.query(`INSERT INTO publish_attempts(id,content_id,version,platform,origin,status) VALUES($1,$2,$3,$4,$5,'claimed')
      ON CONFLICT (content_id, version, platform) WHERE status IN ('claimed','published','unknown') DO NOTHING RETURNING id`,
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
// unknown = may have been published → never retried automatically.
export async function completePublishAttempt(db: Sql, permit: PublishPermit, status: "published" | "failed" | "unknown", detail: { externalId?: string; reason?: string } = {}) {
  await db.query("UPDATE publish_attempts SET status=$2, external_id=$3, reason=$4, updated_at=now() WHERE id=$1 AND status='claimed'",
    [permit.attemptId, status, detail.externalId ?? null, (detail.reason ?? "").slice(0, 200) || null]);
}

export async function approvalState(db: Sql, contentId: string) {
  const latest = await latestVersion(db, contentId);
  if (!latest) return null;
  const approval = (await db.query("SELECT status,authority,request_message_id,decided_at FROM publish_approvals WHERE content_id=$1 AND version=$2", [contentId, latest.version])).rows[0];
  return { version: latest.version, fingerprint: latest.fingerprint, status: String(approval?.status ?? "none"), authority: approval?.authority ?? null,
    requestMessageId: approval?.request_message_id ?? null, decidedAt: approval?.decided_at ?? null };
}

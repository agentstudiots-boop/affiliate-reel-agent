// Operator decision requests of the executive kernel (task B-06) on enterprise_decisions (migration 041).
//
// A plan step at a decision level (L3a, L3b, L4) never runs; it becomes a decision request for the operator. The request
// is bound to subject, version and a fingerprint of everything shown to the operator; any change creates a new version
// and supersedes the open one. A decision counts only if it comes from the operator over WhatsApp (the single active
// approval authority, lib/publishing/authority.ts), answers exactly the request message and matches the fingerprint.
// An executive agent can never decide its own requests, even if it were ever added to the active authorities.
//
// This module only records requests and decisions. An approved request executes nothing; sending the WhatsApp message
// and acting on an approval are separate, later steps behind their own decisions. All times come from the database clock.

import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../memory/db";
import { isActiveAuthority } from "../publishing/authority";
import type { ClassifiedStep } from "./plan";
import { requiresDecision } from "./policy";

export type DecisionOption = { id: string; label: string };
export type DecisionRequestInput = {
  step: ClassifiedStep;
  subjectKey: string;
  subject: string;
  options: DecisionOption[];
  recommendation?: { optionId: string; reason: string } | null;
  evidence?: { claim: string; kind: "fact" | "assumption" | "forecast"; source?: string }[];
  planId?: string | null;
  taskId?: string | null;
  ttlHours?: number;
};
export type DecisionRequest = { id: string; subjectKey: string; version: number; fingerprint: string; level: string };
export type DecisionReply = {
  id: string; fingerprint: string; decision: "approved" | "rejected"; authority: string;
  requestMessageId: string; decidedMessageId: string;
};

export class DecisionError extends Error {}

const DEFAULT_TTL_HOURS = 72;
const MAX_TTL_HOURS = 24 * 14;

// Stable JSON: object keys sorted, so the fingerprint does not depend on property order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// Fingerprint over everything the operator decides on.
export function decisionFingerprint(content: { level: string; department: string; taskKind: string; subject: string; options: DecisionOption[];
  recommendation: unknown; evidence: unknown; maxCostCents: number }): string {
  return createHash("sha256").update(canonical(content)).digest("hex");
}

export async function requestDecision(db: Database, input: DecisionRequestInput): Promise<DecisionRequest> {
  const { step } = input;
  if (!requiresDecision(step.level)) throw new DecisionError(`Stufe ${step.level} ist ausführbar und braucht keine Entscheidungsvorlage`);
  if (!input.subjectKey.trim() || !input.subject.trim()) throw new DecisionError("Betreff fehlt");
  const ids = input.options.map(option => option.id);
  if (input.options.length < 2 || new Set(ids).size !== ids.length || input.options.some(option => !option.id.trim() || !option.label.trim()))
    throw new DecisionError("mindestens zwei eindeutige Optionen nötig");
  if (input.recommendation && !ids.includes(input.recommendation.optionId)) throw new DecisionError("Empfehlung verweist auf keine Option");
  const evidence = input.evidence ?? [];
  if (evidence.some(item => item.kind === "fact" && !item.source?.trim())) throw new DecisionError("Fakt ohne Quelle");
  const ttl = input.ttlHours ?? DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_HOURS) throw new DecisionError("Gültigkeit ungültig");
  const fingerprint = decisionFingerprint({ level: step.level, department: step.department, taskKind: step.taskKind, subject: input.subject,
    options: input.options, recommendation: input.recommendation ?? null, evidence, maxCostCents: step.maxCostCents });
  return db.transaction(async sql => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-decision:${input.subjectKey}`]);
    const open = (await sql.query("SELECT id, version, fingerprint FROM enterprise_decisions WHERE subject_key=$1 AND status='pending'", [input.subjectKey])).rows[0];
    // The same content again: the open request stays valid.
    if (open && open.fingerprint === fingerprint)
      return { id: String(open.id), subjectKey: input.subjectKey, version: Number(open.version), fingerprint, level: step.level };
    if (open) await sql.query("UPDATE enterprise_decisions SET status='superseded' WHERE id=$1", [open.id]);
    const version = Number((await sql.query("SELECT coalesce(max(version),0)+1 AS v FROM enterprise_decisions WHERE subject_key=$1", [input.subjectKey])).rows[0].v);
    const id = randomUUID();
    await sql.query(`INSERT INTO enterprise_decisions(id,subject_key,version,task_id,plan_id,level,department,task_kind,subject,options,recommendation,evidence,
        fingerprint,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,now() + make_interval(hours => $14::int))`,
      [id, input.subjectKey, version, input.taskId ?? null, input.planId ?? null, step.level, step.department, step.taskKind, input.subject,
        JSON.stringify(input.options), input.recommendation ? JSON.stringify(input.recommendation) : null, JSON.stringify(evidence), fingerprint, Math.ceil(ttl)]);
    return { id, subjectKey: input.subjectKey, version, fingerprint, level: step.level };
  });
}

// Binds the request to the WhatsApp message that asked the operator. Only once, only while pending.
export async function attachRequestMessage(db: Database, id: string, requestMessageId: string): Promise<boolean> {
  if (!requestMessageId.trim()) return false;
  const updated = await db.query(`UPDATE enterprise_decisions SET request_message_id=$2
    WHERE id=$1 AND status='pending' AND request_message_id IS NULL AND expires_at > now() RETURNING id`, [id, requestMessageId]);
  return updated.rows.length === 1;
}

export type RecordResult = { ok: true; status: "approved" | "rejected" } | { ok: false; reason: "not_operator" | "unknown_or_closed" | "wrong_message" | "fingerprint_mismatch" | "expired" };

// Records the operator's decision. Nothing is executed here.
export async function recordDecision(db: Database, reply: DecisionReply): Promise<RecordResult> {
  if (reply.authority !== "whatsapp_operator" || !isActiveAuthority(reply.authority)) return { ok: false, reason: "not_operator" };
  if (reply.decision !== "approved" && reply.decision !== "rejected") return { ok: false, reason: "unknown_or_closed" };
  return db.transaction(async sql => {
    const row = (await sql.query(`SELECT status, fingerprint, request_message_id, expires_at > now() AS valid FROM enterprise_decisions WHERE id=$1 FOR UPDATE`,
      [reply.id])).rows[0];
    if (!row || row.status !== "pending") return { ok: false as const, reason: "unknown_or_closed" as const };
    if (!row.valid) return { ok: false as const, reason: "expired" as const };
    if (!row.request_message_id || row.request_message_id !== reply.requestMessageId) return { ok: false as const, reason: "wrong_message" as const };
    if (row.fingerprint !== reply.fingerprint) return { ok: false as const, reason: "fingerprint_mismatch" as const };
    await sql.query(`UPDATE enterprise_decisions SET status=$2, authority='whatsapp_operator', decided_message_id=$3, decided_at=now() WHERE id=$1`,
      [reply.id, reply.decision, reply.decidedMessageId]);
    return { ok: true as const, status: reply.decision };
  });
}

// Open requests past their validity expire; a missing answer is never an approval.
export async function expireDecisions(db: Database): Promise<string[]> {
  return (await db.query("UPDATE enterprise_decisions SET status='expired' WHERE status='pending' AND expires_at <= now() RETURNING id")).rows.map(row => String(row.id));
}

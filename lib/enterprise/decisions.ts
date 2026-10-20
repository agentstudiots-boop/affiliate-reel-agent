// Operator decision requests of the executive kernel (task B-06) on enterprise_decisions (migration 041).
//
// A plan step at a decision level (L3a, L3b, L4) never runs; it becomes a decision request for the operator. The request
// is bound to subject, version and a fingerprint of everything shown to the operator; any change creates a new version
// and supersedes the open one. A decision counts only like an approval in lib/publishing/approval-gate.ts: the operator
// (the single active approval authority) answers over WhatsApp from the trusted number, replying to exactly the request
// message, with the literal approval or rejection word (classifyWhatsAppReply). Decision and sender are taken from that
// evidence, never from the caller; any other text records nothing. An executive agent can never decide its own requests,
// even if it were ever added to the active authorities.
//
// Level and handler are derived again from the register (fail-closed), so a hand-built step cannot pass itself off as a
// decision level it is not. The subject key is part of the fingerprint. A budget change (executive.budget_change) is only
// accepted as structured input: its subject key (budgetSubjectKey) and the amount in the subject shown to the operator are
// built here, so the limit a hard budget may bind to (B-09) is exactly the amount the operator saw.
//
// This module only records requests and decisions. An approved request executes nothing; sending the WhatsApp message
// and acting on an approval are separate, later steps behind their own decisions. All times come from the database clock.

import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../memory/db";
import { isActiveAuthority, type DecisionEvidence } from "../publishing/authority";
import { classifyWhatsAppReply } from "../whatsapp/intent";
import type { ClassifiedStep } from "./plan";
import { levelFor, requiresDecision } from "./policy";
import { DEPARTMENT_IDS, taskDefinition } from "./registry";

export type DecisionOption = { id: string; label: string };
// Structured content of an executive.budget_change request: hard monthly limit of one department.
export type BudgetChange = { department: string; period: string; limitCents: number };
export type DecisionRequestInput = {
  step: ClassifiedStep;
  // Required for every task kind except executive.budget_change, whose key is derived from `budget`.
  subjectKey?: string;
  budget?: BudgetChange;
  subject: string;
  options: DecisionOption[];
  recommendation?: { optionId: string; reason: string } | null;
  evidence?: { claim: string; kind: "fact" | "assumption" | "forecast"; source?: string }[];
  planId?: string | null;
  taskId?: string | null;
  ttlHours?: number;
};
export type DecisionRequest = { id: string; subjectKey: string; version: number; fingerprint: string; level: string };
// What the WhatsApp webhook received. trustedWaId is the operator's configured number, never taken from the message.
// expected (optional): the request the caller believes is answered; a different request or fingerprint is refused.
export type DecisionReply = {
  authority: string;
  evidence: DecisionEvidence;
  trustedWaId: string;
  expected?: { id: string; fingerprint: string };
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

const BUDGET_TASK_KIND = "executive.budget_change";
const BUDGET_PREFIX = "budget:";

// Subject of the L4 decision (executive.budget_change) that makes a hard budget binding (B-09). The amount is part of the
// key, so a changed limit needs a new decision.
export function budgetSubjectKey(department: string, period: string, limitCents: number): string {
  return `${BUDGET_PREFIX}${department}:${period}:${limitCents}`;
}

function budgetSubject(input: DecisionRequestInput): { subjectKey: string; subject: string } {
  const budget = input.budget;
  if (!budget) throw new DecisionError("Budgetänderung nur mit Abteilung, Monat und Betrag");
  if (!(DEPARTMENT_IDS as readonly string[]).includes(budget.department)) throw new DecisionError("Budgetänderung: unbekannte Abteilung");
  if (typeof budget.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(budget.period)) throw new DecisionError("Budgetänderung: Monat ungültig");
  if (!Number.isSafeInteger(budget.limitCents) || budget.limitCents <= 0) throw new DecisionError("Budgetänderung: Betrag muss eine positive ganze Zahl in Cent sein");
  const subjectKey = budgetSubjectKey(budget.department, budget.period, budget.limitCents);
  if (input.subjectKey !== undefined && input.subjectKey !== subjectKey) throw new DecisionError("Budgetänderung: Betreffschlüssel wird hier gebildet");
  // The free text may not name an amount of its own: the only amount the operator sees is the binding one, and it comes first.
  if (/[€$£]|\b(EUR|Euro|Cent|ct)\b/i.test(input.subject)) throw new DecisionError("Budgetänderung: Betrag nur aus der strukturierten Angabe, nicht im Text");
  const amount = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(budget.limitCents / 100);
  return { subjectKey, subject: `Monatsbudget ${budget.department} ${budget.period}: ${amount} – ${input.subject.trim()}` };
}

// Fingerprint over everything the operator decides on.
export function decisionFingerprint(content: { subjectKey: string; level: string; department: string; taskKind: string; handlerId: string; subject: string;
  options: DecisionOption[]; recommendation: unknown; evidence: unknown; maxCostCents: number; maxModelCalls: number; taskId: string | null;
  planId: string | null }): string {
  return createHash("sha256").update(canonical(content)).digest("hex");
}

export async function requestDecision(db: Database, input: DecisionRequestInput): Promise<DecisionRequest> {
  const { step } = input;
  // The step is not trusted as given: task kind, action, handler and level must match the register.
  const definition = taskDefinition(step.department, step.taskKind);
  if (!definition) throw new DecisionError(`Aufgabenart ${step.taskKind} für ${step.department} nicht im Register`);
  if (step.action !== definition.action || step.handlerId !== definition.handlerId || step.level !== levelFor(definition.action))
    throw new DecisionError(`Schritt ${step.taskKind} passt nicht zum Register`);
  if (!requiresDecision(step.level)) throw new DecisionError(`Stufe ${step.level} ist ausführbar und braucht keine Entscheidungsvorlage`);
  if (!input.subject?.trim()) throw new DecisionError("Betreff fehlt");
  const isBudget = step.taskKind === BUDGET_TASK_KIND;
  if (!isBudget && input.budget) throw new DecisionError("Budgetangaben nur für eine Budgetänderung");
  const { subjectKey, subject } = isBudget ? budgetSubject(input) : { subjectKey: input.subjectKey?.trim() ?? "", subject: input.subject };
  if (!subjectKey) throw new DecisionError("Betreff fehlt");
  // Budget keys are reserved for budget changes, so no other request can look like a budget approval.
  if (!isBudget && subjectKey.startsWith(BUDGET_PREFIX)) throw new DecisionError("Betreffschlüssel budget: ist Budgetänderungen vorbehalten");
  const ids = input.options.map(option => option.id);
  if (input.options.length < 2 || new Set(ids).size !== ids.length || input.options.some(option => !option.id.trim() || !option.label.trim()))
    throw new DecisionError("mindestens zwei eindeutige Optionen nötig");
  if (input.recommendation && !ids.includes(input.recommendation.optionId)) throw new DecisionError("Empfehlung verweist auf keine Option");
  const evidence = input.evidence ?? [];
  if (evidence.some(item => item.kind === "fact" && !item.source?.trim())) throw new DecisionError("Fakt ohne Quelle");
  const ttl = input.ttlHours ?? DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_HOURS) throw new DecisionError("Gültigkeit ungültig");
  const fingerprint = decisionFingerprint({ subjectKey, level: step.level, department: step.department, taskKind: step.taskKind, handlerId: step.handlerId,
    subject, options: input.options, recommendation: input.recommendation ?? null, evidence, maxCostCents: step.maxCostCents,
    maxModelCalls: step.maxModelCalls, taskId: input.taskId ?? null, planId: input.planId ?? null });
  return db.transaction(async sql => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-decision:${subjectKey}`]);
    // An open request past its validity is never reused: it expires, and the same content gets a new version.
    await sql.query("UPDATE enterprise_decisions SET status='expired' WHERE subject_key=$1 AND status='pending' AND expires_at <= now()", [subjectKey]);
    const open = (await sql.query("SELECT id, version, fingerprint FROM enterprise_decisions WHERE subject_key=$1 AND status='pending'", [subjectKey])).rows[0];
    // The same content again: the open request stays valid.
    if (open && open.fingerprint === fingerprint)
      return { id: String(open.id), subjectKey, version: Number(open.version), fingerprint, level: step.level };
    if (open) await sql.query("UPDATE enterprise_decisions SET status='superseded' WHERE id=$1", [open.id]);
    const version = Number((await sql.query("SELECT coalesce(max(version),0)+1 AS v FROM enterprise_decisions WHERE subject_key=$1", [subjectKey])).rows[0].v);
    const id = randomUUID();
    await sql.query(`INSERT INTO enterprise_decisions(id,subject_key,version,task_id,plan_id,level,department,task_kind,subject,options,recommendation,evidence,
        fingerprint,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,now() + make_interval(hours => $14::int))`,
      [id, subjectKey, version, input.taskId ?? null, input.planId ?? null, step.level, step.department, step.taskKind, subject,
        JSON.stringify(input.options), input.recommendation ? JSON.stringify(input.recommendation) : null, JSON.stringify(evidence), fingerprint, Math.ceil(ttl)]);
    return { id, subjectKey, version, fingerprint, level: step.level };
  });
}

// Binds the request to the WhatsApp message that asked the operator. Only once, only while pending.
export async function attachRequestMessage(db: Database, id: string, requestMessageId: string): Promise<boolean> {
  if (!requestMessageId.trim()) return false;
  const updated = await db.query(`UPDATE enterprise_decisions SET request_message_id=$2
    WHERE id=$1 AND status='pending' AND request_message_id IS NULL AND expires_at > now() RETURNING id`, [id, requestMessageId]);
  return updated.rows.length === 1;
}

export type RecordResult = { ok: true; id: string; status: "approved" | "rejected" }
  | { ok: false; reason: "not_operator" | "evidence_incomplete" | "untrusted_sender" | "unclear_reply" | "unknown_or_closed" | "wrong_message" | "fingerprint_mismatch" | "expired" };

// Records the operator's decision. Nothing is executed here.
export async function recordDecision(db: Database, reply: DecisionReply): Promise<RecordResult> {
  if (reply.authority !== "whatsapp_operator" || !isActiveAuthority(reply.authority)) return { ok: false, reason: "not_operator" };
  const { evidence } = reply;
  if (!evidence || evidence.channel !== "whatsapp" || !evidence.messageId?.trim() || !evidence.replyToMessageId?.trim()) return { ok: false, reason: "evidence_incomplete" };
  const trusted = String(reply.trustedWaId ?? "").replace(/\D/g, "");
  if (!trusted || String(evidence.senderWaId ?? "").replace(/\D/g, "") !== trusted) return { ok: false, reason: "untrusted_sender" };
  const intent = classifyWhatsAppReply(String(evidence.body ?? "")).intent;
  if (intent !== "approve" && intent !== "reject") return { ok: false, reason: "unclear_reply" };
  const decision = intent === "approve" ? "approved" as const : "rejected" as const;
  return db.transaction(async sql => {
    const row = (await sql.query(`SELECT id, status, fingerprint, expires_at > now() AS valid FROM enterprise_decisions WHERE request_message_id=$1 FOR UPDATE`,
      [evidence.replyToMessageId])).rows[0];
    if (!row) return { ok: false as const, reason: (reply.expected ? "wrong_message" : "unknown_or_closed") as "wrong_message" | "unknown_or_closed" };
    if (reply.expected && reply.expected.id !== String(row.id)) return { ok: false as const, reason: "wrong_message" as const };
    if (reply.expected && reply.expected.fingerprint !== row.fingerprint) return { ok: false as const, reason: "fingerprint_mismatch" as const };
    if (row.status !== "pending") return { ok: false as const, reason: "unknown_or_closed" as const };
    if (!row.valid) return { ok: false as const, reason: "expired" as const };
    await sql.query(`UPDATE enterprise_decisions SET status=$2, authority='whatsapp_operator', decided_message_id=$3, decided_at=now() WHERE id=$1 AND status='pending'`,
      [row.id, decision, evidence.messageId]);
    return { ok: true as const, id: String(row.id), status: decision };
  });
}

// Open requests past their validity expire; a missing answer is never an approval.
export async function expireDecisions(db: Database): Promise<string[]> {
  return (await db.query("UPDATE enterprise_decisions SET status='expired' WHERE status='pending' AND expires_at <= now() RETURNING id")).rows.map(row => String(row.id));
}

// Department contract of the executive kernel (task B-04): task envelope, task result, health report and the limited
// capabilities a department receives instead of a database handle.
//
// Only executable plan steps (L0–L2, see plan.ts) can become task envelopes; the envelope's level is re-derived from the
// registry and must match. Results and health reports are validated before the kernel looks at them. Nothing here runs a
// department or touches a database; handlers and the task ledger follow in later tasks (B-02/B-03, G-01).

import { z } from "zod";
import { levelFor, levelRank, requiresDecision, PERMISSION_LEVELS, type PermissionLevel } from "./policy";
import { DEPARTMENT_IDS, REGISTRY, department, taskDefinition, type DepartmentId, type Registry } from "./registry";
import type { ClassifiedStep } from "./plan";

export const TASK_SOURCES = ["operator", "executive", "cron"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

const isoTime = z.string().datetime({ offset: true });

export const taskEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  messageId: z.string().min(1).max(100),
  correlationId: z.string().min(1).max(100),
  causationId: z.string().min(1).max(100).nullable(),
  kind: z.literal("task.request"),
  from: z.enum(TASK_SOURCES),
  to: z.enum(DEPARTMENT_IDS),
  taskKind: z.string().min(1),
  handlerId: z.string().min(1),
  permissionLevel: z.enum(PERMISSION_LEVELS),
  budget: z.object({ maxModelCalls: z.number().int().nonnegative(), maxCostCents: z.number().int().nonnegative(), deadline: isoTime.nullable() }),
  idempotencyKey: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
  createdAt: isoTime,
});
export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;

export const FAILURE_CLASSES = ["invalid_input", "budget_exhausted", "deadline_exceeded", "provider_error", "outcome_unknown", "internal"] as const;

export const taskResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("succeeded"),
    output: z.record(z.string(), z.unknown()),
    usedCostCents: z.number().int().nonnegative(),
    usedModelCalls: z.number().int().nonnegative(),
    evidence: z.array(z.object({ claim: z.string().min(1), kind: z.enum(["fact", "assumption", "forecast"]), source: z.string().min(1).optional() })).default([]),
  }),
  z.object({
    status: z.literal("failed"),
    failureClass: z.enum(FAILURE_CLASSES),
    reason: z.string().min(1),
    usedCostCents: z.number().int().nonnegative(),
    usedModelCalls: z.number().int().nonnegative(),
  }),
]);
export type TaskResult = z.infer<typeof taskResultSchema>;

export const healthReportSchema = z.object({
  department: z.enum(DEPARTMENT_IDS),
  status: z.enum(["ok", "degraded", "error", "not_configured", "unknown"]),
  checkedAt: isoTime,
  evidence: z.array(z.object({ label: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean(), z.null()]), source: z.string().min(1) })),
  reason: z.string().optional(),
});
export type HealthReport = z.infer<typeof healthReportSchema>;

// Capabilities instead of a database handle: a department may only run the named read-only views it was granted.
// Writes go exclusively through the kernel (task results), never directly from a department.
export type ReadView<Row = Record<string, unknown>> = (params: Record<string, unknown>) => Promise<Row[]>;
export type DepartmentContext = {
  readonly departmentId: DepartmentId;
  readonly now: () => Date;
  readonly read: (view: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
};
export interface DepartmentModule {
  readonly id: DepartmentId;
  readonly contractVersion: 1;
  handle(task: TaskEnvelope, context: DepartmentContext): Promise<TaskResult>;
  health(context: DepartmentContext): Promise<HealthReport>;
}

export class CapabilityError extends Error {}

// Builds the read capability: unknown views are refused, and the department never sees the underlying connection.
export function createReadCapability(departmentId: DepartmentId, views: Readonly<Record<string, ReadView>>): DepartmentContext["read"] {
  return async (view, params = {}) => {
    if (!Object.prototype.hasOwnProperty.call(views, view)) throw new CapabilityError(`${departmentId}: Sicht ${view} nicht freigegeben`);
    return views[view](params);
  };
}

export type EnvelopeMeta = {
  messageId: string; correlationId: string; causationId?: string | null; from: TaskSource;
  idempotencyKey: string; payload?: Record<string, unknown>; createdAt: string; deadline?: string | null;
};

// Only an executable (L0–L2) step that still matches the registry becomes a task envelope.
export function envelopeFromStep(step: ClassifiedStep, meta: EnvelopeMeta, registry: Registry = REGISTRY): { ok: true; envelope: TaskEnvelope } | { ok: false; reason: string } {
  const definition = taskDefinition(step.department, step.taskKind, registry);
  if (!definition) return { ok: false, reason: `Aufgabenart ${step.taskKind} für ${step.department} nicht erlaubt` };
  const level: PermissionLevel = levelFor(definition.action);
  if (level !== step.level || definition.handlerId !== step.handlerId) return { ok: false, reason: "Schritt passt nicht mehr zum Register" };
  if (requiresDecision(level)) return { ok: false, reason: `Stufe ${level} ist nie ausführbar, nur Entscheidungsvorlage` };
  const parsed = taskEnvelopeSchema.safeParse({
    schemaVersion: 1, messageId: meta.messageId, correlationId: meta.correlationId, causationId: meta.causationId ?? null,
    kind: "task.request", from: meta.from, to: step.department, taskKind: step.taskKind, handlerId: definition.handlerId,
    permissionLevel: level, budget: { maxModelCalls: step.maxModelCalls, maxCostCents: step.maxCostCents, deadline: meta.deadline ?? step.deadline ?? null },
    idempotencyKey: meta.idempotencyKey, payload: meta.payload ?? {}, createdAt: meta.createdAt,
  });
  return parsed.success ? { ok: true, envelope: parsed.data } : { ok: false, reason: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
}

// Kernel-side check of an envelope received from anywhere (queue, test, future API): schema, registry binding and level.
export function checkEnvelope(raw: unknown, registry: Registry = REGISTRY): { ok: true; envelope: TaskEnvelope } | { ok: false; reason: string } {
  const parsed = taskEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  const envelope = parsed.data;
  const owner = department(envelope.to, registry);
  const definition = taskDefinition(envelope.to, envelope.taskKind, registry);
  if (!owner || !definition) return { ok: false, reason: `Aufgabenart ${envelope.taskKind} für ${envelope.to} nicht erlaubt` };
  if (definition.handlerId !== envelope.handlerId) return { ok: false, reason: "Handler passt nicht zur Aufgabenart" };
  const level = levelFor(definition.action);
  if (envelope.permissionLevel !== level) return { ok: false, reason: `Stufe ${envelope.permissionLevel} widerspricht der Registerstufe ${level}` };
  if (requiresDecision(level)) return { ok: false, reason: `Stufe ${level} ist nie als Aufgabe ausführbar` };
  if (levelRank(level) > levelRank(owner.maxLevel)) return { ok: false, reason: `Stufe ${level} über der Obergrenze ${owner.maxLevel} von ${owner.id}` };
  if (!owner.runtime) return { ok: false, reason: `${owner.id} hat keine Laufzeitaufgaben` };
  return { ok: true, envelope };
}

// A result is accepted only if it parses and stays within the task's budget; overspending is reported, never hidden.
export function checkResult(raw: unknown, envelope: TaskEnvelope): { ok: true; result: TaskResult } | { ok: false; reason: string } {
  const parsed = taskResultSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  const result = parsed.data;
  if (result.usedCostCents > envelope.budget.maxCostCents) return { ok: false, reason: `Kosten ${result.usedCostCents} > Budget ${envelope.budget.maxCostCents}` };
  if (result.usedModelCalls > envelope.budget.maxModelCalls) return { ok: false, reason: `Modellaufrufe ${result.usedModelCalls} > Budget ${envelope.budget.maxModelCalls}` };
  if (result.status === "succeeded") {
    const index = result.evidence.findIndex(item => item.kind === "fact" && !item.source);
    if (index >= 0) return { ok: false, reason: `Beleg ${index + 1}: Fakt ohne Quelle` };
  }
  return { ok: true, result };
}

export function checkHealth(raw: unknown, expected: DepartmentId): { ok: true; report: HealthReport } | { ok: false; reason: string } {
  const parsed = healthReportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  if (parsed.data.department !== expected) return { ok: false, reason: `Health-Bericht von ${parsed.data.department} statt ${expected}` };
  if (parsed.data.status === "ok" && parsed.data.evidence.length === 0) return { ok: false, reason: "Status ok ohne Nachweis" };
  return { ok: true, report: parsed.data };
}

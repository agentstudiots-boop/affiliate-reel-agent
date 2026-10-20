// Executive plan contract and validator (task B-01).
//
// A (future) AI planner proposes an ExecutivePlan; this deterministic validator decides what of it may run. Only the
// structured fields count (department, taskKind, action, dependsOn, amounts). Free text in goal, evidence or decisions is
// never interpreted and can never trigger an action. The level of a step comes from the registry's action for its task kind
// via policy.ts; a level or action supplied by the model is ignored or rejected. Steps at L3a/L3b/L4 become decision requests
// for the operator, and everything that depends on them is blocked. An invalid plan yields no executable step at all.
// Nothing is executed here.

import { z } from "zod";
import { levelFor, levelRank, requiresDecision, type PermissionLevel } from "./policy";
import { REGISTRY, department, taskDefinition, type Registry } from "./registry";

const cents = z.number().int().nonnegative().refine(Number.isSafeInteger, "außerhalb des sicheren Zahlenbereichs");
// Absolute cap independent of the caller's limits, so an oversized model output is rejected before any per-step work.
export const MAX_PLAN_STEPS = 200;
// Upper bound per step (security review J-02): far above any real step, far below the integer column of the task ledger.
export const MAX_MODEL_CALLS = 1000;

const stepSchema = z.object({
  id: z.string().min(1).max(64),
  department: z.string().min(1),
  taskKind: z.string().min(1),
  action: z.string().min(1).optional(),
  /** Model-supplied level: accepted for compatibility, always ignored. */
  level: z.unknown().optional(),
  dependsOn: z.array(z.string().min(1)).max(50).default([]),
  maxCostCents: cents,
  maxModelCalls: z.number().int().nonnegative().max(MAX_MODEL_CALLS),
  deadline: z.string().optional(),
});

export const executivePlanSchema = z.object({
  goal: z.string().min(1),
  evidence: z.array(z.object({ claim: z.string().min(1), kind: z.enum(["fact", "assumption", "forecast"]), source: z.string().min(1).optional() })).default([]),
  alternatives: z.array(z.object({ title: z.string().min(1), why_not: z.string().optional() })).default([]),
  steps: z.array(stepSchema).min(1).max(MAX_PLAN_STEPS),
  expectedValue: z.object({ low: z.number(), high: z.number(), unit: z.string().min(1), kind: z.literal("forecast") }).nullable(),
  costCapCents: cents,
  abortCriteria: z.array(z.string()).default([]),
  openDecisions: z.array(z.object({ question: z.string().min(1), options: z.array(z.string()), recommendation: z.string().optional() })).default([]),
});

export type ExecutivePlan = z.infer<typeof executivePlanSchema>;
export type PlanStep = ExecutivePlan["steps"][number];
export type PlanLimits = { maxSteps: number; maxDepth: number; budgetCents: number };
export type ClassifiedStep = Omit<PlanStep, "level" | "action"> & { action: string; level: PermissionLevel; handlerId: string };
export type BlockedStep = ClassifiedStep & { blockedBy: string[] };
export type PlanValidation = {
  ok: boolean;
  plan: ExecutivePlan | null;
  executable: ClassifiedStep[];
  decisionRequests: ClassifiedStep[];
  blocked: BlockedStep[];
  violations: string[];
};

const rejected = (violations: string[], plan: ExecutivePlan | null = null): PlanValidation =>
  ({ ok: false, plan, executable: [], decisionRequests: [], blocked: [], violations });

// Longest dependency chain (number of steps) or null on a cycle.
function chainDepth(steps: readonly PlanStep[]): number | null {
  const byId = new Map(steps.map(step => [step.id, step]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number | null => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return null;
    visiting.add(id);
    let deepest = 0;
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      const inner = visit(dependency);
      if (inner === null) return null;
      deepest = Math.max(deepest, inner);
    }
    visiting.delete(id);
    depth.set(id, deepest + 1);
    return deepest + 1;
  };
  let longest = 0;
  for (const step of steps) {
    const value = visit(step.id);
    if (value === null) return null;
    longest = Math.max(longest, value);
  }
  return longest;
}

const validLimit = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validatePlan(raw: unknown, limits: PlanLimits, registry: Registry = REGISTRY): PlanValidation {
  // Invalid limits (NaN, missing, negative, e.g. from a misread setting) reject the plan; they never switch a check off.
  const limitValues: Record<string, unknown> = limits && typeof limits === "object" ? limits : {};
  const badLimits = (["maxSteps", "maxDepth", "budgetCents"] as const).filter(key => !validLimit(limitValues[key]));
  if (badLimits.length) return rejected([`Grenzwerte ungültig: ${badLimits.join(", ")}`]);
  const parsed = executivePlanSchema.safeParse(raw);
  if (!parsed.success) return rejected(parsed.error.issues.map(issue => `Schema: ${issue.path.join(".") || "(Plan)"}: ${issue.message}`));
  const plan = parsed.data;
  const violations: string[] = [];
  const classified = new Map<string, ClassifiedStep>();

  if (plan.steps.length > limits.maxSteps) return rejected([`zu viele Schritte: ${plan.steps.length} > ${limits.maxSteps}`], plan);
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  for (const step of plan.steps) (ids.has(step.id) ? duplicates : ids).add(step.id);
  for (const id of duplicates) violations.push(`Schritt-ID doppelt: ${id}`);

  for (const step of plan.steps) {
    const owner = department(step.department, registry);
    if (!owner) { violations.push(`${step.id}: unbekannte Abteilung ${step.department}`); continue; }
    const definition = taskDefinition(step.department, step.taskKind, registry);
    if (!definition) { violations.push(`${step.id}: Aufgabenart ${step.taskKind} für ${step.department} nicht erlaubt`); continue; }
    if (step.action !== undefined && step.action !== definition.action)
      violations.push(`${step.id}: Aktion ${step.action} widerspricht der Registeraktion ${definition.action} für ${step.taskKind}`);
    const level = levelFor(definition.action);
    if (!requiresDecision(level) && levelRank(level) > levelRank(owner.maxLevel))
      violations.push(`${step.id}: Stufe ${level} über der Obergrenze ${owner.maxLevel} von ${owner.id}`);
    for (const dependency of step.dependsOn) if (!ids.has(dependency)) violations.push(`${step.id}: unbekannte Abhängigkeit ${dependency}`);
    // The derived level replaces any model-supplied one.
    classified.set(step.id, { ...step, action: definition.action, level, handlerId: definition.handlerId });
  }

  const depth = violations.some(text => /unbekannte Abhängigkeit|doppelt/.test(text)) ? 0 : chainDepth(plan.steps);
  if (depth === null) violations.push("Abhängigkeiten enthalten einen Zyklus");
  else if (depth > limits.maxDepth) violations.push(`Abhängigkeitstiefe ${depth} > ${limits.maxDepth}`);

  let totalCents = 0;
  for (const step of plan.steps) totalCents += step.maxCostCents;
  if (!Number.isSafeInteger(totalCents)) violations.push("Kostensumme außerhalb des sicheren Zahlenbereichs");
  else {
    if (totalCents > plan.costCapCents) violations.push(`Kostensumme ${totalCents} > Kostendeckel ${plan.costCapCents}`);
    if (totalCents > limits.budgetCents) violations.push(`Kostensumme ${totalCents} > Budget ${limits.budgetCents}`);
  }
  if (plan.costCapCents > limits.budgetCents) violations.push(`Kostendeckel ${plan.costCapCents} > Budget ${limits.budgetCents}`);

  plan.evidence.forEach((item, index) => { if (item.kind === "fact" && !item.source?.trim()) violations.push(`Beleg ${index + 1}: Fakt ohne Quelle`); });
  if (plan.expectedValue && plan.expectedValue.low > plan.expectedValue.high) violations.push("Erwarteter Nutzen: low > high");

  if (violations.length) return rejected(violations, plan);

  // Classification of a valid plan: decision levels never run; their (transitive) successors are blocked.
  const executable: ClassifiedStep[] = [];
  const decisionRequests: ClassifiedStep[] = [];
  const blocked: BlockedStep[] = [];
  const blockers = new Map<string, Set<string>>();
  const rootsOf = (id: string): Set<string> => {
    const cached = blockers.get(id);
    if (cached) return cached;
    const step = classified.get(id)!;
    const roots = new Set<string>();
    for (const dependency of step.dependsOn) {
      if (requiresDecision(classified.get(dependency)!.level)) roots.add(dependency);
      for (const root of rootsOf(dependency)) roots.add(root);
    }
    blockers.set(id, roots);
    return roots;
  };
  for (const step of plan.steps) {
    const entry = classified.get(step.id)!;
    const roots = rootsOf(step.id);
    if (roots.size) blocked.push({ ...entry, blockedBy: [...roots].sort() });
    else if (requiresDecision(entry.level)) decisionRequests.push(entry);
    else executable.push(entry);
  }
  return { ok: true, plan, executable, decisionRequests, blocked, violations: [] };
}

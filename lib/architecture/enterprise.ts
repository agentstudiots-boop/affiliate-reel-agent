// Enterprise level of the Command Center (task H-01): data model and pure builder. No database, no clock of its own.
//
// One entry per department of the executive register (B-01). Every part says where it comes from and is null when there is
// no evidence – never an invented zero or an invented "ok":
//   health      – the department's own health report behind the contract (B-04); null if the department has no module yet
//   tasks       – counts per status from the task ledger (migration 039); null if the ledger is not readable
//   decisions   – open decision requests (migration 041); null if not readable
//   controlling – the department's line of the ControllingSnapshot (E-07); null if not readable
// Agents are the model_calls agents the reviewed register mapping (E-06) assigns to the department – static code, not activity.
// Ledger rows naming a department outside the register are listed separately instead of being dropped or reassigned.
// The reading side is lib/architecture/enterprise-snapshot.ts; the 3D scene and panels (H-03/H-04) only consume this contract.

import { z } from "zod";
import { healthReportSchema, type HealthReport } from "../enterprise/contract";
import { MODEL_AGENT_DEPARTMENTS } from "../enterprise/controlling/agent-departments";
import { controllingSnapshotSchema, type ControllingSnapshot } from "../enterprise/controlling/snapshot";
import { DEPARTMENT_IDS, REGISTRY, type DepartmentId, type Registry } from "../enterprise/registry";

const isoTime = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();
const partState = z.enum(["ok", "unavailable"]);

const departmentViewSchema = z.object({
  id: z.enum(DEPARTMENT_IDS),
  label: z.string(),
  runtime: z.boolean(),
  maxLevel: z.string(),
  taskKinds: z.array(z.string()),
  module: z.enum(["connected", "none"]),
  agents: z.array(z.string()),
  health: healthReportSchema.nullable(),
  tasks: z.object({ total: count, byStatus: z.record(z.string(), count), lastActivityAt: isoTime.nullable() }).nullable(),
  decisions: z.object({ pending: count, nextExpiry: isoTime.nullable() }).nullable(),
  controlling: controllingSnapshotSchema.shape.departments.element.nullable(),
});

export const enterpriseViewSchema = z.object({
  contractVersion: z.literal(1),
  generatedAt: isoTime,
  available: z.boolean(),
  reason: z.string().nullable(),
  parts: z.object({ health: partState, tasks: partState, decisions: partState, controlling: partState }),
  departments: z.array(departmentViewSchema),
  // Ledger rows whose department is not in the register (should not happen: the kernel only enqueues registered ones).
  unknownDepartments: z.array(z.object({ department: z.string(), tasks: count, pendingDecisions: count })),
  controlling: z.object({ period: z.string(), parts: controllingSnapshotSchema.shape.parts, unassigned: controllingSnapshotSchema.shape.unassigned }).nullable(),
});
export type EnterpriseView = z.infer<typeof enterpriseViewSchema>;
export type DepartmentView = z.infer<typeof departmentViewSchema>;

export type TaskCountRow = { department: string; status: string; count: number; lastAt: string | null };
export type DecisionCountRow = { department: string; pending: number; nextExpiry: string | null };
export type EnterpriseInputs = {
  now: Date;
  registry?: Registry;
  // Departments with a runtime module behind the contract and their health report (null: the report was not readable).
  health: Partial<Record<DepartmentId, HealthReport | null>> | null;
  tasks: readonly TaskCountRow[] | null;
  decisions: readonly DecisionCountRow[] | null;
  controlling: ControllingSnapshot | null;
  unavailableReason?: string | null;
};

const isDepartment = (value: string): value is DepartmentId => (DEPARTMENT_IDS as readonly string[]).includes(value);
const later = (a: string | null, b: string | null) => !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;
const earlier = (a: string | null, b: string | null) => !a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b;

function agentsOf(id: DepartmentId) {
  return Object.entries(MODEL_AGENT_DEPARTMENTS).filter(([, owner]) => owner === id).map(([agent]) => agent).sort();
}

export function buildEnterpriseView(inputs: EnterpriseInputs): EnterpriseView {
  const registry = inputs.registry ?? REGISTRY;
  const unknown = new Map<string, { tasks: number; pendingDecisions: number }>();
  const unknownEntry = (department: string) => unknown.get(department) ?? (unknown.set(department, { tasks: 0, pendingDecisions: 0 }), unknown.get(department)!);

  const tasks = new Map<DepartmentId, NonNullable<DepartmentView["tasks"]>>();
  if (inputs.tasks) {
    for (const id of DEPARTMENT_IDS) tasks.set(id, { total: 0, byStatus: {}, lastActivityAt: null });
    for (const row of inputs.tasks) {
      if (!isDepartment(row.department)) { unknownEntry(row.department).tasks += row.count; continue; }
      const entry = tasks.get(row.department)!;
      entry.total += row.count;
      entry.byStatus[row.status] = (entry.byStatus[row.status] ?? 0) + row.count;
      entry.lastActivityAt = later(entry.lastActivityAt, row.lastAt);
    }
  }
  const decisions = new Map<DepartmentId, NonNullable<DepartmentView["decisions"]>>();
  if (inputs.decisions) {
    for (const id of DEPARTMENT_IDS) decisions.set(id, { pending: 0, nextExpiry: null });
    for (const row of inputs.decisions) {
      if (!isDepartment(row.department)) { unknownEntry(row.department).pendingDecisions += row.pending; continue; }
      const entry = decisions.get(row.department)!;
      entry.pending += row.pending;
      entry.nextExpiry = earlier(entry.nextExpiry, row.nextExpiry);
    }
  }

  const departments = DEPARTMENT_IDS.map(id => {
    const entry = registry[id];
    const connected = !!inputs.health && Object.prototype.hasOwnProperty.call(inputs.health, id);
    return {
      id, label: entry.label, runtime: entry.runtime, maxLevel: entry.maxLevel, taskKinds: Object.keys(entry.tasks).sort(),
      module: connected ? "connected" as const : "none" as const,
      agents: agentsOf(id),
      health: connected ? inputs.health![id] ?? null : null,
      tasks: tasks.get(id) ?? null,
      decisions: decisions.get(id) ?? null,
      controlling: inputs.controlling?.departments.find(line => line.department === id) ?? null,
    };
  });
  const parts = {
    health: inputs.health && Object.values(inputs.health).some(report => report) ? "ok" as const : "unavailable" as const,
    tasks: inputs.tasks ? "ok" as const : "unavailable" as const,
    decisions: inputs.decisions ? "ok" as const : "unavailable" as const,
    controlling: inputs.controlling ? "ok" as const : "unavailable" as const,
  };
  const available = Object.values(parts).some(state => state === "ok");
  return enterpriseViewSchema.parse({
    contractVersion: 1, generatedAt: inputs.now.toISOString(), available,
    reason: available ? null : inputs.unavailableReason ?? "Keine Nachweise lesbar",
    parts, departments,
    unknownDepartments: [...unknown.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([department, value]) => ({ department, ...value })),
    controlling: inputs.controlling ? { period: inputs.controlling.period, parts: inputs.controlling.parts, unassigned: inputs.controlling.unassigned } : null,
  });
}

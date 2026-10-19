// Department registry of the executive kernel (task B-01). Static, reviewed code – not a database table.
//
// Each department lists its allowed task kinds; each task kind is bound to exactly one action kind and one handler id.
// The handlers do not exist yet: the ids only fix which future handler a task kind would reach, so a plan can never pair a
// task kind with a harmless-looking action for a handler that acts differently. maxLevel caps what the department may run
// itself (L0–L2); decision levels are handled by the plan validator regardless of maxLevel.

import type { ActionKind, PermissionLevel } from "./policy";

export const DEPARTMENT_IDS = ["executive", "controlling", "opportunity", "affiliate", "engineering"] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];
export type TaskDefinition = { readonly action: ActionKind; readonly handlerId: string };
export type Department = {
  readonly id: DepartmentId;
  readonly label: string;
  readonly maxLevel: PermissionLevel;
  /** false: works outside the production app (engineering) and has no runtime task kinds. */
  readonly runtime: boolean;
  readonly tasks: Readonly<Record<string, TaskDefinition>>;
};
export type Registry = Readonly<Record<DepartmentId, Department>>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export const REGISTRY: Registry = deepFreeze({
  executive: { id: "executive", label: "Executive", maxLevel: "L2", runtime: true, tasks: {
    "executive.prioritize": { action: "prioritize", handlerId: "executive.prioritize" },
    "executive.create_task": { action: "create_task", handlerId: "executive.createTask" },
    "executive.report_to_operator": { action: "notify_operator", handlerId: "executive.reportToOperator" },
    "executive.budget_change": { action: "change_budget", handlerId: "executive.budgetChangeRequest" },
  } },
  controlling: { id: "controlling", label: "Controlling", maxLevel: "L1", runtime: true, tasks: {
    "controlling.monthly_close": { action: "read_metrics", handlerId: "controlling.monthlyClose" },
    "controlling.cost_analysis": { action: "analyze", handlerId: "controlling.costAnalysis" },
  } },
  opportunity: { id: "opportunity", label: "Opportunity Scout", maxLevel: "L1", runtime: true, tasks: {
    "opportunity.research": { action: "research", handlerId: "opportunity.research" },
    "opportunity.assess": { action: "analyze", handlerId: "opportunity.assess" },
  } },
  affiliate: { id: "affiliate", label: "Affiliate Content Studio", maxLevel: "L0", runtime: true, tasks: {
    "affiliate.status_report": { action: "read_metrics", handlerId: "affiliate.statusReport" },
    "affiliate.publication_request": { action: "external_publish", handlerId: "affiliate.publicationRequest" },
  } },
  engineering: { id: "engineering", label: "Engineering", maxLevel: "L0", runtime: false, tasks: {} },
} satisfies Record<DepartmentId, Department>);

export function department(id: unknown, registry: Registry = REGISTRY): Department | undefined {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(registry, id) ? registry[id as DepartmentId] : undefined;
}

export function taskDefinition(departmentId: unknown, taskKind: unknown, registry: Registry = REGISTRY): TaskDefinition | undefined {
  const owner = department(departmentId, registry);
  return owner && typeof taskKind === "string" && Object.prototype.hasOwnProperty.call(owner.tasks, taskKind) ? owner.tasks[taskKind] : undefined;
}

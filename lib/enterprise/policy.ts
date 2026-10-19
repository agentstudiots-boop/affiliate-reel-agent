// Executive kernel policy (task B-01): every action kind maps to exactly one permission level.
//
// The level of a plan step is derived here from the action alone – never taken from model output. Unknown actions are
// treated as L4 (fail closed). L0–L2 may run inside a department's mandate; L3a, L3b and L4 are never executable in v0 and
// become decision requests for the operator. This module executes nothing.

export const PERMISSION_LEVELS = Object.freeze(["L0", "L1", "L2", "L3a", "L3b", "L4"] as const);
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

// L0 observe · L1 internal analysis within reserved budget · L2 reversible internal writes ·
// L3a pre-authorised message to the operator · L3b external effect · L4 money, contracts, strategy, access
export const ACTION_LEVELS = Object.freeze({
  read_metrics: "L0",
  health_check: "L0",
  analyze: "L1",
  research: "L1",
  draft: "L1",
  create_task: "L2",
  update_task_status: "L2",
  prioritize: "L2",
  write_note: "L2",
  notify_operator: "L3a",
  external_publish: "L3b",
  external_message: "L3b",
  paid_media_order: "L3b",
  spend_money: "L4",
  sign_contract: "L4",
  change_budget: "L4",
  change_access: "L4",
  change_switch: "L4",
  activate_department: "L4",
} as const satisfies Record<string, PermissionLevel>);
export type ActionKind = keyof typeof ACTION_LEVELS;
export const ACTION_KINDS = Object.freeze(Object.keys(ACTION_LEVELS) as ActionKind[]);

export function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_LEVELS, value);
}

// Unknown or malformed actions are L4: nothing unrecognised can ever run.
export function levelFor(action: unknown): PermissionLevel {
  return isActionKind(action) ? ACTION_LEVELS[action] : "L4";
}

export const levelRank = (level: PermissionLevel) => PERMISSION_LEVELS.indexOf(level);
// An unknown level (rank -1) is never executable: fail closed for every caller, not only via levelFor.
export const isExecutableLevel = (level: PermissionLevel) => levelRank(level) >= 0 && levelRank(level) <= levelRank("L2");
export const requiresDecision = (level: PermissionLevel) => !isExecutableLevel(level);

// Operating switches with a versioned rollout value.
//
// The sessions cannot set Vercel environment variables. A switch the operator approved for rollout is therefore switched
// on here, in a reviewed PR, one switch per step; the commit is the evidence of the activation. An environment variable
// always wins: "false" is the emergency stop for one switch without a deployment of code, "true" switches on early.
// Rollback = revert the rollout commit or set the variable to "false". Unknown names are off.
//
// Only switches listed here are read through this module; every other switch keeps reading process.env directly.

export const ROLLOUT = {
  // Controlling: model_calls → cost ledger import and repricing (cron /api/cron/controlling-import).
  CONTROLLING_IMPORT_ENABLED: "false",
} as const satisfies Record<string, "true" | "false">;

export type RolloutSwitch = keyof typeof ROLLOUT;
type Env = Record<string, string | undefined>;

export function switchSource(name: string, env: Env = process.env): "env" | "rollout" | "default" {
  if (env[name]?.trim()) return "env";
  return Object.prototype.hasOwnProperty.call(ROLLOUT, name) ? "rollout" : "default";
}

export function switchValue(name: string, env: Env = process.env): string | undefined {
  const value = env[name]?.trim();
  if (value) return value;
  return Object.prototype.hasOwnProperty.call(ROLLOUT, name) ? ROLLOUT[name as RolloutSwitch] : undefined;
}

export const switchOn = (name: string, env: Env = process.env) => switchValue(name, env) === "true";

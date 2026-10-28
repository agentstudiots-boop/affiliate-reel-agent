// Operating switches with a versioned rollout value.
//
// The sessions cannot set Vercel environment variables. A switch the operator approved for rollout is therefore switched
// on here, in a reviewed PR, one switch per step; the commit is the evidence of the activation. An environment variable
// always wins: "false" is the emergency stop for one switch without a deployment of code, "true" switches on early.
// Rollback = revert the rollout commit or set the variable to "false". Unknown names are off.
//
// Only switches listed here are read through this module; every other switch keeps reading process.env directly.

export const ROLLOUT = {
  // Controlling: model_calls → cost ledger import and repricing (cron /api/cron/controlling-import). On since the rollout of
  // 27.10.2026 (operator order of 24.10.2026, docs/PROJECT_STATUS.md); no provider call, no message, no assumed price.
  CONTROLLING_IMPORT_ENABLED: "true",
  // Executive: daily cycle (status report, prioritisation, health; cron /api/cron/executive-cycle), read-only.
  EXECUTIVE_ENABLED: "false",
  // Executive section in the Monday weekly report (read-only).
  EXECUTIVE_WEEKLY_REPORT: "false",
  // WhatsApp command „Executive“ from the approver number (read-only, no model call).
  EXECUTIVE_WHATSAPP: "false",
  // Topic order over WhatsApp („Mach etwas über X“, lib/topic-pipeline/topic-order.ts); only with TOPIC_PIPELINE_ENABLED.
  TOPIC_ORDERS_ENABLED: "false",
  // Editorial voice per topic (story, aha, humour, emotion, hack; lib/topics/editorial.ts).
  TOPIC_EDITORIAL_STYLE: "false",
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

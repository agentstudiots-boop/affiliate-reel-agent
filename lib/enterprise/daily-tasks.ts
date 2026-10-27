// Deterministic task source of the executive cycle (operator rollout 24.10.2026): once per Berlin day the affiliate status
// report (L0) and the executive prioritisation (L2) are queued. The idempotency key contains the Berlin day, so repeated or
// overlapping cron runs never create a second task for the same day. Both tasks have no model call and no budget; their
// envelopes go through checkEnvelope like every other task.

import type { Database } from "../memory/db";
import { enqueueTask } from "./tasks/repository";

export function berlinDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const DAILY = [
  { to: "affiliate", taskKind: "affiliate.status_report", handlerId: "affiliate.statusReport", permissionLevel: "L0", priority: 10 },
  { to: "executive", taskKind: "executive.prioritize", handlerId: "executive.prioritize", permissionLevel: "L2", priority: 5 },
] as const;

export async function enqueueDailyTasks(db: Database, now: Date = new Date()) {
  const day = berlinDay(now);
  // Fixed per day (the idempotency check compares the budget): 02:00 UTC of the next day, i.e. after Berlin midnight in summer
  // and winter time. A forgotten task expires instead of running days later.
  const deadline = new Date(Date.parse(`${day}T00:00:00Z`) + 26 * 60 * 60 * 1000).toISOString();
  const created: string[] = [];
  for (const task of DAILY) {
    const key = `daily:${task.taskKind}:${day}`;
    const result = await enqueueTask(db, { createdBy: "cron", priority: task.priority, envelope: {
      schemaVersion: 1, messageId: key, correlationId: `daily:${day}`, causationId: null, kind: "task.request", from: "cron",
      to: task.to, taskKind: task.taskKind, handlerId: task.handlerId, permissionLevel: task.permissionLevel,
      budget: { maxModelCalls: 0, maxCostCents: 0, deadline }, idempotencyKey: key, payload: { day }, createdAt: now.toISOString(),
    } });
    if (result.created) created.push(task.taskKind);
  }
  return { day, created };
}

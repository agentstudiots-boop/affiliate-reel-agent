import { randomUUID } from "node:crypto";
import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { emitEvent } from "../observability/events";
import { reconcileTopicPublications, resumeTopicProductions, runTopicPipeline, type TopicPipelineDeps } from "./orchestrator";

// Topic cron (/api/cron/topic-scout). Never publishes: it continues running video jobs, asks platforms about
// asynchronous posts and proposes at most one new topic per hourly slot via WhatsApp.
//   disabled     TOPIC_PIPELINE_ENABLED is not "true" (no database access at all)
//   locked       another run holds the lease (overlapping invocation)
//   already_ran  this hourly slot was already claimed (repeated cron call)
//   proposed / no_topic  normal outcomes
//   failed       an isolated step failed; the other steps still ran
export type CronExit = "disabled" | "locked" | "already_ran" | "proposed" | "no_topic" | "failed";
export type CronResult = { status: CronExit; slotKey: string | null; steps: Record<string, string>; contentId?: string; durationMs: number };

const LEASE_MS = 280_000; // below the function's maxDuration (300 s): a crashed run frees the lease in time

export function berlinSlotKey(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}:${get("hour")}`;
}

async function acquire(db: Database, holder: string) {
  const result = await db.query("UPDATE topic_cron_lease SET holder=$1, expires_at=now()+($2::text||' milliseconds')::interval WHERE id=1 AND expires_at<now() RETURNING holder", [holder, String(LEASE_MS)]);
  return result.rows.length > 0;
}
async function release(db: Database, holder: string) {
  await db.query("UPDATE topic_cron_lease SET expires_at='1970-01-01T00:00:00Z' WHERE id=1 AND holder=$1", [holder]);
}

export async function runTopicCron(input: { enabled: boolean; now?: Date; deps: () => TopicPipelineDeps }): Promise<CronResult> {
  const started = Date.now();
  const now = input.now ?? new Date();
  const done = (status: CronExit, slotKey: string | null, steps: Record<string, string>, extra: Partial<CronResult> = {}): CronResult => {
    const result = { status, slotKey, steps, durationMs: Date.now() - started, ...extra };
    emitEvent(status === "disabled" || status === "locked" || status === "already_ran" ? "topic_cron_skipped" : "topic_cron_completed", { status, slotKey, steps }, status === "failed" ? "error" : "info");
    return result;
  };
  if (!input.enabled) return done("disabled", null, {});
  const deps = input.deps();
  const slotKey = berlinSlotKey(now);
  const holder = randomUUID();
  await ensureAutomationSchema(deps.db);
  if (!(await acquire(deps.db, holder))) return done("locked", slotKey, {});
  emitEvent("topic_cron_started", { slotKey });
  const steps: Record<string, string> = {};
  try {
    // Each step is isolated: a failing step is recorded and the others still run.
    try { steps.resume = `${await resumeTopicProductions(deps)} fortgesetzt`; } catch (error) { steps.resume = `failed:${error instanceof Error ? error.name : "unknown"}`; }
    try { steps.reconcile = `${await reconcileTopicPublications(deps)} abgeglichen`; } catch (error) { steps.reconcile = `failed:${error instanceof Error ? error.name : "unknown"}`; }
    const run = await runTopicPipeline(deps, { slotKey });
    steps.scout = run.status;
    const failed = Object.values(steps).some(value => value.startsWith("failed"));
    if (run.status === "already_ran") return done(failed ? "failed" : "already_ran", slotKey, steps);
    if (run.status === "failed" || failed) return done("failed", slotKey, steps);
    return done(run.status, slotKey, steps, run.status === "proposed" ? { contentId: run.contentId } : {});
  } finally {
    await release(deps.db, holder).catch(() => undefined);
  }
}

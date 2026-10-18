import { randomUUID } from "node:crypto";
import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { emitEvent } from "../observability/events";
import { acquire, berlinSlotKey, insideWindow, release } from "./cron";
import { reconcileTopicPublications, resumeTopicProductions, runTopicPipeline, type TopicPipelineDeps } from "./orchestrator";

// Daily topic video (/api/cron/topic-video): at most ONE regular video proposal per Berlin calendar day, independent of
// the image post slots and of the morning topic proposal. It only drafts (briefing + content approval request); it never
// renders and never publishes – rendering needs the separate cost approval, publishing the separate publish approval.
// vercel.json calls it at 10:00, 11:00 and 12:00 UTC; the Berlin window 12:00–14:00 keeps two calls in summer time
// (12:00, 13:00) and two in winter time (12:00, 13:00). The day claim makes every further call a no-op once a proposal
// exists; a day without a proposal (no topic, failure) is retried by the next call, at most three attempts.
export const TOPIC_VIDEO_WINDOW = { from: 12, until: 14 } as const;
const MAX_ATTEMPTS = 3;

export type VideoCronExit = "disabled" | "outside_window" | "locked" | "already_proposed" | "exhausted" | "in_progress" | "proposed" | "no_topic" | "failed";
export type VideoCronResult = { status: VideoCronExit; day: string | null; steps: Record<string, string>; contentId?: string };

// Claims the Berlin day for one attempt. Returns false when a proposal exists, the attempts are used up or another run
// is still working on it (a claim older than 10 minutes counts as a crashed run).
async function claimDay(db: Database, day: string): Promise<{ ok: true } | { ok: false; reason: "already_proposed" | "exhausted" | "in_progress" }> {
  const fresh = await db.query("INSERT INTO topic_video_days(day,status) VALUES($1,'claimed') ON CONFLICT (day) DO NOTHING RETURNING day", [day]);
  if (fresh.rows.length) return { ok: true };
  const retry = await db.query(`UPDATE topic_video_days SET status='claimed', attempts=attempts+1, updated_at=now() WHERE day=$1 AND attempts<$2
    AND (status IN ('no_topic','failed') OR (status='claimed' AND updated_at < now() - interval '10 minutes')) RETURNING day`, [day, MAX_ATTEMPTS]);
  if (retry.rows.length) return { ok: true };
  const row = (await db.query("SELECT status, attempts FROM topic_video_days WHERE day=$1", [day])).rows[0];
  if (row?.status === "proposed") return { ok: false, reason: "already_proposed" };
  return { ok: false, reason: Number(row?.attempts ?? 0) >= MAX_ATTEMPTS ? "exhausted" : "in_progress" };
}

export async function runTopicVideoCron(input: { enabled: boolean; now?: Date; deps: () => TopicPipelineDeps; window?: { from: number; until: number } }): Promise<VideoCronResult> {
  const now = input.now ?? new Date();
  const done = (status: VideoCronExit, day: string | null, steps: Record<string, string>, extra: Partial<VideoCronResult> = {}) => {
    emitEvent("topic_video_cron", { status, day, steps }, status === "failed" ? "error" : "info");
    return { status, day, steps, ...extra };
  };
  if (!input.enabled) return done("disabled", null, {});
  const slotKey = berlinSlotKey(now);
  const day = slotKey.slice(0, 10);
  const deps = input.deps();
  await ensureAutomationSchema(deps.db);
  const steps: Record<string, string> = {};
  const holder = randomUUID();
  if (!(await acquire(deps.db, holder))) return done("locked", day, steps);
  try {
    // Running video renders are continued on every call (never re-created); asynchronous posts are reconciled.
    try { steps.resume = `${await resumeTopicProductions(deps)} fortgesetzt`; } catch (error) { steps.resume = `failed:${error instanceof Error ? error.name : "unknown"}`; }
    try { steps.reconcile = `${await reconcileTopicPublications(deps)} abgeglichen`; } catch (error) { steps.reconcile = `failed:${error instanceof Error ? error.name : "unknown"}`; }
    if (!insideWindow(slotKey, input.window ?? TOPIC_VIDEO_WINDOW)) return done("outside_window", day, steps);
    const claim = await claimDay(deps.db, day);
    if (!claim.ok) return done(claim.reason, day, steps);
    const run = await runTopicPipeline(deps, { slotKey: null, videoDay: day });
    steps.video = run.status;
    const status = run.status === "proposed" ? "proposed" : run.status === "no_topic" ? "no_topic" : "failed";
    await deps.db.query("UPDATE topic_video_days SET status=$2, content_id=$3, reason=$4, updated_at=now() WHERE day=$1",
      [day, status, run.status === "proposed" ? run.contentId : null, "failure" in run && run.failure ? String(run.failure).slice(0, 160) : null]);
    if (status === "proposed") emitEvent("topic_video_proposed", { day, contentId: run.status === "proposed" ? run.contentId : null });
    return done(status, day, steps, run.status === "proposed" ? { contentId: run.contentId } : {});
  } catch (error) {
    steps.video = `failed:${error instanceof Error ? error.name : "unknown"}`;
    await deps.db.query("UPDATE topic_video_days SET status='failed', reason=$2, updated_at=now() WHERE day=$1 AND status='claimed'", [day, steps.video]).catch(() => undefined);
    return done("failed", day, steps);
  } finally {
    await release(deps.db, holder).catch(() => undefined);
  }
}

import { effectDecision } from "@/lib/security/runtime-guard";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/lib/memory/db";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";
import { runExecutiveCycle } from "@/lib/enterprise/cycle";
import { affiliateContext, affiliateDepartment } from "@/lib/enterprise/departments/affiliate";
import { executiveContext, executiveDepartment } from "@/lib/enterprise/departments/executive";
import { enqueueDailyTasks } from "@/lib/enterprise/daily-tasks";
import { checkHealth } from "@/lib/enterprise/contract";
import { switchOn } from "@/lib/config/rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Executive cycle (task B-07; scheduled once a day since the operator rollout of 24.10.2026). Off unless EXECUTIVE_ENABLED is on
// (lib/config/rollout.ts); without the switch the route returns before touching the database. Per run: queue the day's status
// report and prioritisation (idempotent per Berlin day), run at most three tasks, record the health of every department.
// Everything is read-only or an internal note (L0–L2): no message, publication, spending or switch change.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!switchOn("EXECUTIVE_ENABLED")) return Response.json({ status: "disabled" }, { headers: { "Cache-Control": "no-store" } });
  // The cycle writes to the database: never from preview/development deployments.
  if (!effectDecision("scheduled_job").ok) return Response.json({ status: "skipped_non_production_environment" }, { headers: { "Cache-Control": "no-store" } });
  try {
    const db = getDatabase();
    await ensureAutomationSchema(db);
    const daily = await enqueueDailyTasks(db);
    const report = await runExecutiveCycle(db, {
      holder: `cron-${randomUUID()}`, leaseMs: 5 * 60 * 1000, maxTasks: 3, handlerTimeoutMs: 15_000, // 3 × 15 s within maxDuration 60 s
      departments: { affiliate: affiliateDepartment, executive: executiveDepartment },
      contextFor: department => {
        if (department === "affiliate") return affiliateContext(db);
        if (department === "executive") return executiveContext(db);
        throw new Error("Abteilung ohne Kontext");
      },
    });
    // Health after the tasks, so the executive sees today's status report. A failing check is reported, never thrown.
    const health = await Promise.all(([["affiliate", affiliateDepartment, affiliateContext(db)], ["executive", executiveDepartment, executiveContext(db)]] as const)
      .map(async ([id, module, context]) => { const checked = checkHealth(await module.health(context).catch(() => null), id);
        return checked.ok ? { department: id, status: checked.report.status, reason: checked.report.reason ?? null } : { department: id, status: "unknown", reason: checked.reason }; }));
    console.info(JSON.stringify({ event: "executive_cycle", day: daily.day, queued: daily.created, ran: report.ran.map(item => `${item.taskKind}:${item.outcome}`),
      reclaimed: report.reclaimed, expiredDecisions: report.expiredDecisions, health }));
    return Response.json({ status: "ok", daily, ...report, health }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "executive_cycle_failed" }));
    return Response.json({ error: "Executive-Zyklus konnte nicht sicher ausgeführt werden." }, { status: 503 });
  }
}

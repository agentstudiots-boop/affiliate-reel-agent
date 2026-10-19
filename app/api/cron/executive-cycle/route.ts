import { effectDecision } from "@/lib/security/runtime-guard";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/lib/memory/db";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";
import { runExecutiveCycle } from "@/lib/enterprise/cycle";
import { affiliateContext, affiliateDepartment } from "@/lib/enterprise/departments/affiliate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Executive cycle (task B-07). Deliberately NOT scheduled in vercel.json: scheduling it, and setting EXECUTIVE_ENABLED=true,
// are separate operator decisions. Without the switch the route returns before touching the database.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (process.env.EXECUTIVE_ENABLED !== "true") return Response.json({ status: "disabled" }, { headers: { "Cache-Control": "no-store" } });
  // The cycle writes to the database: never from preview/development deployments.
  if (!effectDecision("scheduled_job").ok) return Response.json({ status: "skipped_non_production_environment" }, { headers: { "Cache-Control": "no-store" } });
  try {
    const db = getDatabase();
    await ensureAutomationSchema(db);
    const report = await runExecutiveCycle(db, {
      holder: `cron-${randomUUID()}`, leaseMs: 5 * 60 * 1000, maxTasks: 3, handlerTimeoutMs: 15_000, // 3 × 15 s within maxDuration 60 s
      departments: { affiliate: affiliateDepartment },
      contextFor: department => {
        if (department !== "affiliate") throw new Error("Abteilung ohne Kontext");
        return affiliateContext(db);
      },
    });
    console.info(JSON.stringify({ event: "executive_cycle", ran: report.ran.length, reclaimed: report.reclaimed, expiredDecisions: report.expiredDecisions }));
    return Response.json({ status: "ok", ...report }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "executive_cycle_failed" }));
    return Response.json({ error: "Executive-Zyklus konnte nicht sicher ausgeführt werden." }, { status: 503 });
  }
}

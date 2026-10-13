import { effectDecision } from "@/lib/security/runtime-guard";
import { timingSafeEqual } from "node:crypto";
import { createDailyDraft } from "@/lib/daily/draft";
import { resolveSlot } from "@/lib/daily/slots";
import { recordSlotRun, type SlotRun } from "@/lib/daily/evidence";
import { getDatabase } from "@/lib/memory/db";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";

// Durable proof of every scheduled invocation (runtime logs are kept for one hour only). Never affects the result.
async function evidence(run: SlotRun) {
  try { const db = getDatabase(); await ensureAutomationSchema(db); await recordSlotRun(db, run); }
  catch { console.error(JSON.stringify({ event: "daily_slot_evidence_unsaved", outcome: run.outcome })); }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function berlinSlot(now: Date) {
  return resolveSlot(now).slot;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    console.warn(JSON.stringify({ event: "daily_cron_unauthorized", secretConfigured: !!secret, credentialSent: !!given }));
    return new Response("Unauthorized", { status: 401 });
  }
  // Scheduled jobs write to the database and message the operator: never from preview/development deployments.
  if (!effectDecision("scheduled_job").ok) return Response.json({ status: "skipped_non_production_environment" }, { headers: { "Cache-Control": "no-store" } });
  try {
    // Six single-run UTC schedules; the local window (not the minute) selects the
    // slot, and the (day, slot) DB claim makes repeated or late calls idempotent.
    const now = new Date();
    const { slot, day, localTime, timeZone, utc } = resolveSlot(now);
    console.info(JSON.stringify({ event: "daily_cron_invocation", utc, timeZone, localDay: day, localTime, slot,
      scheduledBy: request.headers.get("x-vercel-cron-schedule") ?? undefined }));
    if (!slot) {
      console.info(JSON.stringify({ event: "daily_cron_outside_window", localDay: day, localTime }));
      await evidence({ day, slot: null, outcome: "outside_berlin_slot" });
      return Response.json({ status: "outside_berlin_slot" });
    }
    let result: Awaited<ReturnType<typeof createDailyDraft>>;
    try { result = await createDailyDraft(day, slot); }
    catch (error) {
      await evidence({ day, slot, outcome: "error", reason: error instanceof Error ? error.message : "unbekannt" });
      throw error;
    }
    const whatsapp = "whatsapp" in result ? String(result.whatsapp) : null;
    console.info(JSON.stringify({ event: "daily_draft", day, slot, status: result.status, whatsapp: whatsapp ?? undefined, jobId: "jobId" in result ? result.jobId : undefined }));
    await evidence({ day, slot, outcome: result.status, whatsapp, jobId: "jobId" in result ? String(result.jobId) : null, reason: "reason" in result && result.reason ? String(result.reason) : null });
    return Response.json(result, { status: result.status === "failed" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "daily_draft_storage_failed" }));
    return Response.json({ error: "Tagesauftrag nicht verfügbar." }, { status: 503 });
  }
}

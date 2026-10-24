import { timingSafeEqual } from "node:crypto";
import { switchOn } from "@/lib/config/rollout";
import { runControllingImport } from "@/lib/enterprise/controlling/import-run";
import { getDatabase } from "@/lib/memory/db";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";
import { effectDecision } from "@/lib/security/runtime-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Controlling import (task E-03 wired): books new model_calls into cost_entries and applies prices entered since. Writes only
// the cost ledger; no provider call, no message, no assumed price. Off unless CONTROLLING_IMPORT_ENABLED is on (lib/config/rollout.ts).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const headers = { "Cache-Control": "no-store" };
  if (!switchOn("CONTROLLING_IMPORT_ENABLED")) return Response.json({ status: "disabled" }, { headers });
  if (!effectDecision("scheduled_job").ok) return Response.json({ status: "skipped_non_production_environment" }, { headers });
  try {
    const db = getDatabase();
    await ensureAutomationSchema(db);
    const run = await runControllingImport(db);
    console.info(JSON.stringify({ event: "controlling_import", ...run }));
    return Response.json(run, { headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "controlling_import_failed", failure: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: "Kostenimport konnte nicht sicher ausgeführt werden." }, { status: 503, headers });
  }
}

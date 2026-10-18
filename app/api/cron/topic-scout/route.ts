import { effectDecision } from "@/lib/security/runtime-guard";
import { timingSafeEqual } from "node:crypto";
import { runTopicCron, TOPIC_PROPOSAL_WINDOW } from "@/lib/topic-pipeline/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Topic pipeline cron. Off unless TOPIC_PIPELINE_ENABLED=true. It proposes topics via WhatsApp, continues running video
// jobs and reconciles asynchronous posts; it never publishes (publishing needs the operator's explicit WhatsApp approval
// of the exact version plus TOPIC_LIVE_PUBLISHING). Scheduled at 07:00 and 08:00 UTC (vercel.json); proposals only inside
// TOPIC_PROPOSAL_WINDOW (Berlin 08–11). Without TOPIC_PIPELINE_ENABLED=true every call ends as "disabled".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Scheduled jobs write to the database and message the operator: never from preview/development deployments.
  if (!effectDecision("scheduled_job").ok) return Response.json({ status: "skipped_non_production_environment" }, { headers: { "Cache-Control": "no-store" } });
  try {
    const enabled = process.env.TOPIC_PIPELINE_ENABLED === "true";
    // The runtime wiring (database, providers, WhatsApp) is only loaded when the pipeline is enabled.
    const deps = enabled ? (await import("@/lib/agents/topic-runtime")).topicPipelineDeps : () => { throw new Error("topic_pipeline_disabled"); };
    const result = await runTopicCron({ enabled, deps, proposalWindow: TOPIC_PROPOSAL_WINDOW });
    return Response.json(result, { status: result.status === "failed" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "topic_cron_completed", status: "failed", stage: "setup" }));
    return Response.json({ status: "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

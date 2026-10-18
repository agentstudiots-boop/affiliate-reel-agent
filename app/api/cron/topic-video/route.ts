import { effectDecision } from "@/lib/security/runtime-guard";
import { timingSafeEqual } from "node:crypto";
import { runTopicVideoCron } from "@/lib/topic-pipeline/video-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily topic video proposal (12:00 Europe/Berlin). Drafts only: briefing + content approval request via WhatsApp.
// Never renders (separate cost approval) and never publishes (separate publish approval). Off unless both
// TOPIC_PIPELINE_ENABLED=true and TOPIC_DAILY_VIDEO=true.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!effectDecision("scheduled_job").ok) return Response.json({ status: "skipped_non_production_environment" }, { headers: { "Cache-Control": "no-store" } });
  try {
    const enabled = process.env.TOPIC_PIPELINE_ENABLED === "true" && process.env.TOPIC_DAILY_VIDEO === "true";
    const deps = enabled ? (await import("@/lib/agents/topic-runtime")).topicPipelineDeps : () => { throw new Error("topic_video_disabled"); };
    const result = await runTopicVideoCron({ enabled, deps });
    return Response.json(result, { status: result.status === "failed" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "topic_video_cron", status: "failed", stage: "setup" }));
    return Response.json({ status: "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

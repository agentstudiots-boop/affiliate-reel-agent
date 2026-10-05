import { timingSafeEqual } from "node:crypto";
import { topicPipelineDeps } from "@/lib/agents/topic-runtime";
import { resumeTopicProductions, runTopicPipeline } from "@/lib/topic-pipeline/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Topic pipeline cron. Off unless TOPIC_PIPELINE_ENABLED=true. It proposes topics via WhatsApp and continues running
// video jobs; it never publishes (publishing needs the operator's explicit WhatsApp approval of the exact version).
// Not yet scheduled in vercel.json: adding the schedule is a separate, approved deployment step.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (process.env.TOPIC_PIPELINE_ENABLED !== "true") return Response.json({ status: "disabled" }, { headers: { "Cache-Control": "no-store" } });
  const deps = topicPipelineDeps();
  const resumed = await resumeTopicProductions(deps).catch(() => 0);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const result = await runTopicPipeline(deps, { slotKey: `${get("year")}-${get("month")}-${get("day")}:${get("hour")}` });
  return Response.json({ ...result, resumed }, { headers: { "Cache-Control": "no-store" } });
}

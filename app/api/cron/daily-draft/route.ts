import { timingSafeEqual } from "node:crypto";
import { createDailyDraft } from "@/lib/daily/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function berlinSlot(now: Date): "morning" | "afternoon" | null {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour === 9 ? "morning" : hour === 18 ? "afternoon" : null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    // Four UTC opportunities cover both CET and CEST. Only the local 09:00
    // and 18:00 invocations claim a slot; delayed runs remain idempotent.
    const slot = berlinSlot(new Date());
    if (!slot) return Response.json({ status: "outside_berlin_slot" });
    const result = await createDailyDraft(undefined, slot);
    console.info(JSON.stringify({ event: "daily_draft", status: result.status, whatsapp: "whatsapp" in result ? result.whatsapp : undefined, jobId: "jobId" in result ? result.jobId : undefined }));
    return Response.json(result, { status: result.status === "failed" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "daily_draft_storage_failed" }));
    return Response.json({ error: "Tagesauftrag nicht verfügbar." }, { status: 503 });
  }
}

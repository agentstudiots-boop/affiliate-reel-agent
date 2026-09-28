import { timingSafeEqual } from "node:crypto";
import { createDailyDraft } from "@/lib/daily/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function berlinSlot(now: Date): "morning" | "afternoon" | null {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(now));
  // Hobby cron can arrive up to 59 minutes after the configured UTC hour.
  return hour === 9 || hour === 10 ? "morning"
    : hour === 18 || hour === 19 ? "afternoon" : null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    // Four single-run UTC schedules cover CET and CEST. The two-hour local
    // window tolerates Hobby scheduling delays; the DB claim is idempotent.
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

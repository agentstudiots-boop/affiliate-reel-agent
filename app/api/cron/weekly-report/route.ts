import { timingSafeEqual } from "node:crypto";
import { createWeeklyReport } from "@/lib/reporting/weekly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await createWeeklyReport();
    console.info(JSON.stringify({ event: "weekly_report", weekStart: result.weekStart, status: result.status }));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "weekly_report_failed" }));
    return Response.json({ error: "Wochenbericht konnte nicht sicher erstellt oder zugestellt werden." }, { status: 503 });
  }
}

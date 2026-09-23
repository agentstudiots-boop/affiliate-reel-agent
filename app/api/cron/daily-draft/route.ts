import { timingSafeEqual } from "node:crypto";
import { createDailyDraft } from "@/lib/daily/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await createDailyDraft();
    console.info(JSON.stringify({ event: "daily_draft", status: result.status }));
    return Response.json(result, { status: result.status === "failed" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "daily_draft_storage_failed" }));
    return Response.json({ error: "Tagesauftrag nicht verfügbar." }, { status: 503 });
  }
}

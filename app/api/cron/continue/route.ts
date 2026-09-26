import { timingSafeEqual } from "node:crypto";
import { continuePendingReels } from "@/lib/automation/continue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!secret || !given || Buffer.byteLength(given) !== Buffer.byteLength(secret)
    || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new Response("Unauthorized", { status: 401 });
  try {
    const result = await continuePendingReels();
    console.info(JSON.stringify({ event: "reel_continuation", ...result }));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "reel_continuation_storage_failed" }));
    return Response.json({ error: "Fortsetzung nicht verfügbar." }, { status: 503 });
  }
}

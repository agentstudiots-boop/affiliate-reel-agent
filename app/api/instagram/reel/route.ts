import { advanceInstagram } from "@/lib/meta/advance-instagram";
import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured, getDatabase } from "@/lib/memory/db";
import { instagramReelRepository, InstagramReelConflict } from "@/lib/meta/instagram-reel";
import { instagramGraph, InstagramPublishFailure } from "@/lib/meta/instagram-publisher";
import { sendWhatsAppText, whatsappApprovalReady } from "@/lib/whatsapp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({ jobId: z.string().uuid(), action: z.enum(["request","publish","poll"]) });
function guard(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres fehlt." }, { status: 503 });
}

export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const jobId = z.string().uuid().parse(new URL(request.url).searchParams.get("jobId"));
    return Response.json({ publication: await instagramReelRepository().get(jobId) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Reel-Status nicht abrufbar." }, { status: 400 }); }
}

export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 1500) return Response.json({ error: "Anfrage zu groß." }, { status: 413 });
    const { jobId, action } = requestSchema.parse(JSON.parse(raw));
    const repo = instagramReelRepository();
    return Response.json(await advanceInstagram(jobId, action, repo, instagramGraph, getDatabase(), sendWhatsAppText, whatsappApprovalReady));
  } catch (error) {
    if (error instanceof InstagramPublishFailure) console.error(JSON.stringify({ event: "instagram_publication_blocked", phase: error.phase, detail: error.detail, httpStatus: error.httpStatus, code: error.code, subcode: error.subcode }));
    return Response.json({ error: error instanceof InstagramReelConflict ? error.message : error instanceof InstagramPublishFailure
      ? "Instagram-Vorgang nicht eindeutig bestätigt. Status prüfen; keinen zweiten Upload oder Post starten." : "Instagram-Vorgang unklar. Status prüfen; keine automatische Wiederholung." },
    { status: error instanceof InstagramReelConflict ? 409 : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 });
  }
}

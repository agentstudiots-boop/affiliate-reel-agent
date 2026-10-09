import { advanceInstagram } from "@/lib/meta/advance-instagram";
import { publishApprovedAffiliateReel } from "@/lib/distribution/affiliate";
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
    const db = getDatabase();
    if (action === "publish") {
      // Container creation is a publication step: it runs through the shared distribution layer and the central approval gate
      // (same path as the automatic continuation), never directly. Without a valid approval of the exact current version nothing is created.
      const run = await publishApprovedAffiliateReel(jobId, { db, send: sendWhatsAppText,
        affiliate: { reel: id => advanceInstagram(id, "publish", repo, instagramGraph, db, sendWhatsAppText, whatsappApprovalReady), reels: () => repo } });
      if (!run) throw new InstagramReelConflict("Eine eigene WhatsApp-Veröffentlichungsfreigabe fehlt oder der Versuch wurde bereits gestartet.");
      const instagram = run.outcomes.find(item => item.platform === "instagram");
      if (instagram?.status === "blocked") throw new InstagramReelConflict("Die Veröffentlichung ist durch die zentrale Freigabeprüfung gesperrt.");
      if (!instagram || !["processing", "published"].includes(instagram.status))
        return Response.json({ error: "Instagram-Vorgang nicht eindeutig bestätigt. Status prüfen; keinen zweiten Upload oder Post starten." }, { status: 503 });
      return Response.json({ publication: await repo.get(jobId), stage: "processing" });
    }
    return Response.json(await advanceInstagram(jobId, action, repo, instagramGraph, db, sendWhatsAppText, whatsappApprovalReady));
  } catch (error) {
    if (error instanceof InstagramPublishFailure) console.error(JSON.stringify({ event: "instagram_publication_blocked", phase: error.phase, detail: error.detail, httpStatus: error.httpStatus, code: error.code, subcode: error.subcode }));
    return Response.json({ error: error instanceof InstagramReelConflict ? error.message : error instanceof InstagramPublishFailure
      ? "Instagram-Vorgang nicht eindeutig bestätigt. Status prüfen; keinen zweiten Upload oder Post starten." : "Instagram-Vorgang unklar. Status prüfen; keine automatische Wiederholung." },
    { status: error instanceof InstagramReelConflict ? 409 : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 });
  }
}

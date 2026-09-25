import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured, getDatabase } from "@/lib/memory/db";
import { instagramReelRepository, InstagramReelConflict } from "@/lib/meta/instagram-reel";
import { instagramGraph, InstagramPublishFailure } from "@/lib/meta/instagram-publisher";
import { sendWhatsAppText, whatsappApprovalReady, WhatsAppRejectedError } from "@/lib/whatsapp/client";

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
    if (action === "request") {
      if (!whatsappApprovalReady()) throw new InstagramReelConflict("WhatsApp-Freigabe ist nicht eingerichtet.");
      // Read-only Graph checks: fail before persisting an approval if Instagram is inaccessible.
      await instagramGraph();
      const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
      let publication = await repo.prepare(jobId, approver);
      if (publication.status !== "pending" || publication.whatsappMessageId) return Response.json({ publication });
      const recent = await getDatabase().query("SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1", [approver]);
      if (!recent.rows.length) return Response.json({ publication, whatsapp: "service_window_required" });
      await repo.claimWhatsAppSend(publication.id);
      try {
        const messageId = await sendWhatsAppText(`Instagram-Reel · separate Veröffentlichungsfreigabe\n\nVideo ansehen: ${publication.videoUrl}\n\nBeitrag:\n${publication.caption.slice(0,1750)}\n\nAntworte auf DIESE Nachricht mit „Freigeben“ für genau ein Reel oder „Ablehnen“. Dieser Schritt kauft kein neues Video.`);
        publication = await repo.bindMessage(publication.id,messageId);
        return Response.json({ publication, approvalSent: true });
      } catch (error) {
        if (error instanceof WhatsAppRejectedError) {
          await repo.releaseRejectedWhatsAppSend(publication.id);
          throw new InstagramReelConflict("Meta hat die WhatsApp-Nachricht abgelehnt. Kein Reel wurde veröffentlicht.");
        }
        throw error;
      }
    }
    const publication = await repo.get(jobId);
    if (!publication) throw new InstagramReelConflict("Reel-Freigabe fehlt.");
    if (action === "poll" && publication.status === "published" && publication.mediaId && !publication.permalink) {
      const graph = await instagramGraph();
      await repo.setPermalink(publication.id,await graph.permalink(publication.mediaId));
      return Response.json({ publication: await repo.get(jobId), stage: "published" });
    }
    if (action === "publish") {
      if (publication.status !== "approved") throw new InstagramReelConflict("Eine eigene WhatsApp-Veröffentlichungsfreigabe fehlt oder der Versuch wurde bereits gestartet.");
      const graph = await instagramGraph();
      const claimed = await repo.claimContainer(publication.id);
      try {
        const id = await graph.create(claimed.videoUrl,claimed.caption);
        const saved = await repo.bindContainer(claimed.id,id);
        return Response.json({ publication: saved, stage: "processing" });
      } catch (error) {
        await repo.markUnknown(claimed.id);
        throw error;
      }
    }
    if (publication.status !== "processing" || !publication.containerId) throw new InstagramReelConflict("Kein bestätigter Instagram-Container zum Abfragen vorhanden.");
    const graph = await instagramGraph();
    const state = await graph.status(publication.containerId);
    if (state === "PROCESSING") return Response.json({ publication, stage: "processing" });
    if (state === "ERROR") {
      await repo.markUnknown(publication.id);
      return Response.json({ publication: await repo.get(jobId), stage: "unknown" });
    }
    const claimed = await repo.claimMediaPublish(publication.id);
    let mediaId: string;
    try { mediaId = await graph.publish(claimed.containerId!); }
    catch (error) { await repo.markUnknown(claimed.id); throw error; }
    // Once Graph confirms the media ID, persist publication before fetching the optional permalink.
    const saved = await repo.markPublished(claimed.id, mediaId);
    try { await repo.setPermalink(saved.id,await graph.permalink(mediaId)); }
    catch { console.warn(JSON.stringify({ event: "instagram_permalink_unavailable", publicationId: saved.id })); }
    console.info(JSON.stringify({ event: "instagram_publication", publicationId: saved.id, status: "published" }));
    return Response.json({ publication: await repo.get(jobId), stage: "published" });
  } catch (error) {
    if (error instanceof InstagramPublishFailure) console.error(JSON.stringify({ event: "instagram_publication_blocked", phase: error.phase, detail: error.detail, httpStatus: error.httpStatus, code: error.code, subcode: error.subcode }));
    return Response.json({ error: error instanceof InstagramReelConflict ? error.message : error instanceof InstagramPublishFailure
      ? "Instagram-Vorgang nicht eindeutig bestätigt. Status prüfen; keinen zweiten Upload oder Post starten." : "Instagram-Vorgang unklar. Status prüfen; keine automatische Wiederholung." },
    { status: error instanceof InstagramReelConflict ? 409 : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 });
  }
}

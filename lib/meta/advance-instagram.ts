import { getDatabase } from "../memory/db";
import { instagramReelRepository, InstagramReelConflict } from "./instagram-reel";
import { instagramGraph } from "./instagram-publisher";
import { sendWhatsAppText, whatsappApprovalReady, WhatsAppRejectedError } from "../whatsapp/client";

export async function advanceInstagram(jobId: string, action: "request" | "publish" | "poll",
  repo = instagramReelRepository(), graphFactory = instagramGraph,
  db = getDatabase(), send = sendWhatsAppText, approvalReady = whatsappApprovalReady) {
  if (action === "request") {
    if (!approvalReady()) throw new InstagramReelConflict("WhatsApp-Freigabe ist nicht eingerichtet.");
    // Read-only Graph checks: fail before persisting an approval if Instagram is inaccessible.
    await graphFactory();
    const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
    let publication = await repo.prepare(jobId, approver);
    if (publication.status !== "pending" || publication.whatsappMessageId) return { publication };
    const recent = await db.query("SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1", [approver]);
    if (!recent.rows.length) return { publication, whatsapp: "service_window_required" };
    await repo.claimWhatsAppSend(publication.id);
    try {
      const messageId = await send(`Instagram-Reel · separate Veröffentlichungsfreigabe\n\nVideo ansehen: ${publication.videoUrl}\n\nBeitrag:\n${publication.caption.slice(0,1750)}\n\nAntworte auf DIESE Nachricht mit „Freigeben“ für genau ein Reel oder „Ablehnen“. Dieser Schritt kauft kein neues Video.`);
      publication = await repo.bindMessage(publication.id,messageId);
      return { publication, approvalSent: true };
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
    const graph = await graphFactory();
    await repo.setPermalink(publication.id,await graph.permalink(publication.mediaId));
    return { publication: await repo.get(jobId), stage: "published" };
  }
  if (action === "publish") {
    if (publication.status !== "approved") throw new InstagramReelConflict("Eine eigene WhatsApp-Veröffentlichungsfreigabe fehlt oder der Versuch wurde bereits gestartet.");
    const graph = await graphFactory();
    const claimed = await repo.claimContainer(publication.id);
    try {
      const id = await graph.create(claimed.videoUrl,claimed.caption);
      const saved = await repo.bindContainer(claimed.id,id);
      return { publication: saved, stage: "processing" };
    } catch (error) {
      await repo.markUnknown(claimed.id);
      throw error;
    }
  }
  if (publication.status !== "processing" || !publication.containerId) throw new InstagramReelConflict("Kein bestätigter Instagram-Container zum Abfragen vorhanden.");
  const graph = await graphFactory();
  const state = await graph.status(publication.containerId);
  if (state === "PROCESSING") return { publication, stage: "processing" };
  if (state === "ERROR") {
    await repo.markUnknown(publication.id);
    return { publication: await repo.get(jobId), stage: "unknown" };
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
  return { publication: await repo.get(jobId), stage: "published" };
}

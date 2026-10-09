import type { Database } from "../memory/db";
import { alreadyNotified, requestFacebookApproval } from "./request-publication";
import { sendWhatsAppText } from "../whatsapp/client";

// What the operator reads when the step after the content approval (image + publication request) cannot complete.
export function publicationPreparationFailureText(error: unknown) {
  const reason = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "").slice(0, 400) : "Status unklar.";
  return `Der Inhalt ist freigegeben, aber die Bildgenerierung bzw. Veröffentlichungsfreigabe konnte nicht abgeschlossen werden: ${reason} Es wurde nichts veröffentlicht. „Status“ zeigt Details.`;
}

// „Weiter“ restarts the step for approved drafts that never received their image/publication request.
// requestFacebookApproval keeps its own one-attempt gate, so this can never buy a second image for the same draft.
export async function resumeApprovedDailyPublications(db: Database, request = requestFacebookApproval, notify = sendWhatsAppText) {
  const pending = await db.query(`SELECT d.job_id FROM daily_drafts d
    WHERE d.status='content_approved' AND d.updated_at>now()-interval '24 hours'
      AND NOT EXISTS(SELECT 1 FROM publication_requests p WHERE p.job_id=d.job_id AND p.platform='facebook')
      AND NOT EXISTS(SELECT 1 FROM original_visual_attempts a WHERE a.job_id=d.job_id)
    ORDER BY d.updated_at LIMIT 2`);
  let resumed = 0;
  for (const row of pending.rows) {
    try { await request(String(row.job_id)); resumed++; }
    catch (error) {
      console.error(JSON.stringify({ event: "daily_publication_resume_failed", jobId: String(row.job_id), reason: error instanceof Error ? error.name : "unknown" }));
      if (!alreadyNotified(error)) try { await notify(publicationPreparationFailureText(error)); } catch { /* the failure is logged above */ }
    }
  }
  return resumed;
}

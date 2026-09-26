import { interpretInstruction } from "@/lib/whatsapp/instruction";
import { processOperatorInstruction } from "@/lib/whatsapp/process-instruction";
import { after } from "next/server";
import { continuePendingReels } from "@/lib/automation/continue";
import { productionRepository } from "@/lib/production/repository";
import { publicationRepository } from "@/lib/meta/publication-gate";
import { FacebookPublishFailure, publishFacebookPhoto } from "@/lib/meta/publisher";
import { requestFacebookApproval } from "@/lib/meta/request-publication";
import { sendDailyApproval } from "@/lib/daily/draft";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { deliverWeeklyReport } from "@/lib/reporting/weekly";
import { extractIncomingWhatsAppMessages, verifyMetaWebhookSignature, verifyWhatsAppChallenge } from "@/lib/whatsapp/security";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode") || "";
  const token = params.get("hub.verify_token") || "";
  const challenge = params.get("hub.challenge") || "";
  if (mode === "subscribe" && challenge && verifyWhatsAppChallenge(token)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }
  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 256_000) return new Response("Payload too large", { status: 413 });
  if (!verifyMetaWebhookSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATTSAPP_PHONE_NUMBER_ID || "";
  const messages = extractIncomingWhatsAppMessages(payload, phoneNumberId);
  if (!messages.length) return new Response("EVENT_RECEIVED", { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  let repo;
  try { repo = productionRepository(); }
  catch {
    console.error(JSON.stringify({ event: "whatsapp_database_unavailable" }));
    return new Response("Storage unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  after(async () => {
    try { await continuePendingReels(); }
    catch { console.error(JSON.stringify({ event: "reel_continuation_unavailable" })); }
  });
  let failed = false;
  for (const message of messages) {
    try {
      if (await processOperatorInstruction({ ...message, payload }, { sendApproval: sendDailyApproval, interpret: (body,job)=>interpretInstruction(body,job,fetch,request.headers.get("x-vercel-oidc-token")) })) continue;
      const result = await repo.applyIncomingWhatsApp({ ...message, payload });
      console.info(JSON.stringify({ event: "whatsapp_approval_message", messageId: message.id, handled: result.handled, reason: "reason" in result ? result.reason : undefined, intent: "intent" in result ? result.intent : undefined }));
      if (result.handled && "weeklyReportWeekStart" in result && typeof result.weeklyReportWeekStart === "string") {
        try { await deliverWeeklyReport(result.weeklyReportWeekStart); }
        catch { console.error(JSON.stringify({ event: "weekly_report_delivery_unknown", weekStart: result.weeklyReportWeekStart })); }
      }
      if (result.handled && "dailyNotificationJobId" in result && typeof result.dailyNotificationJobId === "string") {
        // The inbound reply opens the service window. Claim the full draft
        // message before sending; Meta webhook retries cannot duplicate it.
        try { await sendDailyApproval(result.dailyNotificationJobId); }
        catch { console.error(JSON.stringify({event:"daily_approval_send_unknown",jobId:result.dailyNotificationJobId})); }
      }
      if(result.handled && "dailyJobId" in result && typeof result.dailyJobId === "string" && result.intent === "approve"){
        // The incoming reply opens a 24-hour customer-service window. The
        // separate publication request is sent once and has its own decision.
        try { await requestFacebookApproval(result.dailyJobId); }
        catch { console.error(JSON.stringify({event:"daily_publication_preparation_unknown",jobId:result.dailyJobId})); }
      }
      if (result.handled && "publicationId" in result && typeof result.publicationId === "string" && result.intent === "changes_requested" && result.platform === "facebook") {
        const publicationRepo = publicationRepository();
        try {
          const revised = await publicationRepo.reviseRequested(result.publicationId);
          if (revised.daily) {
            try { await sendDailyApproval(revised.job.id); }
            catch { console.error(JSON.stringify({ event: "publication_revision_approval_send_unknown", jobId: revised.job.id })); }
          } else {
            try { await sendWhatsAppText("Änderung übernommen. Der überarbeitete Content-Plan ist wieder freigabepflichtig. Bitte im Content Studio prüfen und freigeben; eine alte Veröffentlichungsfreigabe kann nicht mehr posten."); }
            catch { console.error(JSON.stringify({ event: "publication_revision_notice_unknown", jobId: revised.job.id })); }
          }
          console.info(JSON.stringify({ event: "publication_revision", publicationId: result.publicationId, jobId: revised.job.id, status: "awaiting_approval" }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Änderung nicht eindeutig umsetzbar.";
          try { await sendWhatsAppText(`Änderungswunsch gespeichert, aber noch nicht automatisch umgesetzt: ${message}`); }
          catch { console.error(JSON.stringify({ event: "publication_revision_clarification_unknown", publicationId: result.publicationId })); }
          console.info(JSON.stringify({ event: "publication_revision", publicationId: result.publicationId, status: "needs_clarification" }));
        }
      }
      if (result.handled && "publicationId" in result && typeof result.publicationId === "string" && result.intent === "approve" && result.platform === "facebook") {
        const publicationRepo = publicationRepository();
        const claimed = await publicationRepo.claimPublish(result.publicationId);
        let phase = "publish";
        try {
          const posted = await publishFacebookPhoto(claimed.imageUrl!, claimed.caption);
          phase = "persist";
          await publicationRepo.published(claimed.id, posted.id, posted.permalink);
          console.info(JSON.stringify({ event: "facebook_publication", publicationId: claimed.id, status: "published" }));
        } catch (error) {
          await publicationRepo.markUnknown(claimed.id);
          console.error(JSON.stringify({ event: "facebook_publication", publicationId: claimed.id, status: "unknown",
            phase: error instanceof FacebookPublishFailure ? error.phase : phase,
            detail: error instanceof FacebookPublishFailure ? error.detail : "unclassified",
            ...(error instanceof FacebookPublishFailure ? {httpStatus:error.httpStatus,code:error.code,subcode:error.subcode} : {}) }));
        }
      }
    } catch {
      failed = true;
      console.error(JSON.stringify({ event: "whatsapp_approval_message_failed", messageId: message.id }));
    }
  }
  // Successful message IDs deduplicate when Meta redelivers the batch.
  if (failed) return new Response("Storage unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  return new Response("EVENT_RECEIVED", { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

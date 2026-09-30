import { processOperatorInstruction } from "@/lib/whatsapp/process-instruction";
import { recoverLatestInstruction } from "@/lib/whatsapp/recover-instruction";
import { handleContentApproval } from "@/lib/whatsapp/content-approval";
import { requestContentApproval } from "@/lib/whatsapp/content-approval";
import { after } from "next/server";
import { continuePendingReels, latestInstagramReelStatus, recoverRunwayPreflightIncident } from "@/lib/automation/continue";
import { productionRepository } from "@/lib/production/repository";
import { publicationRepository } from "@/lib/meta/publication-gate";
import { FacebookPublishFailure, publishFacebookPhoto } from "@/lib/meta/publisher";
import { requestFacebookApproval } from "@/lib/meta/request-publication";
import { requestVideoCostApproval } from "@/lib/production/request-cost-approval";
import { getDatabase } from "@/lib/memory/db";
import { parseJob } from "@/lib/content/history";
import { createDailyDraft, sendDailyApproval, sendPendingDailyApprovals } from "@/lib/daily/draft";
import { startImagePostFromWhatsApp } from "@/lib/whatsapp/start-image-post";
import { answerWhatsAppConversation } from "@/lib/whatsapp/chat";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { sendStoryHandoff } from "@/lib/meta/story-handoff";
import { deliverWeeklyReport } from "@/lib/reporting/weekly";
import { latestImagePostsStatus } from "@/lib/reporting/whatsapp-status";
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
  let keepPolling=messages.some(message=>/^(status|weiter)[.!?]*$/i.test(message.body.trim()));
  after(async () => {
    // Keep observing an already claimed provider task after replying to Meta.
    // Stop when human approval is due, or before the function's 300s limit.
    const deadline=Date.now()+210_000;
    try {
      while(true){
        const result=await continuePendingReels();
        console.info(JSON.stringify({event:'reel_continuation_summary',...result}));
        if(!keepPolling || !result.considered || (result.blocked && result.advanced===0) || Date.now()+15_000>=deadline)break;
        await new Promise(resolve=>setTimeout(resolve,15_000));
      }
    } catch { console.error(JSON.stringify({ event: "reel_continuation_unavailable" })); }
  });
  let failed = false;
  for (const message of messages) {
    try {
      if (/^(status|weiter)[.!?]*$/i.test(message.body.trim())
        && message.from.replace(/\D/g, "") === (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "")) {
        const claimed=await getDatabase().query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id",[message.id,message.from,message.replyToMessageId,message.body,JSON.stringify(payload)]);
        if(claimed.rows.length){
          const correctionStatus=await recoverLatestInstruction(getDatabase(),message.from.replace(/\D/g,""),sendDailyApproval);
          await recoverRunwayPreflightIncident();
          const status=await latestInstagramReelStatus();
          const imageStatus = await latestImagePostsStatus(getDatabase());
          await sendWhatsAppText(`Aktuelle Bildpost-Aufträge:\n${imageStatus}${correctionStatus?`\n\nLetzte Korrektur: ${correctionStatus}`:''}\n\nLetzter Instagram-Reel-Auftrag: ${status}`);
        }
        continue;
      }
      if (await startImagePostFromWhatsApp({ ...message, payload }, getDatabase, createDailyDraft, sendWhatsAppText)) continue;
      if (await answerWhatsAppConversation({ ...message, payload })) continue;
      if (await handleContentApproval({ ...message, payload }, async jobId => {
        try {
          const record=await getDatabase().query("SELECT snapshot FROM content_jobs WHERE id=$1",[jobId]);
          if(!record.rows[0])return;
          const job=parseJob(record.rows[0].snapshot);
          if(job.content?.format==="video")await requestVideoCostApproval(jobId);
          else if(job.content?.format==="image")await requestFacebookApproval(jobId);
        } catch(error) {
          console.warn(JSON.stringify({event:"content_approved_next_step_blocked",jobId,reason:error instanceof Error?error.message:"unknown"}));
          try{await sendWhatsAppText(`Der Inhalt ist freigegeben, aber der nächste Schritt ist noch blockiert: ${error instanceof Error?error.message:"Status unklar."} Es wurde nichts zusätzlich gekauft oder veröffentlicht. Antworte mit „Status“, nachdem der Zugang geprüft wurde.`);}catch{}
        }
      })) continue;
      if (await processOperatorInstruction({ ...message, payload }, { sendApproval: sendDailyApproval })) continue;
      const result = await repo.applyIncomingWhatsApp({ ...message, payload });
      if (result.handled && result.intent === "link_blocked") {
        await sendWhatsAppText("Die alte Inhaltsfreigabe ist gesperrt: Der Amazon-Produktlink ist nicht mehr sicher verifiziert. Es wurde kein Bild gekauft und nichts veröffentlicht. Sende „Artikelsuche“ für einen neuen geprüften Artikel.");
      }
      if(result.handled && result.intent==="approve" && ("productionRunId" in result || ("platform" in result && result.platform==="instagram")))keepPolling=true;
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
      if (result.handled && "productionRunId" in result && result.intent === "changes_requested" && "jobId" in result && typeof result.jobId === "string") {
        try {
          const revised = await repo.reviseRequestedVideo(result.jobId);
          try { await requestContentApproval(revised.id); }
          catch { try { await sendWhatsAppText(`Videoänderung für ${revised.opportunity.product.name} übernommen. Die neue Inhaltsfreigabe konnte nicht zugestellt werden; bitte im Content Studio prüfen. Die alte Kostenfreigabe ist ungültig. Keine Produktion.`); } catch {} }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Änderung nicht umsetzbar.";
          try { await sendWhatsAppText(`Änderungswunsch gespeichert; Video noch nicht geändert: ${message}. Im Content Studio prüfen. Keine Produktion oder Veröffentlichung.`); }
          catch { console.error(JSON.stringify({ event: "video_revision_clarification_unknown", jobId: result.jobId })); }
        }
      }
      if (result.handled && "publicationId" in result && typeof result.publicationId === "string" && result.intent === "changes_requested" && result.platform === "facebook") {
        const publicationRepo = publicationRepository();
        try {
          const revised = await publicationRepo.reviseRequested(result.publicationId);
          if (revised.daily) {
            try { await sendDailyApproval(revised.job.id); }
            catch { console.error(JSON.stringify({ event: "publication_revision_approval_send_unknown", jobId: revised.job.id })); }
          } else {
            try { await requestContentApproval(revised.job.id); }
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
          try { await sendStoryHandoff(claimed.id); }
          catch { console.warn(JSON.stringify({ event: "story_handoff_unavailable", publicationId: claimed.id })); }
        } catch (error) {
          await publicationRepo.markUnknown(claimed.id);
          console.error(JSON.stringify({ event: "facebook_publication", publicationId: claimed.id, status: "unknown",
            phase: error instanceof FacebookPublishFailure ? error.phase : phase,
            detail: error instanceof FacebookPublishFailure ? error.detail : "unclassified",
            ...(error instanceof FacebookPublishFailure ? {httpStatus:error.httpStatus,code:error.code,subcode:error.subcode} : {}) }));
        }
      }
    } catch (error) {
      failed = true;
      console.error(JSON.stringify({ event: "whatsapp_approval_message_failed", messageId: message.id, failureType: error instanceof Error ? error.name : "unknown" }));
    }
  }
  // An inbound operator message opens the 24 h service window. Deliver any
  // saved daily approval that could not be sent earlier; the send is claimed once.
  const approverId = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!failed && approverId && typeof sendPendingDailyApprovals === "function"
    && messages.some(message => message.from.replace(/\D/g, "") === approverId)) {
    try { await sendPendingDailyApprovals(getDatabase()); }
    catch { console.error(JSON.stringify({ event: "daily_approval_flush_unavailable" })); }
  }
  // Successful message IDs deduplicate when Meta redelivers the batch.
  if (failed) return new Response("Storage unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  return new Response("EVENT_RECEIVED", { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

import { productionRepository } from "@/lib/production/repository";
import { publicationRepository } from "@/lib/meta/publication-gate";
import { publishFacebookPhoto } from "@/lib/meta/publisher";
import { requestFacebookApproval } from "@/lib/meta/request-publication";
import { extractIncomingWhatsAppMessages, verifyMetaWebhookSignature, verifyWhatsAppChallenge } from "@/lib/whatsapp/security";

export const runtime = "nodejs";
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

  const messages = extractIncomingWhatsAppMessages(payload);
  if (!messages.length) return new Response("EVENT_RECEIVED", { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  let repo;
  try { repo = productionRepository(); }
  catch {
    console.error(JSON.stringify({ event: "whatsapp_database_unavailable" }));
    return new Response("Storage unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let failed = false;
  for (const message of messages) {
    try {
      const result = await repo.applyIncomingWhatsApp({ ...message, payload });
      console.info(JSON.stringify({ event: "whatsapp_approval_message", messageId: message.id, handled: result.handled, reason: "reason" in result ? result.reason : undefined, intent: "intent" in result ? result.intent : undefined }));
      if(result.handled && "dailyJobId" in result && typeof result.dailyJobId === "string" && result.intent === "approve"){
        // The incoming reply opens a 24-hour customer-service window. The
        // separate publication request is sent once and has its own decision.
        try { await requestFacebookApproval(result.dailyJobId); }
        catch { console.error(JSON.stringify({event:"daily_publication_preparation_unknown",jobId:result.dailyJobId})); }
      }
      if (result.handled && "publicationId" in result && typeof result.publicationId === "string" && result.intent === "approve") {
        const publicationRepo = publicationRepository();
        const claimed = await publicationRepo.claimPublish(result.publicationId);
        try {
          const posted = await publishFacebookPhoto(claimed.imageUrl!, claimed.caption);
          await publicationRepo.published(claimed.id, posted.id, posted.permalink);
          console.info(JSON.stringify({ event: "facebook_publication", publicationId: claimed.id, status: "published" }));
        } catch {
          await publicationRepo.markUnknown(claimed.id);
          console.error(JSON.stringify({ event: "facebook_publication", publicationId: claimed.id, status: "unknown" }));
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

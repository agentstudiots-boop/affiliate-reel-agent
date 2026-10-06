import type { Database } from "../memory/db";
import type { DecisionEvidence } from "./authority";
import { approvalState, ApprovalDecisionError, bindApprovalRequest, recordApprovalDecision, registerContentVersion, type PublishableContent } from "./approval-gate";

// Affiliate posts of the existing product pipeline: its own WhatsApp publication request (image + exact caption) is
// the approval request of exactly this content version. The operator's reply to that request is recorded through the
// unchanged gate path (recordApprovalDecision: active authority, trusted sender, reply to exactly this request, literal
// "Freigeben"). Nothing is approved here that the gate itself would not approve. Idempotent for redelivered webhooks
// and overlapping continuation ticks.
export async function adoptProductApproval(db: Database, input: { content: PublishableContent; requestMessageId: string; evidence: DecisionEvidence; trustedWaId: string }) {
  if (!input.requestMessageId || input.evidence.replyToMessageId !== input.requestMessageId) throw new ApprovalDecisionError("evidence_incomplete");
  const registered = await registerContentVersion(db, input.content);
  const state = await approvalState(db, input.content.contentId);
  if (state?.status !== "pending") return state;
  if (state.requestMessageId && state.requestMessageId !== input.requestMessageId) throw new ApprovalDecisionError("request_mismatch");
  if (!state.requestMessageId) {
    await bindApprovalRequest(db, input.content.contentId, registered.version, input.requestMessageId)
      .catch(error => { if (!(error instanceof ApprovalDecisionError && error.reason === "request_not_bindable")) throw error; });
  }
  await recordApprovalDecision(db, { authority: "whatsapp_operator", evidence: input.evidence, trustedWaId: input.trustedWaId })
    .catch(error => { if (!(error instanceof ApprovalDecisionError && error.reason.startsWith("not_pending"))) throw error; });
  return approvalState(db, input.content.contentId);
}

// Who may approve a publication. Today exactly one authority is active: the human operator via WhatsApp.
//
// The executive agent is an interface slot only. It is NOT wired anywhere and cannot approve: activation
// is a code change of ACTIVE_APPROVAL_AUTHORITIES (reviewed, tested), never an environment variable or a
// model output. The gate re-checks the active list both when a decision is recorded and when publishing.

export const APPROVAL_AUTHORITIES = ["whatsapp_operator", "executive_agent"] as const;
export type ApprovalAuthorityKind = (typeof APPROVAL_AUTHORITIES)[number];

export const ACTIVE_APPROVAL_AUTHORITIES: readonly ApprovalAuthorityKind[] = Object.freeze(["whatsapp_operator"] as ApprovalAuthorityKind[]);

export function isActiveAuthority(kind: unknown): kind is ApprovalAuthorityKind {
  return typeof kind === "string" && (ACTIVE_APPROVAL_AUTHORITIES as readonly string[]).includes(kind);
}

// Evidence the gate verifies for every decision. For WhatsApp: the inbound message id, the id of the approval
// request it replies to, the trusted sender and the literal text (only an explicit "Freigeben" approves).
export type DecisionEvidence = {
  channel: "whatsapp";
  messageId: string;
  replyToMessageId: string;
  senderWaId: string;
  body: string;
};

export type ApprovalRequest = { contentId: string; version: number; fingerprint: string; summary: string; platforms: string[] };

// Contract a future executive agent must implement. It may prepare a recommendation; whether that
// recommendation can ever count as an approval is decided solely by ACTIVE_APPROVAL_AUTHORITIES.
export interface ApprovalAuthority {
  readonly kind: ApprovalAuthorityKind;
  // Sends the request through the authority's channel and returns the request reference (e.g. WhatsApp message id).
  requestApproval(request: ApprovalRequest): Promise<{ requestMessageId: string }>;
}

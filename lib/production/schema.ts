import { z } from "zod";

export const productionProviderSchema = z.enum(["faceless_video", "runway"]);
export type ProductionProvider = z.infer<typeof productionProviderSchema>;

export const productionModeSchema = z.enum(["FACELESS_STORYBOARD", "RUNWAY_SINGLE_CLIP"]);
export type ProductionMode = z.infer<typeof productionModeSchema>;

export const productionStatusSchema = z.enum([
  "draft",
  "needs_provider_quote",
  "awaiting_whatsapp_approval",
  "changes_requested",
  "approved_for_spend",
  "rendering",
  "ready",
  "failed",
  "cancelled",
]);
export type ProductionStatus = z.infer<typeof productionStatusSchema>;

export const approvalKindSchema = z.enum(["render", "publish"]);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;

export const approvalStatusSchema = z.enum(["pending", "approved", "changes_requested", "rejected", "consumed"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const whatsappIntentSchema = z.enum(["approve", "reject", "changes_requested"]);
export type WhatsAppIntent = z.infer<typeof whatsappIntentSchema>;

export const productionRunSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  contentType: z.enum(["video", "image", "text"]),
  provider: productionProviderSchema,
  providerMode: productionModeSchema,
  status: productionStatusSchema,
  estimatedCostCents: z.number().int().nonnegative().nullable(),
  estimatedProviderCredits: z.number().nonnegative().nullable(),
  currency: z.literal("EUR"),
  providerJobId: z.string().nullable(),
  outputUrl: z.string().url().nullable(),
  revisionRequest: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductionRun = z.infer<typeof productionRunSchema>;

export const approvalRequestSchema = z.object({
  id: z.string().uuid(),
  productionRunId: z.string().uuid(),
  jobId: z.string().uuid(),
  kind: approvalKindSchema,
  status: approvalStatusSchema,
  estimatedCostCents: z.number().int().nonnegative().nullable(),
  estimatedCommissionCents: z.number().int().nonnegative().nullable(),
  currency: z.literal("EUR"),
  summary: z.string().min(1).max(3000),
  whatsappMessageId: z.string().nullable(),
  approverWaId: z.string().nullable(),
  feedback: z.string(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

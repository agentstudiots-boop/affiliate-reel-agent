import { z } from "zod";

export const factorsSchema=z.object({
  creativeType:z.string().min(2).max(120),visualComplexity:z.enum(["low","medium","high"]),specificScenesRequired:z.boolean(),
  motionImportance:z.enum(["low","medium","high"]),productVisualImportance:z.enum(["low","medium","high"]),storytellingComplexity:z.enum(["low","medium","high"]),
  availablePerformanceData:z.boolean().default(false),expectedOpportunityValueCents:z.number().int().nonnegative().nullable().default(null),
  estimatedProductionCostCents:z.number().int().nonnegative().nullable().default(null),knownAffiliateCommission:z.string().max(300).nullable().default(null),
  provenClicks:z.number().int().nonnegative().default(0),provenConversions:z.number().int().nonnegative().default(0),
});
export const createProductionSchema=z.object({
  contentJobId:z.string().uuid(),script:z.string().min(20).max(12000),voiceId:z.string().min(1).max(300).optional(),
  productName:z.string().min(2).max(160),affiliateProgram:z.string().min(2).max(160).default("Amazon PartnerNet"),
  creativeConcept:z.string().min(4).max(2000),hook:z.string().min(2).max(500),description:z.string().min(4).max(2000),
  factors:factorsSchema,
});
export type CreateProductionInput=z.infer<typeof createProductionSchema>;

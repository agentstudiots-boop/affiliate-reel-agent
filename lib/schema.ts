import { z } from "zod";

export const productSchema = z.object({
  name: z.string().min(2).max(160),
  sourceUrl: z.string().url(),
  affiliateUrl: z.union([z.literal(""), z.string().url()]),
  price: z.string().max(40),
  targetGroup: z.string().min(2).max(300),
  benefits: z.string().min(5).max(1200),
  notes: z.string().max(1200),
});

export const trendCandidateSchema = z.object({
  name: z.string(),
  category: z.string(),
  kind: z.enum(["Dauerläufer", "Saisontrend", "Aktueller Trend"]),
  season: z.string(),
  whyNow: z.string(),
  reelIdea: z.string(),
  targetGroup: z.string(),
  benefitsToVerify: z.array(z.string()).min(2).max(5),
  searchQuery: z.string(),
  confidence: z.number().min(0).max(100),
});

export const trendReportSchema = z.object({
  summary: z.string(),
  researchedAt: z.string(),
  candidates: z.array(trendCandidateSchema).min(3).max(6),
});

export const productReviewSchema = z.object({
  normalizedName: z.string(),
  evidenceSummary: z.string(),
  verifiedBenefits: z.array(z.string()).min(2).max(6),
  cautions: z.array(z.string()).min(1).max(6),
  targetGroup: z.string(),
  reelAngle: z.string(),
  confidence: z.number().min(0).max(100),
  approvalRecommendation: z.boolean(),
});

export const reelConceptSchema = z.object({
  hook: z.string(),
  scenes: z.array(
    z.object({
      seconds: z.string(),
      visual: z.string(),
      voiceover: z.string(),
      overlay: z.string(),
    }),
  ).min(3).max(7),
  caption: z.string(),
  hashtags: z.array(z.string()).min(3).max(12),
  cta: z.string(),
  disclosure: z.string(),
  checks: z.array(z.string()).min(2).max(8),
});

import { z } from "zod";

export const productSchema = z.object({
  name: z.string().min(2).max(160),
  sourceUrl: z.string().url(),
  affiliateUrl: z.string().url(),
  price: z.string().max(40),
  targetGroup: z.string().min(2).max(300),
  benefits: z.string().min(5).max(1200),
  notes: z.string().max(1200),
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


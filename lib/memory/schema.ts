import { z } from "zod";
export const performanceSchema = z.object({
  jobId: z.string().uuid(), platform: z.enum(["facebook", "instagram"]),
  status: z.enum(["draft", "published", "archived"]),
  url: z.union([z.literal(""), z.string().url().max(1500)]),
  publishedAt: z.union([z.literal(""), z.string().datetime()]),
  windowDays: z.union([z.literal(14),z.literal(30),z.literal(60)]),
  finalized: z.boolean(),
  clicks: z.number().int().min(0).max(100000000), conversions: z.number().int().min(0).max(100000000),
  revenueCents: z.number().int().min(0).max(100000000000),
  costCents: z.number().int().min(0).max(100000000000).nullable(),
  source: z.string().min(3).max(500), learning: z.string().max(2400),
  expectedRevision: z.number().int().min(0),
}).superRefine((value, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.status !== "draft" && (!value.url || !value.publishedAt)) add("Veröffentlichungslink und Zeitpunkt fehlen.");
  if (value.url && (new URL(value.url).protocol !== "https:" || new URL(value.url).username || new URL(value.url).password)) add("Öffentlichen HTTPS-Link verwenden.");
  if (value.publishedAt && Date.parse(value.publishedAt) > Date.now()) add("Veröffentlichungszeit liegt in der Zukunft.");
  if (value.finalized && (value.status === "draft" || !value.publishedAt || Date.parse(value.publishedAt) + value.windowDays * 86400000 > Date.now())) add("Das Messfenster ist noch nicht abgeschlossen.");
});
export type PerformanceInput = z.infer<typeof performanceSchema>;
export type HistoricalCase = { jobId: string; format: "video"|"image"|"text"; platform: string; clicks: number; conversions: number; revenueCents: number; costCents: number; windowDays: number };
export type LearningEvidence = {
  version: "rules-v1"; sampleIds: string[]; summary: string;
  groups: { format: "video"|"image"|"text"; count: number; clicks: number; conversions: number; conversionRate: number; costCents: number; revenueCents: number; profitCents: number; roi: number|null; adjustment: number }[];
};

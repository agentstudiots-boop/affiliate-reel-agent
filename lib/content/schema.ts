import { z } from "zod";
import { productSchema } from "../schema";
import { CHANCE_TYPES, contentChanceRecordSchema } from "./strategy";

const text = z.string().min(1).max(2400);
export const formatSchema = z.enum(["video", "image", "text"]);
export const opportunitySchema = z.object({
  product: productSchema,
  // Stable technical key; display names and the allowed set live in taxonomy.ts and content_categories.
  category: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).default("general"),
  useCaseKey: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/).default("general"),
  targetPlatform: z.enum(["any", "facebook", "instagram"]).default("any"),
  useCase: z.string().min(12).max(1600),
  trend: z.string().max(600).default(""),
  goal: z.enum(["conversion", "education", "community"]).default("conversion"),
  budget: z.enum(["low", "balanced", "quality"]).default("balanced"),
  verifiedFacts: z.array(z.object({ claim: text, source: z.string().url() })).max(12).default([]),
  // Set by the scheduled scout; absent for operator-requested products, which skip the strategic gate.
  contentChance: contentChanceRecordSchema.optional(),
});
export type Opportunity = z.infer<typeof opportunitySchema>;
export const ideaSchema = z.object({
  id: z.string().min(1).max(50), title: text, hook: text, situation: text,
  story: text, useCase: text, benefit: text,
  format: formatSchema,
  rationale: text,
  scores: z.object({ audience: z.number().min(0).max(5), credibility: z.number().min(0).max(5),
    demonstration: z.number().min(0).max(5), conversion: z.number().min(0).max(5),
    economy: z.number().min(0).max(5) }),
  crossSell: z.array(z.object({ product: text, reason: text, required: z.boolean() })).max(4),
  assumptions: z.array(text).max(8),
});
export type Idea = z.infer<typeof ideaSchema>;
export const creativeSchema = z.object({ ideas: z.array(ideaSchema).min(3).max(4) }).superRefine(({ ideas }, ctx) => {
  if (new Set(ideas.map(i => i.id)).size !== ideas.length) ctx.addIssue({ code: "custom", message: "Ideen-IDs müssen eindeutig sein." });
  if (new Set(ideas.map(i => i.format)).size !== 3) ctx.addIssue({ code: "custom", message: "Video, Bild und Text müssen verglichen werden." });
});
const base = { title: text, hook: text, useCase: text, productIntegration: text, cta: text,
  disclosure: z.literal("Werbung | Affiliate-Link"), checks: z.array(text).min(1).max(10) };
export const videoSchema = z.object({ ...base, format: z.literal("video"), durationSeconds: z.number().int().min(10).max(40),
  scenes: z.array(z.object({ durationSeconds: z.number().int().min(2).max(10), visual: text, audio: text, overlay: text })).min(3).max(8), caption: text,
});
export const visualConceptSchema = z.object({
  kind: z.enum(["lifestyle", "application", "editorial_collage", "comparison", "carousel_guide"]),
  mainIdea: text,
  productRelation: text,
  everydaySituation: text,
  sourceKind: z.enum(["product", "search", "category", "unknown"]),
  representation: z.enum(["generic_category", "verified_product_context"]),
  originality: z.literal("original_editorial"),
  visualWeight: z.enum(["image_led", "balanced", "text_led"]),
});
export const imageSchema = z.object({ ...base, format: z.literal("image"), layout: z.enum(["single", "carousel"]),
  visualConcept: visualConceptSchema.optional(),
  slides: z.array(z.object({ headline: text, copy: text, visual: text, prompt: text, alt: text })).min(1).max(7), caption: text,
});
export const textSchema = z.object({ ...base, format: z.literal("text"), style: z.enum(["recommendation", "expert", "community"]), body: z.string().min(120).max(5000) });
export const contentSchema = z.discriminatedUnion("format", [videoSchema, imageSchema, textSchema]);
export type Content = z.infer<typeof contentSchema>;
export const reviewSchema = z.object({ passed: z.boolean(), score: z.number().min(0).max(100), issues: z.array(text).max(12) });
export type Review = z.infer<typeof reviewSchema>;
export const marketingSchema = z.object({
  primary: z.enum(["Instagram Reel", "Facebook Video", "Instagram Carousel", "Instagram Bild", "Facebook Post", "Gruppenbeitrag"]),
  rationale: text, audience: text, adaptation: text, linkPlacement: text,
  conversionHypothesis: text, metrics: z.array(text).min(2).max(5),
  publishingChecks: z.array(text).min(2).max(8),
});
export type Marketing = z.infer<typeof marketingSchema>;
export type AgentName = "trend" | "creative" | "video" | "image" | "text" | "marketing" | "orchestrator";
export type JobStatus = "queued" | "checking" | "ideating" | "selecting" | "producing" | "reviewing" | "revising" | "marketing" | "awaiting_approval" | "needs_input" | "failed" | "interrupted" | "approved";
export type JobEvent = { sequence: number; at: string; agent: AgentName; kind: "status" | "response" | "decision" | "error"; message: string; data?: unknown };
export type Decision = { ideaId: string; format: Content["format"]; reason: string; ranking: { ideaId: string; score: number; rationale: string }[] };
export type ContentJob = {
  version: 1; id: string; createdAt: string; updatedAt: string; status: JobStatus;
  mode: "reference" | "ai"; opportunity: Opportunity; events: JobEvent[];
  ideas?: Idea[]; decision?: Decision; content?: Content; review?: Review; marketing?: Marketing;
  revisions: number; modelCalls: number; totalTokens: number; error?: string;
};
export const terminalStatuses: JobStatus[] = ["awaiting_approval", "needs_input", "failed", "interrupted", "approved"];

// ---- Trend/strategy agent contract (Jarvis ⇄ agent). `topic_opportunity` is accepted for later topic posts; not produced yet. ----
export const OPPORTUNITY_KINDS = ["product_opportunity", "topic_opportunity"] as const;
const level = z.enum(["low", "medium", "high"]);

export const evidenceItemSchema = z.object({ title: z.string().max(200), url: z.string().url(), snippet: z.string().max(400), direction: z.string().max(40) });
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const trendOpportunitySchema = z.object({
  kind: z.enum(OPPORTUNITY_KINDS),
  title: z.string().min(3).max(120),
  productIdea: z.string().max(90).nullable(),        // generic product type / search phrase; null for topics
  chanceType: z.enum(CHANCE_TYPES),
  contentChance: z.string().min(10).max(300),        // what the chance is
  hook: z.string().min(10).max(240),
  rationale: z.string().min(10).max(500),
  targetNeed: z.string().min(3).max(240),
  formatSuggestion: z.enum(["image", "video", "text"]),
  visualPotential: level,
  entertainmentPotential: level,
  signals: z.object({ demonstrable: z.boolean(), beforeAfter: z.boolean(), wow: z.boolean(), fun: z.boolean(),
    impulse: z.boolean(), gift: z.boolean(), aesthetic: z.boolean(), broadAppeal: z.boolean() }).strict(),
  shareReason: z.string().max(240),
  trustRationale: z.string().min(5).max(300),
  reachRationale: z.string().min(5).max(300),
  timing: z.object({ season: z.string().max(40).nullable(), relevance: z.enum(["none", "low", "high"]) }).strict(),
  novelty: level,
  similarityNote: z.string().max(240),
  concept: z.string().min(2).max(60),
  group: z.string().max(40).nullable(),
  confidence: z.number().min(0).max(100),
  evidenceUrls: z.array(z.string()).max(6),
  priority: z.number().int().min(1).max(8),
}).strict();
export type TrendOpportunity = z.infer<typeof trendOpportunitySchema>;

export const trendReportSchema = z.object({
  summary: z.string().max(500),
  opportunities: z.array(trendOpportunitySchema).max(8),
  noGoodCandidate: z.boolean(),
  rejectedIdeas: z.array(z.object({ idea: z.string().max(120), reason: z.string().max(240) }).strict()).max(8),
}).strict();
export type TrendReport = z.infer<typeof trendReportSchema>;

export type TrendBrief = {
  today: string; season: string; slot: string;
  evidence: EvidenceItem[];
  history: { rejected: { name: string | null; concept: string | null }[]; recent: { name: string | null; concept: string | null }[] };
  seedIdeas: { name: string; hook: string | null }[];
  maxOpportunities: number;
};


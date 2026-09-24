import { z } from "zod";
import { contentSchema, ideaSchema, marketingSchema, opportunitySchema, reviewSchema, type ContentJob } from "./schema";

export const HISTORY_KEY = "affiliate-content-jobs-v1";
const statuses = ["queued", "checking", "ideating", "selecting", "producing", "reviewing", "revising", "marketing", "awaiting_approval", "needs_input", "failed", "interrupted", "approved"] as const;
const storedJobSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), contentId: z.string().regex(/^cnt_[a-zA-Z0-9_]+$/).optional(), createdAt: z.string(), updatedAt: z.string(), status: z.enum(statuses),
  mode: z.enum(["reference", "ai"]), opportunity: opportunitySchema,
  events: z.array(z.object({ sequence: z.number(), at: z.string(), agent: z.enum(["creative", "video", "image", "text", "marketing", "orchestrator"]), kind: z.enum(["status", "response", "decision", "error"]), message: z.string(), data: z.unknown().optional() })).max(100),
  ideas: z.array(ideaSchema).max(4).optional(),
  decision: z.object({ ideaId: z.string(), format: z.enum(["video", "image", "text"]), reason: z.string(), ranking: z.array(z.object({ ideaId: z.string(), score: z.number(), rationale: z.string() })).max(4) }).optional(),
  content: contentSchema.optional(), review: reviewSchema.optional(), marketing: marketingSchema.optional(),
  revisions: z.number().int().min(0).max(2), modelCalls: z.number().int().min(0).max(8), totalTokens: z.number().min(0), error: z.string().optional(),
});
export function parseJob(value: unknown): ContentJob { return storedJobSchema.parse(value); }
export function restoreHistory(raw: string | null): ContentJob[] {
  if (!raw) return [];
  const jobs = z.array(storedJobSchema).max(10).parse(JSON.parse(raw));
  return jobs.map(job => {
    if (["awaiting_approval", "needs_input", "failed", "interrupted", "approved"].includes(job.status)) return job;
    const at = new Date().toISOString();
    return { ...job, status: "interrupted" as const, updatedAt: at, error: "Browser wurde während der Planung geschlossen. Kein automatischer Neustart.",
      events: [...job.events, { sequence: job.events.length + 1, at, agent: "orchestrator" as const, kind: "error" as const, message: "Verbindung zur Planung unterbrochen; Ergebnis möglicherweise unvollständig." }] };
  });
}

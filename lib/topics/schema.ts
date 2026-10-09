import { z } from "zod";
import { CONTENT_FORMATS } from "../formats/catalog";

export const TREND_TYPES = ["BREAKING_NEWS", "SOCIAL_HYPE", "ENTERTAINMENT", "SEASONAL", "EVERGREEN", "SEARCH_TREND", "EVENT", "CURIOSITY", "PRACTICAL_LIFE", "PRODUCT_ADJACENT"] as const;
export type TrendType = (typeof TREND_TYPES)[number];

export const SOURCE_IDS = ["tavily_news", "google_news_rss", "google_trends_rss", "wikipedia_pageviews", "calendar", "evergreen"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
// news: reports an event; search/attention: only says that people look for something (no facts);
// calendar/evergreen: computed locally, no external claim.
export type SignalKind = "news" | "search" | "attention" | "calendar" | "evergreen";

export const rawSignalSchema = z.object({
  source: z.enum(SOURCE_IDS),
  kind: z.enum(["news", "search", "attention", "calendar", "evergreen"]),
  title: z.string().min(3).max(300),
  snippet: z.string().max(600).default(""),
  url: z.string().url().nullable(),
  publisher: z.string().max(120).nullable(),
  publisherUrl: z.string().url().nullable().default(null),
  publishedAt: z.string().datetime().nullable(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  fetchedAt: z.string().datetime(),
  // Source-provided strength, normalized 0..1 (rank, approximate traffic, page views). Never invented: 0 when unknown.
  strength: z.number().min(0).max(1),
  tags: z.array(z.string().max(40)).max(12).default([]),
});
export type RawSignal = z.infer<typeof rawSignalSchema>;

export const SOURCE_ERROR_KINDS = ["timeout", "rate_limited", "auth", "unavailable", "invalid_response", "not_configured", "unknown"] as const;
export type SourceErrorKind = (typeof SOURCE_ERROR_KINDS)[number];

export type SourceHealth = {
  source: SourceId;
  status: "ok" | "empty" | "failed" | "skipped";
  errorKind?: SourceErrorKind;
  httpStatus?: number;
  attempts: number;
  durationMs: number;
  signals: number;
};

const scoreSchema = z.object({ score: z.number().int().min(0).max(100), factors: z.array(z.string().max(160)).max(10) });
export type Score = z.infer<typeof scoreSchema>;
export const SCORE_KEYS = ["freshness", "trend_strength", "brand_fit", "virality", "utility", "emotionality", "visual", "video_fit", "interaction", "monetization", "risk", "source_quality"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export const FACT_STATUS = ["multi_source", "single_reputable_source", "unverified", "not_applicable"] as const;
export type FactStatus = (typeof FACT_STATUS)[number];

export const sourceSignalSchema = z.object({
  source: z.enum(SOURCE_IDS), kind: z.enum(["news", "search", "attention", "calendar", "evergreen"]),
  title: z.string().max(300), url: z.string().url().nullable(), publisher: z.string().max(120).nullable(),
  published_at: z.string().nullable(), event_date: z.string().nullable(), fetched_at: z.string(), strength: z.number().min(0).max(1),
});

// The scout's output contract to Jarvis. All scores are derived from listed factors (see scoring.ts).
export const topicCandidateSchema = z.object({
  topic_id: z.string().regex(/^tp_[a-f0-9]{16}$/),
  concept_key: z.string().min(2).max(80),
  title: z.string().min(3).max(200),
  trend_type: z.enum(TREND_TYPES),
  source_signals: z.array(sourceSignalSchema).min(1).max(12),
  source_urls: z.array(z.string().url()).max(12),
  detected_at: z.string().datetime(),
  relevance_score: z.number().int().min(0).max(100),
  virality_score: z.number().int().min(0).max(100),
  brand_fit_score: z.number().int().min(0).max(100),
  risk_score: z.number().int().min(0).max(100),
  scores: z.record(z.enum(SCORE_KEYS), scoreSchema),
  fact_status: z.enum(FACT_STATUS),
  sensitive: z.boolean(),
  gossip: z.boolean(),
  audience_problem: z.string().max(300),
  why_now: z.string().max(400),
  hook: z.string().min(10).max(200),
  angle: z.string().max(300),
  core_message: z.string().max(400),
  suggested_format: z.enum(CONTENT_FORMATS),
  suitable_for_video: z.boolean(),
  suitable_for_avatar: z.boolean(),
  visual_potential: z.number().int().min(0).max(100),
  product_optional: z.boolean(),
  possible_product_category: z.string().max(40).nullable(),
  confidence: z.number().int().min(0).max(100),
  text_origin: z.enum(["rule_template", "model_enriched"]),
});
export type TopicCandidate = z.infer<typeof topicCandidateSchema>;

export type ScoutOutcome = "success" | "degraded" | "offline_fallback" | "no_candidates";
export type ScoutResult = {
  runId: string;
  startedAt: string;
  durationMs: number;
  outcome: ScoutOutcome;
  candidates: TopicCandidate[];
  dropped: { title: string; reason: string }[];
  sourceHealth: SourceHealth[];
  // Clusters behind each candidate (by topic_id), so Jarvis can request a text variant without a new search.
  clusters: Record<string, { title: string; signals: RawSignal[] }>;
};

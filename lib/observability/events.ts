// Structured pipeline events for the topic / multi-format pipeline. One JSON line per event.
// Never log secrets, tokens, full prompts or personal data: values under sensitive keys are dropped,
// strings are shortened and URLs lose their query string (affiliate tags, signatures, tokens).

export const PIPELINE_EVENTS = [
  "topic_scout_started", "topic_scout_completed", "topic_source_failed", "topic_source_completed",
  "topic_candidate_created", "topic_candidate_rejected", "topic_candidate_selected", "jarvis_topic_gate_completed",
  "format_router_started", "format_router_selected",
  "carousel_plan_created", "carousel_slide_started", "carousel_slide_failed", "carousel_slide_completed", "carousel_completed",
  "image_generation_started", "image_generation_failed", "image_generation_completed",
  "heygen_job_started", "heygen_job_failed", "heygen_job_completed", "avatar_quota_blocked",
  "video_job_started", "video_job_failed", "production_fallback", "production_completed",
  "master_content_created", "platform_render_started", "platform_render_completed", "platform_render_failed",
  "platform_publish_started", "platform_publish_completed", "platform_publish_failed", "platform_publish_skipped",
  "topic_pipeline_failed", "topic_approval_requested", "topic_instruction_applied",
  "topic_cron_started", "topic_cron_completed", "topic_cron_skipped",
  "image_prompt_rejected", "image_quality_passed", "image_quality_failed", "image_quality_skipped",
] as const;
export type PipelineEvent = (typeof PIPELINE_EVENTS)[number];

type Sink = (line: string, level: "info" | "warn" | "error") => void;
const defaultSink: Sink = (line, level) => (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(line);
let sink: Sink = defaultSink;
const memory: { event: PipelineEvent; at: string; fields: Record<string, unknown> }[] = [];

const SENSITIVE_KEY = /token|secret|password|authorization|api[_-]?key|cookie|signature|credential|phone|wa_id|email/i;

function clean(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    let text = value;
    if (/^https?:\/\//i.test(text)) { try { const url = new URL(text); url.search = ""; url.hash = ""; url.username = ""; url.password = ""; text = url.toString(); } catch { /* keep */ } }
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 3) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map(item => clean(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = clean(inner, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function emitEvent(event: PipelineEvent, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const safe = clean(fields) as Record<string, unknown>;
  const at = new Date().toISOString();
  memory.push({ event, at, fields: safe });
  if (memory.length > 200) memory.shift();
  try { sink(JSON.stringify({ event, at, ...safe }), level); } catch { /* logging must never break the pipeline */ }
}

// Tests and the status report can observe recent events of this process instance (not durable).
export function recentEvents(filter?: PipelineEvent) { return memory.filter(item => !filter || item.event === filter).slice(); }
export function setEventSink(next: Sink | null) { sink = next ?? defaultSink; }
export function clearRecentEvents() { memory.length = 0; }

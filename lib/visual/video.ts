import type { Sql } from "../memory/db";
import { emitEvent } from "../observability/events";
import { briefHash, jobKey, type JobKind, type JobLedger } from "./ledger";
import type { GeneratedAsset } from "./types";

// Video production behind provider interfaces. AVATAR_VIDEO (e.g. HeyGen) and STANDARD_VIDEO (e.g. Runway) are
// separate kinds: neither assumes the other. Provider-specific code stays in lib/visual/providers/.

export type VideoKind = Extract<JobKind, "avatar_video" | "standard_video">;
export type VideoInput = { contentId: string; role: string; title: string; script: string; visualPrompt: string; aspect: "9:16" };
export type VideoStatus = { state: "processing" | "completed" | "failed"; videoUrl?: string | null; error?: string | null };

export type VideoErrorCategory = "timeout" | "rate_limited" | "auth" | "quota_exhausted" | "provider_down" | "job_failed" | "job_stuck" | "invalid_response" | "invalid_request" | "unavailable";
export class VideoProviderError extends Error {
  constructor(public readonly category: VideoErrorCategory, public readonly retryable: boolean, public readonly jobId: string | null = null, public readonly httpStatus?: number) {
    super(`video_${category}`);
    this.name = "VideoProviderError";
  }
}

export interface VideoProvider {
  readonly name: string;
  readonly kind: VideoKind;
  available(): { ok: boolean; reason?: string };
  create(input: VideoInput): Promise<{ jobId: string }>;
  status(jobId: string): Promise<VideoStatus>;
  // Copies the finished file to our storage: provider URLs are signed and expire.
  archive(jobId: string, url: string, contentId: string): Promise<GeneratedAsset>;
}

// ---- Quota / budget (local counter; HeyGen's quota is not reliably queryable) ----
export type QuotaUsage = { planned: number; succeeded: number; failed: number };
export interface QuotaStore {
  usage(provider: string, month: string): Promise<QuotaUsage>;
  // Idempotent per key: the same job never counts twice.
  reserve(provider: string, kind: string, key: string, month: string): Promise<void>;
  settle(provider: string, key: string, status: "succeeded" | "failed"): Promise<void>;
}
export const monthOf = (date: Date) => date.toISOString().slice(0, 7);

export function memoryQuota(): QuotaStore & { rows: Map<string, { provider: string; status: string; month: string }> } {
  const rows = new Map<string, { provider: string; status: string; month: string }>();
  return {
    rows,
    async usage(provider, month) {
      const list = [...rows.values()].filter(row => row.provider === provider && row.month === month);
      return { planned: list.filter(row => row.status === "planned").length, succeeded: list.filter(row => row.status === "succeeded").length, failed: list.filter(row => row.status === "failed").length };
    },
    async reserve(provider, _kind, key, month) { if (!rows.has(`${provider}|${key}`)) rows.set(`${provider}|${key}`, { provider, status: "planned", month }); },
    async settle(provider, key, status) { const row = rows.get(`${provider}|${key}`); if (row) row.status = status; },
  };
}

export function postgresQuota(db: Sql): QuotaStore {
  return {
    async usage(provider, month) {
      const result = await db.query("SELECT status, count(*)::int AS n FROM provider_usage WHERE provider=$1 AND month=$2 GROUP BY status", [provider, month]);
      const by = Object.fromEntries(result.rows.map(row => [String(row.status), Number(row.n)]));
      return { planned: by.planned ?? 0, succeeded: by.succeeded ?? 0, failed: by.failed ?? 0 };
    },
    async reserve(provider, kind, key, month) {
      await db.query("INSERT INTO provider_usage(provider,kind,idempotency_key,status,month) VALUES($1,$2,$3,'planned',$4) ON CONFLICT (provider,idempotency_key) DO NOTHING", [provider, kind, key, month]);
    },
    async settle(provider, key, status) {
      await db.query("UPDATE provider_usage SET status=$3,updated_at=now() WHERE provider=$1 AND idempotency_key=$2 AND status='planned'", [provider, key, status]);
    },
  };
}

export function remainingQuota(limit: number, usage: QuotaUsage) { return Math.max(0, limit - usage.planned - usage.succeeded); }

// ---- Video job runner ----
export type VideoJobOptions = {
  ledger: JobLedger; provider: VideoProvider; quota?: { store: QuotaStore; limit: number } | null;
  now?: () => Date; sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number; maxWaitMs?: number;  // how long this invocation waits before handing over to a later resume
  stuckAfterMs?: number;                        // a job processing longer than this is treated as stuck
  maxAttempts?: number;
};
export type VideoJobResult =
  | { state: "completed"; asset: GeneratedAsset; reused: boolean; jobId: string | null }
  | { state: "in_progress"; jobId: string }
  | { state: "failed"; category: VideoErrorCategory | string; retryable: boolean; jobId: string | null };

export async function runVideoJob(input: VideoInput, options: VideoJobOptions): Promise<VideoJobResult> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const provider = options.provider;
  const hash = briefHash({ script: input.script, visualPrompt: input.visualPrompt, aspect: input.aspect, provider: provider.name });
  const key = jobKey(input.contentId, input.role, hash);
  const event = provider.kind === "avatar_video" ? { started: "heygen_job_started", failed: "heygen_job_failed", completed: "heygen_job_completed" } as const
    : { started: "video_job_started", failed: "video_job_failed", completed: "production_completed" } as const;
  const fail = async (category: string, retryable: boolean, jobId: string | null): Promise<VideoJobResult> => {
    await options.ledger.fail(key, category, retryable, jobId);
    // Usage counts unless nothing was created or the provider itself reports the job as failed.
    // A stuck job stays counted (conservative: it may have consumed credits).
    if (options.quota && (!jobId || category === "job_failed")) await options.quota.store.settle(provider.name, key, "failed");
    emitEvent(event.failed, { contentId: input.contentId, provider: provider.name, category, retryable, jobId }, "warn");
    return { state: "failed", category, retryable, jobId };
  };

  const claim = await options.ledger.claim({ key, contentId: input.contentId, role: input.role, kind: provider.kind, provider: provider.name, briefHash: hash, maxAttempts: options.maxAttempts ?? 2 });
  if (claim.action === "reuse" && claim.job.asset) return { state: "completed", asset: claim.job.asset, reused: true, jobId: claim.job.providerJobId };
  if (claim.action === "blocked") {
    if (claim.reason === "in_progress" && claim.job.providerJobId) return { state: "in_progress", jobId: claim.job.providerJobId };
    return { state: "failed", category: claim.reason, retryable: false, jobId: claim.job.providerJobId };
  }
  let jobId = claim.action === "resume" ? claim.job.providerJobId : null;
  const startedAt = claim.job.createdAt ?? Date.now();

  if (!jobId) {
    // No provider call without an available provider and remaining quota.
    if (options.quota) {
      const usage = await options.quota.store.usage(provider.name, monthOf(now()));
      if (remainingQuota(options.quota.limit, usage) <= 0) {
        emitEvent("avatar_quota_blocked", { contentId: input.contentId, provider: provider.name, limit: options.quota.limit, ...usage }, "warn");
        await options.ledger.fail(key, "quota_exhausted", false, null);
        return { state: "failed", category: "quota_exhausted", retryable: false, jobId: null };
      }
      await options.quota.store.reserve(provider.name, provider.kind, key, monthOf(now()));
    }
    emitEvent(event.started, { contentId: input.contentId, provider: provider.name, role: input.role });
    try {
      jobId = (await provider.create(input)).jobId;
      await options.ledger.setProviderJob(key, jobId);
    } catch (error) {
      const failure = error instanceof VideoProviderError ? error : new VideoProviderError("invalid_response", false);
      return fail(failure.category, failure.retryable, null);
    }
  }

  // Poll within this invocation; afterwards the job stays "running" with its id and is resumed later (never re-created).
  const deadline = Date.now() + (options.maxWaitMs ?? 240_000);
  for (;;) {
    let status: VideoStatus;
    try { status = await provider.status(jobId!); }
    catch (error) {
      const failure = error instanceof VideoProviderError ? error : new VideoProviderError("provider_down", true, jobId);
      if (!failure.retryable) return fail(failure.category, false, jobId);
      status = { state: "processing" }; // transient: keep observing the same job
    }
    if (status.state === "failed") return fail("job_failed", false, jobId);
    if (status.state === "completed") {
      if (!status.videoUrl) return fail("invalid_response", true, jobId);
      try {
        const asset = await provider.archive(jobId!, status.videoUrl, input.contentId);
        await options.ledger.succeed(key, asset);
        if (options.quota) await options.quota.store.settle(provider.name, key, "succeeded");
        emitEvent(event.completed, { contentId: input.contentId, provider: provider.name, jobId });
        return { state: "completed", asset, reused: false, jobId };
      } catch { return fail("invalid_response", true, jobId); }
    }
    if (Date.now() - startedAt > (options.stuckAfterMs ?? 30 * 60_000)) return fail("job_stuck", false, jobId);
    if (Date.now() >= deadline) return { state: "in_progress", jobId: jobId! };
    await sleep(options.pollIntervalMs ?? 10_000);
  }
}

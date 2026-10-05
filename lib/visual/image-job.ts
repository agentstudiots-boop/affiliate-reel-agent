import { emitEvent } from "../observability/events";
import { briefHash, jobKey, type JobLedger } from "./ledger";
import { ImageGenerationError, type GeneratedAsset, type ImageBrief, type ImageProvider } from "./types";

// One image generation with idempotency and bounded retries:
// - completed jobs are reused (no provider call), started provider jobs are resumed (polled), never re-created
// - retry only for retryable errors (rate limit / provider error before acceptance, or a known job id to resume)
// - exponential backoff; a definite failure ends the job and the caller degrades (never blocks the pipeline)

export type ImageJobOptions = { contentId: string; role: string; ledger: JobLedger; provider: ImageProvider; maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>; baseDelayMs?: number };
export type ImageJobResult = { ok: true; asset: GeneratedAsset; reused: boolean; attempts: number; key: string }
  | { ok: false; error: string; retryable: boolean; attempts: number; key: string };

export async function runImageJob(brief: ImageBrief, options: ImageJobOptions): Promise<ImageJobResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const hash = briefHash({ brief, model: options.provider.model });
  const key = jobKey(options.contentId, options.role, hash);
  let attempts = 0;
  for (;;) {
    const claim = await options.ledger.claim({ key, contentId: options.contentId, role: options.role, kind: "image", provider: options.provider.name, briefHash: hash, maxAttempts });
    if (claim.action === "reuse" && claim.job.asset) return { ok: true, asset: claim.job.asset, reused: true, attempts: claim.job.attempts, key };
    if (claim.action === "blocked") {
      emitEvent("image_generation_failed", { contentId: options.contentId, role: options.role, reason: claim.reason, attempts: claim.job.attempts }, "warn");
      return { ok: false, error: claim.reason, retryable: claim.reason === "in_progress", attempts: claim.job.attempts, key };
    }
    attempts = claim.job.attempts;
    emitEvent("image_generation_started", { contentId: options.contentId, role: options.role, provider: options.provider.name, attempt: attempts, resume: claim.action === "resume" });
    try {
      const asset = await options.provider.generate(brief, { contentId: options.contentId, role: options.role, resumeJobId: claim.action === "resume" ? claim.job.providerJobId : null,
        onJobCreated: jobId => options.ledger.setProviderJob(key, jobId) });
      await options.ledger.succeed(key, asset);
      emitEvent("image_generation_completed", { contentId: options.contentId, role: options.role, provider: options.provider.name, attempts });
      return { ok: true, asset, reused: false, attempts, key };
    } catch (error) {
      const failure = error instanceof ImageGenerationError ? error : new ImageGenerationError("unknown", false);
      await options.ledger.fail(key, failure.category, failure.retryable, failure.providerJobId);
      emitEvent("image_generation_failed", { contentId: options.contentId, role: options.role, provider: options.provider.name, category: failure.category,
        retryable: failure.retryable, httpStatus: failure.httpStatus, attempt: attempts }, "warn");
      if (!failure.retryable || attempts >= maxAttempts) return { ok: false, error: failure.category, retryable: failure.retryable, attempts, key };
      await sleep(Math.min(20_000, (options.baseDelayMs ?? 2_000) * 2 ** (attempts - 1)));
    }
  }
}

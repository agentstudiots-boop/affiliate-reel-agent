import { createHash } from "node:crypto";
import type { Sql } from "../memory/db";
import type { GeneratedAsset } from "./types";

// Job ledger: idempotency for every generation job. Keyed by content id + role + brief fingerprint.
//   succeeded → the stored asset is reused, no provider call
//   running with provider job id → resume (poll) that job, never create a second one
//   running without job id after the stale window → the outcome of the paid POST is unknown: no automatic retry
//   failed + retryable → may be retried (bounded by maxAttempts)

export type JobKind = "image" | "avatar_video" | "standard_video";
export type LedgerJob = { key: string; contentId: string; role: string; kind: JobKind; provider: string; status: "running" | "succeeded" | "failed";
  attempts: number; providerJobId: string | null; asset: GeneratedAsset | null; errorCategory: string | null; retryable: boolean; briefHash: string; updatedAt: number };

export type ClaimResult =
  | { action: "start"; job: LedgerJob }
  | { action: "resume"; job: LedgerJob }
  | { action: "reuse"; job: LedgerJob }
  | { action: "blocked"; job: LedgerJob; reason: "in_progress" | "unknown_outcome" | "permanent_failure" | "max_attempts" };

export interface JobLedger {
  claim(input: { key: string; contentId: string; role: string; kind: JobKind; provider: string; briefHash: string; maxAttempts: number }): Promise<ClaimResult>;
  setProviderJob(key: string, providerJobId: string): Promise<void>;
  succeed(key: string, asset: GeneratedAsset): Promise<void>;
  fail(key: string, category: string, retryable: boolean, providerJobId?: string | null): Promise<void>;
  get(key: string): Promise<LedgerJob | null>;
}

export const STALE_RUNNING_MS = 10 * 60_000;
export const briefHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const jobKey = (contentId: string, role: string, hash: string) => createHash("sha256").update(`${contentId}|${role}|${hash}`).digest("hex").slice(0, 40);

function decide(job: LedgerJob, maxAttempts: number, now: number): ClaimResult | null {
  if (job.status === "succeeded" && job.asset) return { action: "reuse", job };
  if (job.status === "running") {
    if (job.providerJobId) return { action: "resume", job };
    return { action: "blocked", job, reason: now - job.updatedAt > STALE_RUNNING_MS ? "unknown_outcome" : "in_progress" };
  }
  if (!job.retryable) return { action: "blocked", job, reason: "permanent_failure" };
  // A created provider job that only timed out while polling is resumed, never re-created.
  if (job.providerJobId) return job.attempts >= maxAttempts ? { action: "blocked", job, reason: "max_attempts" } : { action: "resume", job };
  if (job.attempts >= maxAttempts) return { action: "blocked", job, reason: "max_attempts" };
  return null; // retry allowed
}

export function memoryLedger(clock: () => number = Date.now): JobLedger & { jobs: Map<string, LedgerJob> } {
  const jobs = new Map<string, LedgerJob>();
  return {
    jobs,
    async claim(input) {
      const existing = jobs.get(input.key);
      if (existing) {
        const verdict = decide(existing, input.maxAttempts, clock());
        if (verdict) {
          if (verdict.action === "resume") { if (existing.status === "failed") existing.attempts += 1; existing.status = "running"; existing.updatedAt = clock(); }
          return verdict;
        }
        existing.status = "running"; existing.attempts += 1; existing.updatedAt = clock(); existing.errorCategory = null;
        return { action: "start", job: existing };
      }
      const job: LedgerJob = { ...input, status: "running", attempts: 1, providerJobId: null, asset: null, errorCategory: null, retryable: false, updatedAt: clock() };
      jobs.set(input.key, job);
      return { action: "start", job };
    },
    async setProviderJob(key, providerJobId) { const job = jobs.get(key); if (job) { job.providerJobId = providerJobId; job.updatedAt = clock(); } },
    async succeed(key, asset) { const job = jobs.get(key); if (job) { job.status = "succeeded"; job.asset = asset; job.updatedAt = clock(); } },
    async fail(key, category, retryable, providerJobId) { const job = jobs.get(key); if (job) { job.status = "failed"; job.errorCategory = category; job.retryable = retryable;
      if (providerJobId) job.providerJobId = providerJobId; job.updatedAt = clock(); } },
    async get(key) { return jobs.get(key) ?? null; },
  };
}

const fromRow = (row: Record<string, unknown>): LedgerJob => ({ key: String(row.idempotency_key), contentId: String(row.content_id), role: String(row.role), kind: row.kind as JobKind,
  provider: String(row.provider), status: row.status as LedgerJob["status"], attempts: Number(row.attempts), providerJobId: row.provider_job_id ? String(row.provider_job_id) : null,
  asset: (row.asset as GeneratedAsset | null) ?? null, errorCategory: row.error_category ? String(row.error_category) : null, retryable: !!row.retryable,
  briefHash: String(row.brief_hash), updatedAt: new Date(String(row.updated_at)).getTime() });

export function postgresLedger(db: Sql): JobLedger {
  return {
    async claim(input) {
      const inserted = await db.query(`INSERT INTO visual_jobs(idempotency_key,content_id,role,kind,provider,status,brief_hash) VALUES($1,$2,$3,$4,$5,'running',$6)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`, [input.key, input.contentId, input.role, input.kind, input.provider, input.briefHash]);
      if (inserted.rows[0]) return { action: "start", job: fromRow(inserted.rows[0]) };
      const existing = fromRow((await db.query("SELECT * FROM visual_jobs WHERE idempotency_key=$1", [input.key])).rows[0]);
      const verdict = decide(existing, input.maxAttempts, Date.now());
      if (verdict) {
        if (verdict.action === "resume") await db.query("UPDATE visual_jobs SET status='running',attempts=attempts+(CASE WHEN status='failed' THEN 1 ELSE 0 END),updated_at=now() WHERE idempotency_key=$1", [input.key]);
        return verdict;
      }
      // Conditional update: two concurrent retries cannot both start.
      const claimed = await db.query(`UPDATE visual_jobs SET status='running',attempts=attempts+1,error_category=NULL,updated_at=now()
        WHERE idempotency_key=$1 AND status='failed' AND retryable AND attempts<$2 RETURNING *`, [input.key, input.maxAttempts]);
      return claimed.rows[0] ? { action: "start", job: fromRow(claimed.rows[0]) } : { action: "blocked", job: existing, reason: "in_progress" };
    },
    async setProviderJob(key, providerJobId) { await db.query("UPDATE visual_jobs SET provider_job_id=$2,updated_at=now() WHERE idempotency_key=$1", [key, providerJobId]); },
    async succeed(key, asset) { await db.query("UPDATE visual_jobs SET status='succeeded',asset=$2,updated_at=now() WHERE idempotency_key=$1", [key, JSON.stringify(asset)]); },
    async fail(key, category, retryable, providerJobId) {
      await db.query("UPDATE visual_jobs SET status='failed',error_category=$2,retryable=$3,provider_job_id=COALESCE($4,provider_job_id),updated_at=now() WHERE idempotency_key=$1",
        [key, category, retryable, providerJobId ?? null]);
    },
    async get(key) { const row = (await db.query("SELECT * FROM visual_jobs WHERE idempotency_key=$1", [key])).rows[0]; return row ? fromRow(row) : null; },
  };
}

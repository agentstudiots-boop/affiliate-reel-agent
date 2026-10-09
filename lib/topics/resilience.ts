import { rawSignalSchema, type RawSignal, type SourceErrorKind, type SourceHealth, type SourceId } from "./schema";
import { emitEvent } from "../observability/events";

export type SourceContext = { now: Date; signal: AbortSignal; request: typeof fetch };
export type TopicSource = {
  id: SourceId;
  // Offline sources (calendar, evergreen) can never fail on the network and serve as the last fallback.
  offline?: boolean;
  configured(): boolean;
  fetch(context: SourceContext): Promise<RawSignal[]>;
};

export class SourceError extends Error {
  constructor(public readonly kind: SourceErrorKind, public readonly httpStatus?: number, public readonly retryAfterMs?: number) {
    super(`topic_source_${kind}`);
    this.name = "SourceError";
  }
}

export function httpError(response: Response): SourceError {
  const status = response.status;
  if (status === 429) {
    const header = response.headers.get("retry-after");
    const seconds = header && /^\d{1,4}$/.test(header) ? Number(header) : undefined;
    return new SourceError("rate_limited", status, seconds !== undefined ? seconds * 1000 : undefined);
  }
  if (status === 401 || status === 403) return new SourceError("auth", status);
  if (status >= 500) return new SourceError("unavailable", status);
  return new SourceError("invalid_response", status);
}

export function classifySourceError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/timeout|abort/i.test(text)) return new SourceError("timeout");
  if (/SyntaxError|JSON|schema|Zod/i.test(text)) return new SourceError("invalid_response");
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network/i.test(text)) return new SourceError("unavailable");
  return new SourceError("unknown");
}

const RETRYABLE: SourceErrorKind[] = ["timeout", "rate_limited", "unavailable"];
export type RetryPolicy = { attempts: number; timeoutMs: number; baseDelayMs: number; maxDelayMs: number };
export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, timeoutMs: 12_000, baseDelayMs: 600, maxDelayMs: 8_000 };

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Runs one source in isolation: per-attempt timeout, bounded retries with exponential backoff for transient errors,
// schema validation of every signal. Never throws; the caller gets signals plus a health record.
export async function runSource(source: TopicSource, options: { now: Date; request?: typeof fetch; policy?: Partial<RetryPolicy>;
  sleep?: (ms: number) => Promise<void>; deadline?: AbortSignal }): Promise<{ signals: RawSignal[]; health: SourceHealth }> {
  const policy = { ...DEFAULT_RETRY, ...options.policy };
  const sleep = options.sleep ?? defaultSleep;
  const started = Date.now();
  if (!source.configured()) {
    return { signals: [], health: { source: source.id, status: "skipped", errorKind: "not_configured", attempts: 0, durationMs: 0, signals: 0 } };
  }
  let last: SourceError | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    if (options.deadline?.aborted) { last = new SourceError("timeout"); break; }
    attempts = attempt;
    // Explicit timer (not AbortSignal.timeout): it keeps the attempt alive until it really times out.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new SourceError("timeout")), policy.timeoutMs);
    const signal = options.deadline ? AbortSignal.any([options.deadline, controller.signal]) : controller.signal;
    try {
      const raw = await raceAbort(source.fetch({ now: options.now, signal, request: options.request ?? fetch }), signal);
      const signals: RawSignal[] = [];
      for (const item of raw) { const parsed = rawSignalSchema.safeParse(item); if (parsed.success) signals.push(parsed.data); }
      if (raw.length && !signals.length) throw new SourceError("invalid_response");
      const health: SourceHealth = { source: source.id, status: signals.length ? "ok" : "empty", attempts, durationMs: Date.now() - started, signals: signals.length };
      emitEvent("topic_source_completed", { source: source.id, signals: signals.length, attempts });
      return { signals, health };
    } catch (error) {
      last = classifySourceError(error);
      if (!RETRYABLE.includes(last.kind) || attempt === policy.attempts) break;
      const backoff = Math.min(policy.maxDelayMs, last.retryAfterMs ?? policy.baseDelayMs * 2 ** (attempt - 1));
      await sleep(backoff);
    } finally { clearTimeout(timer); }
  }
  const failure = last ?? new SourceError("unknown");
  emitEvent("topic_source_failed", { source: source.id, errorKind: failure.kind, httpStatus: failure.httpStatus, attempts }, "warn");
  return { signals: [], health: { source: source.id, status: "failed", errorKind: failure.kind, ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}), attempts, durationMs: Date.now() - started, signals: 0 } };
}

// A source that ignores its AbortSignal still cannot hang the run.
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new SourceError("timeout")); return; }
    const aborted = () => reject(new SourceError("timeout"));
    signal.addEventListener("abort", aborted, { once: true });
    work.then(value => { signal.removeEventListener("abort", aborted); resolve(value); },
      error => { signal.removeEventListener("abort", aborted); reject(error); });
  });
}

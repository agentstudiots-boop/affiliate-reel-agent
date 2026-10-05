import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { DEFAULT_REPLICATE_IMAGE_MODEL, readReplicatePng, REPLICATE_API, ReplicateFailure, replicateHttpFailure, replicateOutputUrl, replicatePredictionId,
  SUPPORTED_REPLICATE_IMAGE_MODELS } from "../../content/providers/replicate-image";
import { ImageGenerationError, type GeneratedAsset, type ImageBrief, type ImageProvider } from "../types";

// ReplicateImageProvider for the Visual Content Engine. Reuses the validated helpers of the existing Replicate
// integration (HTTP classification, prediction id / output URL checks, bounded PNG download). Differences to the
// product image path: takes a structured brief instead of a ContentJob, and can resume an existing prediction
// by id so a timeout never leads to a second paid prediction.

type Prediction = { id?: unknown; status?: unknown; output?: unknown };
export type ReplicateDeps = { request?: typeof fetch; upload?: typeof put; timeoutMs?: number; pollIntervalMs?: number; token?: string; model?: string };

const CATEGORY: Record<string, { category: ConstructorParameters<typeof ImageGenerationError>[0]; retryable: boolean }> = {
  auth: { category: "auth", retryable: false }, billing: { category: "billing", retryable: false }, access: { category: "auth", retryable: false },
  model_or_endpoint: { category: "invalid_request", retryable: false }, request_schema: { category: "invalid_request", retryable: false },
  rate_limit: { category: "rate_limited", retryable: true }, provider_error: { category: "provider_error", retryable: true }, request_rejected: { category: "invalid_request", retryable: false },
  failed: { category: "generation_failed", retryable: false }, canceled: { category: "generation_failed", retryable: false },
  invalid_output: { category: "invalid_asset", retryable: false }, invalid_prediction_id: { category: "provider_error", retryable: false },
  invalid_prediction_response: { category: "provider_error", retryable: false }, prediction_id_mismatch: { category: "provider_error", retryable: false },
  unknown_status: { category: "provider_error", retryable: false },
};

export function replicateImageAvailability(): { ok: boolean; reason?: string } {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  const model = process.env.REPLICATE_IMAGE_MODEL?.trim() || DEFAULT_REPLICATE_IMAGE_MODEL;
  if (!token) return { ok: false, reason: "REPLICATE_API_TOKEN fehlt" };
  if (!SUPPORTED_REPLICATE_IMAGE_MODELS.includes(model as (typeof SUPPORTED_REPLICATE_IMAGE_MODELS)[number])) return { ok: false, reason: "REPLICATE_IMAGE_MODEL wird nicht unterstützt" };
  return { ok: true };
}

export function createReplicateBriefProvider(deps: ReplicateDeps = {}): ImageProvider {
  const model = deps.model ?? (process.env.REPLICATE_IMAGE_MODEL?.trim() || DEFAULT_REPLICATE_IMAGE_MODEL);
  return {
    name: "replicate",
    model,
    available: () => deps.token ? { ok: true } : replicateImageAvailability(),
    async generate(brief: ImageBrief, options): Promise<GeneratedAsset> {
      const key = deps.token ?? process.env.REPLICATE_API_TOKEN?.trim();
      if (!key) throw new ImageGenerationError("unavailable", false);
      const request = deps.request ?? fetch;
      // Explicit timer: keeps the job observable in long-running functions and in tests.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 95_000);
      const signal = controller.signal;
      const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
      let id: string | null = options.resumeJobId ?? null;
      let phase: "create" | "poll" | "download" | "upload" = id ? "poll" : "create";
      try {
        let prediction: Prediction;
        if (!id) {
          const created = await request(`${REPLICATE_API}/models/${model}/predictions`, { method: "POST", headers: { ...headers, Prefer: "wait=20", "Cancel-After": "90s" }, signal,
            body: JSON.stringify({ input: { prompt: brief.prompt.slice(0, 3800), aspect_ratio: brief.aspectRatio, output_format: "png" } }) });
          if (!created.ok) throw replicateHttpFailure(created.status, (await created.text()).slice(0, 2048));
          try { prediction = await created.json() as Prediction; } catch { throw new ReplicateFailure("invalid_prediction_response"); }
          id = replicatePredictionId(prediction?.id);
          if (!id) throw new ReplicateFailure("invalid_prediction_id");
          await options.onJobCreated?.(id);
          phase = "poll";
        } else {
          const polled = await request(`${REPLICATE_API}/predictions/${id}`, { headers: { Authorization: `Bearer ${key}` }, signal });
          if (!polled.ok) throw replicateHttpFailure(polled.status, (await polled.text()).slice(0, 2048));
          prediction = await polled.json() as Prediction;
        }
        while (prediction.status === "starting" || prediction.status === "processing") {
          await new Promise<void>((resolve, reject) => {
            const wait = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, deps.pollIntervalMs ?? 1500);
            const aborted = () => { clearTimeout(wait); reject(new Error("timeout")); };
            signal.addEventListener("abort", aborted, { once: true });
            if (signal.aborted) aborted();
          });
          const polled = await request(`${REPLICATE_API}/predictions/${id}`, { headers: { Authorization: `Bearer ${key}` }, signal });
          if (!polled.ok) throw replicateHttpFailure(polled.status, (await polled.text()).slice(0, 2048));
          try { prediction = await polled.json() as Prediction; } catch { throw new ReplicateFailure("invalid_prediction_response"); }
          if (replicatePredictionId(prediction?.id) !== id) throw new ReplicateFailure("prediction_id_mismatch");
        }
        if (prediction.status !== "succeeded") throw new ReplicateFailure(prediction.status === "failed" || prediction.status === "canceled" ? String(prediction.status) : "unknown_status");
        const url = replicateOutputUrl(prediction.output);
        if (!url) throw new ReplicateFailure("invalid_output");
        phase = "download";
        const bytes = await readReplicatePng(await request(url.href, { redirect: "manual", signal }));
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        phase = "upload";
        const path = `generated/topics/${options.contentId.replace(/[^a-zA-Z0-9_-]/g, "")}/${sha256}.png`;
        const blob = await (deps.upload ?? put)(path, bytes, { access: "public", addRandomSuffix: false, contentType: "image/png" });
        const blobUrl = new URL(blob.url);
        if (blobUrl.protocol !== "https:" || !blobUrl.hostname.endsWith(".public.blob.vercel-storage.com")) throw new ImageGenerationError("invalid_asset", false, id);
        return { kind: "image", url: blobUrl.href, sha256, mediaType: "image/png", provider: "replicate", model, providerJobId: id };
      } catch (error) {
        if (error instanceof ImageGenerationError) throw error;
        if (error instanceof ReplicateFailure) {
          const mapped = CATEGORY[error.category] ?? { category: "provider_error" as const, retryable: false };
          // A refusal while creating means nothing was accepted or charged: safe to POST again later (429/5xx).
          // During polling, a transient error keeps the prediction id: the next attempt resumes it.
          throw new ImageGenerationError(mapped.category, mapped.retryable && (phase === "create" || !!id), id, error.httpStatus);
        }
        if (signal.aborted || /timeout|abort/i.test(String(error))) {
          // Timeout before a prediction id exists: the POST outcome is unknown → never re-POST automatically.
          throw new ImageGenerationError("timeout", !!id, id);
        }
        if (phase === "download") throw new ImageGenerationError("invalid_asset", false, id);
        if (phase === "upload") throw new ImageGenerationError("provider_error", !!id, id);
        throw new ImageGenerationError("unknown", false, id);
      } finally { clearTimeout(timer); }
    },
  };
}

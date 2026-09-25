import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import type { ContentJob } from "../schema";
import type { OriginalVisualAsset, OriginalVisualProvider } from "../image-provider";
import { buildOriginalVisualPrompt, OriginalVisualError, pngIsPlausible } from "./openai-image";

export const DEFAULT_REPLICATE_IMAGE_MODEL = "black-forest-labs/flux-1.1-pro";
// These official models share the same single-URI PNG output contract.
export const SUPPORTED_REPLICATE_IMAGE_MODELS = [DEFAULT_REPLICATE_IMAGE_MODEL, "black-forest-labs/flux-1.1-pro-ultra"] as const;
const API = "https://api.replicate.com/v1";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 95_000; // Leave time for the 120-second publication route to respond.

type Prediction = { id?: unknown; status?: unknown; output?: unknown; metrics?: { predict_time?: unknown } };
type Dependencies = { request?: typeof fetch; upload?: typeof put; timeoutMs?: number; pollIntervalMs?: number };

function predictionId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9]{12,64}$/.test(value) ? value : null;
}

function outputUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password &&
        (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery"))) return url;
  } catch { /* Invalid output. */ }
  return null;
}

async function readPng(response: Response): Promise<Buffer> {
  if (!response.ok || !/^image\/png(?:\s*;|\s*$)/i.test(response.headers.get("content-type") || "")) {
    throw new OriginalVisualError("Replicate-Bilddatei hat keinen gültigen PNG-Typ.");
  }
  const length = response.headers.get("content-length");
  if (length && (!Number.isSafeInteger(Number(length)) || Number(length) > MAX_IMAGE_BYTES)) {
    throw new OriginalVisualError("Replicate-Bilddatei ist zu groß.");
  }
  if (!response.body) throw new OriginalVisualError("Replicate-Bilddatei fehlt.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new OriginalVisualError("Replicate-Bilddatei ist zu groß.");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  if (!pngIsPlausible(bytes)) throw new OriginalVisualError("Replicate-Bilddatei ist ungültig.");
  return bytes;
}

export function createReplicateImageProvider(key: string, model = DEFAULT_REPLICATE_IMAGE_MODEL, deps: Dependencies = {}): OriginalVisualProvider {
  if (!key.trim()) throw new OriginalVisualError("REPLICATE_API_TOKEN fehlt.");
  if (!SUPPORTED_REPLICATE_IMAGE_MODELS.includes(model as (typeof SUPPORTED_REPLICATE_IMAGE_MODELS)[number])) {
    throw new OriginalVisualError("REPLICATE_IMAGE_MODEL wird nicht unterstützt.");
  }
  return { name: "replicate", async render(job: ContentJob): Promise<OriginalVisualAsset> {
    const prompt = buildOriginalVisualPrompt(job);
    const request = deps.request || fetch;
    const deadline = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS);
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    let phase = "create";
    let id: string | null = null;
    try {
      // One paid POST. Subsequent GETs only observe that same prediction; never create a second image.
      const created = await request(`${API}/models/${model}/predictions`, {
        method: "POST", headers: { ...headers, Prefer: "wait=20", "Cancel-After": "90s" },
        body: JSON.stringify({ input: { prompt, aspect_ratio: "4:5", output_format: "png", ...(model.endsWith("-ultra") ? { raw: true } : {}) } }),
        signal: deadline,
      });
      if (!created.ok) throw new OriginalVisualError("Replicate hat die Bildanfrage abgelehnt.");
      let prediction = await created.json() as Prediction;
      id = predictionId(prediction?.id);
      if (!id) throw new OriginalVisualError("Replicate hat keine gültige Vorhersage-ID geliefert.");
      phase = "poll";
      while (prediction.status === "starting" || prediction.status === "processing") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { deadline.removeEventListener("abort", aborted); resolve(); }, deps.pollIntervalMs ?? 1500);
          const aborted = () => { clearTimeout(timer); reject(new OriginalVisualError("Replicate-Zeitlimit erreicht.")); };
          deadline.addEventListener("abort", aborted, { once: true });
          if (deadline.aborted) aborted();
        });
        const polled = await request(`${API}/predictions/${id}`, { headers: { Authorization: `Bearer ${key}` }, signal: deadline });
        if (!polled.ok) throw new OriginalVisualError("Replicate-Status nicht abrufbar.");
        prediction = await polled.json() as Prediction;
        if (predictionId(prediction?.id) !== id) throw new OriginalVisualError("Replicate-Status gehört zu einem anderen Bildversuch.");
      }
      if (prediction.status !== "succeeded") throw new OriginalVisualError("Replicate-Bildversuch fehlgeschlagen oder Ergebnis unklar.");
      const url = outputUrl(prediction.output);
      if (!url) throw new OriginalVisualError("Replicate hat keine gültige einzelne Bild-URL geliefert.");
      phase = "download";
      const image = await request(url.href, { redirect: "manual", signal: deadline });
      const bytes = await readPng(image);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      phase = "blob";
      const path = `generated/facebook/${job.id}/${sha256}.png`;
      const blob = await (deps.upload || put)(path, bytes, { access: "public", addRandomSuffix: false, contentType: "image/png" });
      const blobUrl = new URL(blob.url);
      if (blobUrl.protocol !== "https:" || !blobUrl.hostname.endsWith(".public.blob.vercel-storage.com") || blobUrl.pathname !== `/${path}`) {
        throw new OriginalVisualError("Blob-Upload lieferte keine gültige Bild-URL.");
      }
      const predictTime = prediction.metrics?.predict_time;
      const usage = { predictionId: id, ...(typeof predictTime === "number" && Number.isFinite(predictTime) && predictTime >= 0 ? { predictTimeSeconds: predictTime } : {}) };
      return { url: blobUrl.href, provider: "replicate", mediaType: "image", model, sha256, generatedAt: new Date().toISOString(), usage };
    } catch {
      console.error(JSON.stringify({ event: "replicate_image_failed", jobId: job.id, model, predictionId: id, phase }));
      throw new OriginalVisualError("Replicate-Bildversuch fehlgeschlagen oder Ergebnis unklar. Kein automatischer zweiter Versuch.");
    }
  } };
}

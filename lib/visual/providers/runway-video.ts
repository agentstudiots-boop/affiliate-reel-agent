import { createHash } from "node:crypto";
import { put } from "../../security/guarded-blob";
import { getRunwayClient, RUNWAY_DURATION_SECONDS, RUNWAY_MODEL, RUNWAY_RATIO } from "../../runway";
import { VideoProviderError, type VideoInput, type VideoProvider, type VideoStatus } from "../video";
import type { GeneratedAsset } from "../types";

// StandardVideoProvider on the existing Runway integration (same client, SDK retries disabled, same model and
// ratio). Opt-in only (TOPIC_STANDARD_VIDEO_PROVIDER=runway) because every clip costs credits; the existing
// product reel pipeline and its cost approval are untouched.

type RunwayLike = {
  textToVideo: { create(input: Record<string, unknown>): Promise<{ id: string }> };
  tasks: { retrieve(id: string): Promise<{ id?: string; status?: string; output?: string[] | null; failure?: string | null }> };
};
export type RunwayVideoDeps = { client?: RunwayLike; request?: typeof fetch; upload?: typeof put };

function statusOf(error: unknown) { const status = (error as { status?: unknown })?.status; return typeof status === "number" ? status : 0; }

export function createRunwayStandardVideoProvider(deps: RunwayVideoDeps = {}): VideoProvider {
  const client = () => deps.client ?? (getRunwayClient() as unknown as RunwayLike);
  return {
    name: "runway",
    kind: "standard_video",
    available() {
      if (process.env.TOPIC_STANDARD_VIDEO_PROVIDER !== "runway" && !deps.client) return { ok: false, reason: "Standard-Video nicht freigeschaltet (TOPIC_STANDARD_VIDEO_PROVIDER=runway)" };
      if (!deps.client && !process.env.RUNWAYML_API_SECRET) return { ok: false, reason: "RUNWAYML_API_SECRET fehlt" };
      return { ok: true };
    },
    async create(input: VideoInput) {
      try {
        const task = await client().textToVideo.create({ model: RUNWAY_MODEL, promptText: input.visualPrompt.slice(0, 1000), ratio: RUNWAY_RATIO, duration: RUNWAY_DURATION_SECONDS, audio: true });
        if (!task?.id) throw new VideoProviderError("invalid_response", false);
        return { jobId: task.id };
      } catch (error) {
        if (error instanceof VideoProviderError) throw error;
        const status = statusOf(error);
        if (status === 401 || status === 403) throw new VideoProviderError("auth", false, null, status);
        if (status === 429) throw new VideoProviderError("rate_limited", true, null, status);
        if (status === 402 || /credit|balance/i.test(String(error))) throw new VideoProviderError("quota_exhausted", false, null, status);
        if (status >= 400 && status < 500) throw new VideoProviderError("invalid_request", false, null, status);
        // No status: response lost; the clip may already be paid → no automatic second creation.
        throw new VideoProviderError(status >= 500 ? "provider_down" : "timeout", false, null, status || undefined);
      }
    },
    async status(jobId: string): Promise<VideoStatus> {
      let task;
      try { task = await client().tasks.retrieve(jobId); }
      catch (error) { throw new VideoProviderError(statusOf(error) === 401 ? "auth" : "provider_down", statusOf(error) !== 401, jobId, statusOf(error) || undefined); }
      if (task.status === "SUCCEEDED") return { state: "completed", videoUrl: task.output?.[0] ?? null };
      if (task.status === "FAILED" || task.status === "CANCELLED") return { state: "failed", error: "runway_task_failed" };
      return { state: "processing" };
    },
    async archive(jobId: string, url: string, contentId: string): Promise<GeneratedAsset> {
      const response = await (deps.request ?? fetch)(url);
      if (!response.ok || !response.body) throw new VideoProviderError("invalid_response", true, jobId);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const blob = await (deps.upload ?? put)(`generated/topics/${contentId.replace(/[^a-zA-Z0-9_-]/g, "")}/video-${sha256}.mp4`, bytes, { access: "public", addRandomSuffix: false, contentType: "video/mp4" });
      return { kind: "video", url: blob.url, sha256, mediaType: "video/mp4", provider: "runway", providerJobId: jobId, durationSeconds: RUNWAY_DURATION_SECONDS };
    },
  };
}

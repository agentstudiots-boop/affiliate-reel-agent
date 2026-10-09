import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { VideoProviderError, type VideoInput, type VideoProvider, type VideoStatus } from "../video";
import type { GeneratedAsset } from "../types";

// HeyGenAvatarProvider: the only place with HeyGen-specific code. Called exclusively through the
// AvatarVideoRenderer after the format router chose AVATAR_VIDEO; never by the scout or Jarvis.
// API (v2 generate / v1 status) per HeyGen's public documentation. NOT live-verified in this environment.

const API = "https://api.heygen.com";
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export type HeyGenDeps = { request?: typeof fetch; upload?: typeof put; apiKey?: string; avatarId?: string; voiceId?: string; monthlyLimit?: number; timeoutMs?: number };

export function heygenConfig(deps: HeyGenDeps = {}) {
  const apiKey = deps.apiKey ?? process.env.HEYGEN_API_KEY?.trim();
  const avatarId = deps.avatarId ?? process.env.HEYGEN_AVATAR_ID?.trim();
  const voiceId = deps.voiceId ?? process.env.HEYGEN_VOICE_ID?.trim();
  const limit = deps.monthlyLimit ?? Number(process.env.HEYGEN_MONTHLY_VIDEO_LIMIT ?? "");
  const monthlyLimit = Number.isInteger(limit) && limit > 0 ? limit : 0;
  // HeyGen is a limited resource: without an explicit monthly limit no avatar video is produced.
  const missing = [!apiKey && "HEYGEN_API_KEY", !avatarId && "HEYGEN_AVATAR_ID", !voiceId && "HEYGEN_VOICE_ID", !monthlyLimit && "HEYGEN_MONTHLY_VIDEO_LIMIT"].filter(Boolean) as string[];
  return { apiKey, avatarId, voiceId, monthlyLimit, missing };
}

// Classifies HeyGen HTTP answers. Quota/credit refusals are distinguished from generic 4xx by the error text,
// but only fixed labels are kept (no provider text, no key) in errors and logs.
function classify(status: number, body: string, phase: "create" | "status", jobId: string | null): VideoProviderError {
  if (status === 401 || status === 403) return new VideoProviderError("auth", false, jobId, status);
  if (status === 429) return new VideoProviderError("rate_limited", phase === "create" || !!jobId, jobId, status);
  if (/quota|credit|insufficient|limit exceeded|exceed/i.test(body) && status >= 400 && status < 500) return new VideoProviderError("quota_exhausted", false, jobId, status);
  if (status >= 500) return new VideoProviderError("provider_down", phase === "create" || !!jobId, jobId, status);
  return new VideoProviderError(phase === "create" ? "invalid_request" : "invalid_response", false, jobId, status);
}

export function createHeyGenAvatarProvider(deps: HeyGenDeps = {}): VideoProvider {
  const request = deps.request ?? fetch;
  const timed = () => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 20_000); return { signal: controller.signal, done: () => clearTimeout(timer) }; };
  return {
    name: "heygen",
    kind: "avatar_video",
    available() {
      const config = heygenConfig(deps);
      if (config.missing.length) return { ok: false, reason: `${config.missing.join(", ")} fehlt` };
      return { ok: true };
    },
    async create(input: VideoInput) {
      const config = heygenConfig(deps);
      if (config.missing.length) throw new VideoProviderError("unavailable", false);
      const clock = timed();
      let response: Response;
      try {
        response = await request(`${API}/v2/video/generate`, { method: "POST", signal: clock.signal, redirect: "error",
          headers: { "X-Api-Key": config.apiKey!, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ title: input.title.slice(0, 100), dimension: { width: 720, height: 1280 },
            video_inputs: [{ character: { type: "avatar", avatar_id: config.avatarId, avatar_style: "normal" }, voice: { type: "text", input_text: input.script.slice(0, 1500), voice_id: config.voiceId } }] }) });
      } catch {
        // No answer to a paid POST: the outcome is unknown → never re-POST automatically.
        throw new VideoProviderError("timeout", false, null);
      } finally { clock.done(); }
      const text = await response.text();
      if (!response.ok) throw classify(response.status, text.slice(0, 2000), "create", null);
      let body: { error?: unknown; data?: { video_id?: unknown } };
      try { body = JSON.parse(text); } catch { throw new VideoProviderError("invalid_response", false, null, response.status); }
      const id = body?.data?.video_id;
      if (body?.error || typeof id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new VideoProviderError("invalid_response", false, null, response.status);
      return { jobId: id };
    },
    async status(jobId: string): Promise<VideoStatus> {
      const config = heygenConfig(deps);
      if (!config.apiKey) throw new VideoProviderError("unavailable", false, jobId);
      const clock = timed();
      let response: Response;
      try {
        response = await request(`${API}/v1/video_status.get?video_id=${encodeURIComponent(jobId)}`, { headers: { "X-Api-Key": config.apiKey, Accept: "application/json" }, signal: clock.signal, redirect: "error" });
      } catch { throw new VideoProviderError("timeout", true, jobId); }
      finally { clock.done(); }
      const text = await response.text();
      if (!response.ok) throw classify(response.status, text.slice(0, 2000), "status", jobId);
      let body: { data?: { status?: unknown; video_url?: unknown; error?: unknown } };
      try { body = JSON.parse(text); } catch { throw new VideoProviderError("invalid_response", true, jobId, response.status); }
      const state = body?.data?.status;
      if (state === "completed") return { state: "completed", videoUrl: typeof body.data?.video_url === "string" ? body.data.video_url : null };
      if (state === "failed") return { state: "failed", error: "heygen_job_failed" };
      if (state === "pending" || state === "processing" || state === "waiting") return { state: "processing" };
      throw new VideoProviderError("invalid_response", true, jobId, response.status);
    },
    async archive(jobId: string, url: string, contentId: string): Promise<GeneratedAsset> {
      let source: URL;
      try { source = new URL(url); } catch { throw new VideoProviderError("invalid_response", false, jobId); }
      if (source.protocol !== "https:" || source.username || source.password) throw new VideoProviderError("invalid_response", false, jobId);
      const response = await request(source.href, { redirect: "follow" });
      if (!response.ok || !/^video\/mp4/i.test(response.headers.get("content-type") || "") || !response.body) throw new VideoProviderError("invalid_response", true, jobId);
      const length = Number(response.headers.get("content-length") || "0");
      if (length > MAX_VIDEO_BYTES) throw new VideoProviderError("invalid_response", false, jobId);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_VIDEO_BYTES) throw new VideoProviderError("invalid_response", false, jobId);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const blob = await (deps.upload ?? put)(`generated/topics/${contentId.replace(/[^a-zA-Z0-9_-]/g, "")}/avatar-${sha256}.mp4`, bytes, { access: "public", addRandomSuffix: false, contentType: "video/mp4" });
      return { kind: "video", url: blob.url, sha256, mediaType: "video/mp4", provider: "heygen", providerJobId: jobId };
    },
  };
}

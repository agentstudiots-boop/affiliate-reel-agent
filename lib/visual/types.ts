import type { ContentFormat } from "../formats/catalog";

// Shared contracts of the Visual Content Engine. Renderers depend on provider interfaces only;
// provider-specific code (Replicate, HeyGen, …) stays inside lib/visual/providers/.

export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";
export type ImageBrief = { prompt: string; aspectRatio: AspectRatio; styleKey: string; negative?: string };

export type GeneratedAsset = {
  kind: "image" | "video" | "text_graphic";
  url: string | null;          // null in dry-run or for not yet uploaded local renders
  sha256: string | null;
  mediaType: string;
  provider: string;
  model?: string;
  providerJobId?: string | null;
  width?: number; height?: number; durationSeconds?: number;
  svg?: string;                // text graphics: deterministic local render
};

export type ImageErrorCategory = "timeout" | "rate_limited" | "provider_error" | "auth" | "billing" | "invalid_request" | "invalid_asset" | "generation_failed" | "unavailable" | "unknown";

// retryable: nothing was accepted by the provider (safe to POST again) OR a provider job id exists (resume by polling).
export class ImageGenerationError extends Error {
  constructor(public readonly category: ImageErrorCategory, public readonly retryable: boolean, public readonly providerJobId: string | null = null,
    public readonly httpStatus?: number) {
    super(`image_generation_${category}`);
    this.name = "ImageGenerationError";
  }
}

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  available(): { ok: boolean; reason?: string };
  // resumeJobId: observe an already created provider job instead of creating (and paying for) a new one.
  generate(brief: ImageBrief, options: { contentId: string; role: string; resumeJobId?: string | null; onJobCreated?: (jobId: string) => Promise<void> }): Promise<GeneratedAsset>;
}

export type ProductionStatus = "completed" | "partial" | "degraded" | "failed" | "dry_run";
export type ProductionResult = {
  contentId: string;
  requestedFormat: ContentFormat;
  producedFormat: ContentFormat;
  status: ProductionStatus;
  assets: { role: string; asset: GeneratedAsset }[];
  carousel?: import("./carousel/planner").CarouselPlan & { slideResults: SlideResult[] };
  video?: { script: string; provider: string | null; jobId: string | null };
  fallbacks: { from: ContentFormat; to: ContentFormat; reason: string }[];
  dryRun: { wouldGenerateImages: number; wouldUseAvatar: boolean; wouldUseStandardVideo: boolean; notes: string[] } | null;
  errors: string[];
};

export type SlideResult = { slide_number: number; status: "succeeded" | "failed" | "degraded" | "planned"; asset: GeneratedAsset | null; error?: string; reused?: boolean };

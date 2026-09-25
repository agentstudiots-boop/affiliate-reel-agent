import type { ContentJob } from "./schema";
import { createOpenAIImageProvider, DEFAULT_OPENAI_IMAGE_MODEL, SUPPORTED_OPENAI_IMAGE_MODELS } from "./providers/openai-image";
import { createReplicateImageProvider, DEFAULT_REPLICATE_IMAGE_MODEL, SUPPORTED_REPLICATE_IMAGE_MODELS } from "./providers/replicate-image";

export type OriginalVisualAsset = {
  url: string;
  provider: string;
  mediaType: "image";
  model?: string;
  sha256?: string;
  generatedAt?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; predictionId?: string; predictTimeSeconds?: number };
};

export type OriginalVisualProvider = {
  name: string;
  render(job: ContentJob): Promise<OriginalVisualAsset>;
};

export class ImageProviderUnavailableError extends Error {}

export function imageProviderStatus() {
  const replicateModel = process.env.REPLICATE_IMAGE_MODEL?.trim() || DEFAULT_REPLICATE_IMAGE_MODEL;
  const openaiModel = process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
  const replicateConfigured = !!process.env.REPLICATE_API_TOKEN?.trim() && SUPPORTED_REPLICATE_IMAGE_MODELS.includes(replicateModel as (typeof SUPPORTED_REPLICATE_IMAGE_MODELS)[number]);
  const openaiConfigured = !!process.env.OPENAI_API_KEY?.trim() && SUPPORTED_OPENAI_IMAGE_MODELS.includes(openaiModel as (typeof SUPPORTED_OPENAI_IMAGE_MODELS)[number]);
  // An invalid explicitly configured primary model must stop production, not silently change provider.
  const invalidPrimary = !!process.env.REPLICATE_API_TOKEN?.trim() && !SUPPORTED_REPLICATE_IMAGE_MODELS.includes(replicateModel as (typeof SUPPORTED_REPLICATE_IMAGE_MODELS)[number]);
  const provider = replicateConfigured ? "replicate" : !invalidPrimary && openaiConfigured ? "openai" : null;
  return {
    configured: provider !== null,
    provider,
    primary: provider,
    fallback: replicateConfigured && openaiConfigured ? "openai" : null,
    available: { replicate: replicateConfigured, openai: openaiConfigured },
    model: provider === "replicate" ? replicateModel : openaiModel,
    reason: invalidPrimary ? "REPLICATE_IMAGE_MODEL wird nicht unterstützt." : provider === "replicate" ? "Bildprovider: Replicate; OpenAI nur bei fehlendem Replicate-Token." : provider === "openai" ? "Bildprovider: OpenAI (Replicate nicht konfiguriert)." : "Kein Bildprovider konfiguriert. REPLICATE_API_TOKEN und OPENAI_API_KEY fehlen oder sind nicht verwendbar. Die Textkarte bleibt Debug-Preview.",
  };
}

export function getOriginalVisualProvider(): OriginalVisualProvider | null {
  const status = imageProviderStatus();
  if (status.provider === "replicate") return createReplicateImageProvider(process.env.REPLICATE_API_TOKEN!.trim(), status.model);
  if (status.provider === "openai") return createOpenAIImageProvider(process.env.OPENAI_API_KEY!.trim(), status.model);
  return null;
}

export async function renderOriginalVisual(job: ContentJob): Promise<OriginalVisualAsset> {
  const provider = getOriginalVisualProvider();
  if (!provider) throw new ImageProviderUnavailableError(imageProviderStatus().reason);
  return provider.render(job);
}

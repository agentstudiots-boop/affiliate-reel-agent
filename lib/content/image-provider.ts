import type { ContentJob } from "./schema";
import { createOpenAIImageProvider, DEFAULT_OPENAI_IMAGE_MODEL, SUPPORTED_OPENAI_IMAGE_MODELS } from "./providers/openai-image";

export type OriginalVisualAsset = {
  url: string;
  provider: string;
  mediaType: "image";
  model?: string;
  sha256?: string;
  generatedAt?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

export type OriginalVisualProvider = {
  name: string;
  render(job: ContentJob): Promise<OriginalVisualAsset>;
};

export class ImageProviderUnavailableError extends Error {}

export function imageProviderStatus() {
  const hasKey = !!process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
  const supported = SUPPORTED_OPENAI_IMAGE_MODELS.includes(model as (typeof SUPPORTED_OPENAI_IMAGE_MODELS)[number]);
  const configured = hasKey && supported;
  return {
    configured,
    provider: "openai",
    model,
    reason: configured ? "Bildprovider: OpenAI" : !hasKey ? "OpenAI-Bildgenerator noch nicht konfiguriert. OPENAI_API_KEY fehlt. Die Textkarte bleibt Debug-Preview." : "OPENAI_IMAGE_MODEL wird für das Bildformat nicht unterstützt.",
  };
}

export function getOriginalVisualProvider(): OriginalVisualProvider | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key && imageProviderStatus().configured ? createOpenAIImageProvider(key, imageProviderStatus().model) : null;
}

export async function renderOriginalVisual(job: ContentJob): Promise<OriginalVisualAsset> {
  const provider = getOriginalVisualProvider();
  if (!provider) throw new ImageProviderUnavailableError(imageProviderStatus().reason);
  return provider.render(job);
}

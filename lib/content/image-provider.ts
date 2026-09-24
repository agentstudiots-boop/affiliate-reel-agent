import type { ContentJob } from "./schema";

export type OriginalVisualAsset = {
  url: string;
  provider: string;
  mediaType: "image";
};

export type OriginalVisualProvider = {
  name: string;
  render(job: ContentJob): Promise<OriginalVisualAsset>;
};

export class ImageProviderUnavailableError extends Error {}

export function imageProviderStatus() {
  return {
    configured: false,
    provider: null as string | null,
    reason: "Kein produktiver Bildgenerator ist angeschlossen. Die vorhandene Textkarte bleibt ausschließlich Debug-/Fallback-Preview.",
  };
}

export function getOriginalVisualProvider(): OriginalVisualProvider | null {
  // Absichtlich fail-closed: erst einen real ausgewählten und verifizierten Provider
  // implementieren. Keine unbekannte API und keinen erfundenen Environment-Key annehmen.
  return null;
}

export async function renderOriginalVisual(job: ContentJob): Promise<OriginalVisualAsset> {
  const provider = getOriginalVisualProvider();
  if (!provider) throw new ImageProviderUnavailableError(imageProviderStatus().reason);
  return provider.render(job);
}

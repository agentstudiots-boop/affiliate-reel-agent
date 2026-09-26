import type { ProductionMode, ProductionProvider } from "./schema";

export const FACELESS_LEARNING_TARGET = 15;

export type VideoProviderDecision = {
  provider: ProductionProvider;
  mode: ProductionMode;
  forced: boolean;
  successfulVideos: number;
  target: number;
  reason: string;
};

export function chooseVideoProvider(successfulVideos: number, requested?: ProductionProvider): VideoProviderDecision {
  if (!Number.isInteger(successfulVideos) || successfulVideos < 0) {
    throw new Error("Ungültige Anzahl erfolgreicher Produktionen.");
  }
  if (requested === "faceless_video") {
    return {
      provider: "faceless_video",
      mode: "FACELESS_STORYBOARD",
      forced: false,
      successfulVideos,
      target: FACELESS_LEARNING_TARGET,
      reason: "Faceless ist als zweiter Kanal verfügbar. Vor jeder Produktion sind Inhalt und Kosten separat freizugeben.",
    };
  }
  if (requested === "runway" || !requested) {
    return {
      provider: "runway",
      mode: "RUNWAY_SINGLE_CLIP",
      forced: false,
      successfulVideos,
      target: FACELESS_LEARNING_TARGET,
      reason: "Runway ist für 30-Sekunden-Storys vorgesehen; ein eigenes Produktbild mit Nutzungsrecht ist erforderlich.",
    };
  }
  return {
    provider: "faceless_video",
    mode: "FACELESS_STORYBOARD",
    forced: false,
    successfulVideos,
    target: FACELESS_LEARNING_TARGET,
    reason: "Faceless bleibt als zweiter Kanal verfügbar.",
  };
}

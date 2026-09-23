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
  if (successfulVideos < FACELESS_LEARNING_TARGET) {
    return {
      provider: "faceless_video",
      mode: "FACELESS_STORYBOARD",
      forced: true,
      successfulVideos,
      target: FACELESS_LEARNING_TARGET,
      reason: `Lernphase: Die ersten ${FACELESS_LEARNING_TARGET} erfolgreich abgeschlossenen Videos werden zwingend mit Faceless Storyboard produziert.`,
    };
  }
  if (requested === "runway") {
    return {
      provider: "runway",
      mode: "RUNWAY_SINGLE_CLIP",
      forced: false,
      successfulVideos,
      target: FACELESS_LEARNING_TARGET,
      reason: "Die Faceless-Lernphase ist abgeschlossen; Runway darf für geeignete Einzelclips gewählt werden.",
    };
  }
  return {
    provider: "faceless_video",
    mode: "FACELESS_STORYBOARD",
    forced: false,
    successfulVideos,
    target: FACELESS_LEARNING_TARGET,
    reason: "Die Faceless-Lernphase ist abgeschlossen; Faceless bleibt der Standard, bis Performance-Daten einen anderen Renderer begründen.",
  };
}

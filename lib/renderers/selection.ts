import type { ProductionFactors, RendererDecision } from "./types";

export const FACELESS_BOOTSTRAP_TARGET = 15;

export function selectRenderer(successfulFacelessVideos: number, factors: ProductionFactors): RendererDecision {
  if (successfulFacelessVideos < FACELESS_BOOTSTRAP_TARGET) {
    return { provider:"faceless", mode:"FACELESS_STORYBOARD", reason:"BOOTSTRAP_STORYBOARD_TEST",
      explanation:`Bootstrap ${successfulFacelessVideos}/${FACELESS_BOOTSTRAP_TARGET}: ausschließlich Faceless Storyboard bis 15 erfolgreich gespeicherte Videos.` };
  }
  if (factors.specificScenesRequired) {
    return { provider:"runway", mode:"RUNWAY", reason:"CUSTOM_SCENES_REQUIRED",
      explanation:"Das Creative benötigt konkrete individuelle Szenen, die standardisierte Faceless-Verfahren nicht zuverlässig abbilden." };
  }
  const proven = factors.provenConversions > 0 || factors.provenClicks >= 25 || factors.availablePerformanceData;
  const valueSupportsPremium = factors.expectedOpportunityValueCents !== null &&
    (factors.estimatedProductionCostCents === null || factors.expectedOpportunityValueCents >= factors.estimatedProductionCostCents * 3);
  if (proven && valueSupportsPremium && (factors.visualComplexity === "high" || factors.storytellingComplexity === "high")) {
    return { provider:"faceless", mode:"FACELESS_MOTION_PRO", reason:"PROVEN_OPPORTUNITY_PREMIUM",
      explanation:"Vorhandene Performance und erwarteter Wert rechtfertigen Motion Pro für anspruchsvolleres Storytelling." };
  }
  if (factors.motionImportance !== "low" && factors.visualComplexity !== "low") {
    return { provider:"faceless", mode:"FACELESS_MOTION_LITE", reason:"STANDARD_AFFILIATE_MOTION",
      explanation:"Normales Affiliate-Reel mit mittleren visuellen Anforderungen und relevanter Bewegung." };
  }
  return { provider:"faceless", mode:"FACELESS_STORYBOARD", reason:"LOW_COST_EXPLORATION",
    explanation:"Günstiger Test einer noch nicht ausreichend bewiesenen Opportunity mit geringer visueller Komplexität." };
}

export function facelessModel(mode: RendererDecision["mode"]) {
  if (mode === "FACELESS_STORYBOARD") return "storyboard" as const;
  if (mode === "FACELESS_MOTION_LITE") return "motion_lite" as const;
  if (mode === "FACELESS_MOTION_PRO") return "motion_pro" as const;
  throw new Error("Runway besitzt kein Faceless-Modell.");
}

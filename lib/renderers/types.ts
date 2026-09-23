export type RendererMode = "FACELESS_STORYBOARD" | "FACELESS_MOTION_LITE" | "FACELESS_MOTION_PRO" | "RUNWAY";
export type RendererProvider = "faceless" | "runway";

export type ProductionFactors = {
  creativeType: string;
  visualComplexity: "low" | "medium" | "high";
  specificScenesRequired: boolean;
  motionImportance: "low" | "medium" | "high";
  productVisualImportance: "low" | "medium" | "high";
  storytellingComplexity: "low" | "medium" | "high";
  availablePerformanceData: boolean;
  expectedOpportunityValueCents: number | null;
  estimatedProductionCostCents: number | null;
  knownAffiliateCommission: string | null;
  provenClicks: number;
  provenConversions: number;
};

export type RendererDecision = {
  provider: RendererProvider;
  mode: RendererMode;
  reason: "BOOTSTRAP_STORYBOARD_TEST" | "LOW_COST_EXPLORATION" | "STANDARD_AFFILIATE_MOTION" | "PROVEN_OPPORTUNITY_PREMIUM" | "CUSTOM_SCENES_REQUIRED";
  explanation: string;
};

export interface VideoRenderer {
  readonly provider: RendererProvider;
  connection(): Promise<unknown>;
  models(): Promise<Array<{ value: string; name: string; credits: number }>>;
}

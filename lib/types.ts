export type WorkflowStatus = "draft" | "generated" | "approved" | "published";

export type Product = {
  name: string;
  sourceUrl: string;
  affiliateUrl: string;
  price: string;
  targetGroup: string;
  benefits: string;
  notes: string;
};

export type ReelConcept = {
  hook: string;
  scenes: Array<{ seconds: string; visual: string; voiceover: string; overlay: string }>;
  caption: string;
  hashtags: string[];
  cta: string;
  disclosure: string;
  checks: string[];
};

export type TrendCandidate = {
  name: string;
  category: string;
  kind: "Dauerläufer" | "Saisontrend" | "Aktueller Trend";
  season: string;
  whyNow: string;
  reelIdea: string;
  targetGroup: string;
  benefitsToVerify: string[];
  searchQuery: string;
  confidence: number;
  amazonUrl: string;
  affiliateUrl: string;
};

export type TrendReport = {
  summary: string;
  researchedAt: string;
  candidates: TrendCandidate[];
  sources: Array<{ title?: string; url: string }>;
};

export type ProductReview = {
  normalizedName: string;
  evidenceSummary: string;
  verifiedBenefits: string[];
  cautions: string[];
  targetGroup: string;
  reelAngle: string;
  confidence: number;
  approvalRecommendation: boolean;
  sources: Array<{ title?: string; url: string }>;
};

export type ProjectState = {
  product: Product;
  concept: ReelConcept | null;
  conceptProduct?: Product;
  status: WorkflowStatus;
  publishedUrl: string;
  clicks: number;
  sales: number;
  revenue: string;
  updatedAt: string;
};

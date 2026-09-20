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

export type ProjectState = {
  product: Product;
  concept: ReelConcept | null;
  status: WorkflowStatus;
  publishedUrl: string;
  clicks: number;
  sales: number;
  revenue: string;
  updatedAt: string;
};


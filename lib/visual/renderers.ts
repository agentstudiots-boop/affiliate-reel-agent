import type { ContentFormat } from "../formats/catalog";
import { emitEvent } from "../observability/events";
import { planCarousel, type CarouselPlan, type CarouselSource } from "./carousel/planner";
import { runImageJob } from "./image-job";
import type { JobLedger } from "./ledger";
import { imagePromptFromBrief, type StyleBrief } from "./style";
import { renderTextGraphic } from "./text-graphic";
import type { GeneratedAsset, ImageProvider, SlideResult } from "./types";
import { monthOf, remainingQuota, runVideoJob, type QuotaStore, type VideoProvider } from "./video";

// Renderers sit below the format router. Each one knows its format and talks only to provider interfaces.

export type ProductionCopy = {
  title: string; hook: string; problem: string; coreMessage: string; body: string; caption: string; cta: string;
  points: { headline: string; text: string }[];
  imageMotif: string;
  videoScript: string;
};
export type RenderInput = { contentId: string; copy: ProductionCopy; style: StyleBrief; slides?: number | null; dryRun: boolean; visualPotential: number };
export type RenderContext = { ledger: JobLedger; imageProvider: ImageProvider | null; sleep?: (ms: number) => Promise<void>; maxAttempts?: number;
  avatarProvider?: VideoProvider | null; standardVideoProvider?: VideoProvider | null; avatarQuota?: { store: QuotaStore; limit: number } | null;
  videoTiming?: { pollIntervalMs?: number; maxWaitMs?: number; stuckAfterMs?: number }; now?: () => Date;
  // Shared visual quality gate (lib/content/image-quality). Optional; a rejected or uncertain image is never used: the
  // single image degrades along the fallback chain, a carousel slide to a text graphic. It never triggers a new generation.
  imageQuality?: (asset: GeneratedAsset, motif: { motif: string; title: string }) => Promise<{ approved: boolean; reasons: string[] }> };
export type RenderOutcome = {
  status: "completed" | "degraded" | "failed" | "dry_run" | "in_progress";
  assets: { role: string; asset: GeneratedAsset }[];
  carousel?: CarouselPlan & { slideResults: SlideResult[] };
  video?: { script: string; provider: string | null; jobId: string | null };
  error?: string;
  notes: string[];
  wouldGenerateImages?: number;
  wouldUseAvatar?: boolean;
  wouldUseStandardVideo?: boolean;
};
export interface Renderer {
  readonly format: ContentFormat;
  available(context: RenderContext): { ok: boolean; reason?: string };
  render(input: RenderInput, context: RenderContext): Promise<RenderOutcome>;
}

export const textRenderer: Renderer = {
  format: "TEXT",
  available: () => ({ ok: true }),
  async render(input) {
    return { status: input.dryRun ? "dry_run" : "completed", assets: [], notes: ["Reiner Textbeitrag, kein Provider"] };
  },
};

const providerOk = (context: RenderContext) => context.imageProvider ? context.imageProvider.available() : { ok: false, reason: "kein Bildprovider" };

export const singleImageRenderer: Renderer = {
  format: "SINGLE_IMAGE",
  available: providerOk,
  async render(input, context) {
    const brief = { prompt: imagePromptFromBrief(input.style, input.copy.imageMotif), aspectRatio: "4:5" as const, styleKey: input.style.key };
    if (input.dryRun) return { status: "dry_run", assets: [], notes: [`Würde 1 Bild erzeugen (${context.imageProvider?.name ?? "kein Provider"})`], wouldGenerateImages: 1 };
    if (!context.imageProvider || !context.imageProvider.available().ok) return { status: "failed", assets: [], error: "image_provider_unavailable", notes: [] };
    const result = await runImageJob(brief, { contentId: input.contentId, role: "main-image", ledger: context.ledger, provider: context.imageProvider, sleep: context.sleep, maxAttempts: context.maxAttempts });
    if (!result.ok) return { status: "failed", assets: [], error: `image_${result.error}`, notes: [`Bild nicht erzeugt: ${result.error}`] };
    if (context.imageQuality) {
      const quality = await context.imageQuality(result.asset, { motif: input.copy.imageMotif, title: input.copy.title }).catch(() => ({ approved: false, reasons: ["Bildprüfung nicht möglich"] }));
      if (!quality.approved) return { status: "failed", assets: [], error: "image_quality_rejected", notes: [`Bild nicht verwendet: ${quality.reasons.join(" ").slice(0, 200)}`] };
    }
    return { status: "completed", assets: [{ role: "main-image", asset: result.asset }], notes: result.reused ? ["Vorhandenes Bild wiederverwendet"] : [] };
  },
};

export function carouselSourceFrom(input: RenderInput, context: RenderContext): CarouselSource {
  return { contentId: input.contentId, title: input.copy.title, hook: input.copy.hook, problem: input.copy.problem, coreMessage: input.copy.coreMessage, points: input.copy.points,
    cta: input.copy.cta, visualPotential: input.visualPotential, imageProviderAvailable: !!context.imageProvider && context.imageProvider.available().ok };
}

// Renders a planned carousel slide by slide. Only slides with requires_generated_image go to the provider; each has
// its own idempotency key, so a re-run reuses finished slides and retries only the failed ones. A slide whose
// picture finally fails is degraded to a text graphic instead of failing the carousel.
export async function renderCarouselPlan(plan: CarouselPlan, input: RenderInput, context: RenderContext, only?: number[]): Promise<RenderOutcome> {
  const results: SlideResult[] = [];
  const assets: { role: string; asset: GeneratedAsset }[] = [];
  const total = plan.slide_count;
  for (const slide of plan.slides) {
    const role = `slide-${slide.slide_number}`;
    if (only && !only.includes(slide.slide_number)) continue;
    if (input.dryRun) { results.push({ slide_number: slide.slide_number, status: "planned", asset: null }); continue; }
    emitEvent("carousel_slide_started", { contentId: plan.contentId, slide: slide.slide_number, generated: slide.requires_generated_image });
    const graphic = () => renderTextGraphic({ headline: slide.headline, text: slide.supporting_text, slide: { number: slide.slide_number, total }, style: plan.style, variant: slide.purpose === "cta" ? "cta" : "text" });
    if (!slide.requires_generated_image) {
      const asset = graphic();
      results.push({ slide_number: slide.slide_number, status: "succeeded", asset });
      assets.push({ role, asset });
      emitEvent("carousel_slide_completed", { contentId: plan.contentId, slide: slide.slide_number, kind: "text_graphic" });
      continue;
    }
    const result = context.imageProvider
      ? await runImageJob({ prompt: slide.visual_brief, aspectRatio: "4:5", styleKey: plan.style.key }, { contentId: plan.contentId, role, ledger: context.ledger, provider: context.imageProvider, sleep: context.sleep, maxAttempts: context.maxAttempts })
      : { ok: false as const, error: "image_provider_unavailable", retryable: false, attempts: 0, key: "" };
    const rejected = result.ok && context.imageQuality
      ? !(await context.imageQuality(result.asset, { motif: slide.visual_brief, title: slide.headline }).catch(() => ({ approved: false, reasons: [] }))).approved : false;
    if (result.ok && !rejected) {
      results.push({ slide_number: slide.slide_number, status: "succeeded", asset: result.asset, reused: result.reused });
      assets.push({ role, asset: result.asset });
      emitEvent("carousel_slide_completed", { contentId: plan.contentId, slide: slide.slide_number, kind: "generated_image", reused: result.reused });
    } else {
      const asset = graphic();
      results.push({ slide_number: slide.slide_number, status: "degraded", asset, error: result.ok ? "image_quality_rejected" : result.error });
      assets.push({ role, asset });
      emitEvent("carousel_slide_failed", { contentId: plan.contentId, slide: slide.slide_number, error: result.ok ? "image_quality_rejected" : result.error, degradedTo: "text_graphic" }, "warn");
    }
  }
  const degraded = results.filter(item => item.status === "degraded").length;
  const status = input.dryRun ? "dry_run" : degraded ? "degraded" : "completed";
  if (!input.dryRun) emitEvent("carousel_completed", { contentId: plan.contentId, slides: total, degraded, status });
  return { status, assets, carousel: { ...plan, slideResults: results }, notes: degraded ? [`${degraded} Slide(s) ohne generiertes Bild (Textgrafik als Ersatz)`] : [],
    wouldGenerateImages: input.dryRun ? plan.generated_images : undefined };
}

export const carouselRenderer: Renderer = {
  format: "CAROUSEL",
  available: () => ({ ok: true }), // text graphics always work; generated pictures are optional
  async render(input, context) {
    const plan = planCarousel(carouselSourceFrom(input, context), input.style, input.slides);
    const outcome = await renderCarouselPlan(plan, input, context);
    return input.dryRun ? { ...outcome, notes: [`${plan.slide_count} Slides geplant (${plan.count_reason}), ${plan.generated_images} davon mit generiertem Bild`] } : outcome;
  },
};

// Shared by AvatarVideoRenderer and StandardVideoRenderer; they differ only in provider and quota.
async function renderVideo(kind: "avatar" | "standard", input: RenderInput, context: RenderContext): Promise<RenderOutcome> {
  const provider = kind === "avatar" ? context.avatarProvider : context.standardVideoProvider;
  const label = kind === "avatar" ? "Avatar-Video" : "Video";
  if (input.dryRun) return { status: "dry_run", assets: [], notes: [`Würde ein ${label} über ${provider?.name ?? "—"} erzeugen`], wouldUseAvatar: kind === "avatar", wouldUseStandardVideo: kind === "standard",
    video: { script: input.copy.videoScript, provider: provider?.name ?? null, jobId: null } };
  if (!provider) return { status: "failed", assets: [], error: `${kind}_provider_unavailable`, notes: [] };
  const result = await runVideoJob({ contentId: input.contentId, role: kind === "avatar" ? "avatar-video" : "standard-video", title: input.copy.title, script: input.copy.videoScript,
    visualPrompt: imagePromptFromBrief(input.style, input.copy.imageMotif), aspect: "9:16" },
  { ledger: context.ledger, provider, quota: kind === "avatar" ? context.avatarQuota ?? null : null, sleep: context.sleep, now: context.now, ...context.videoTiming });
  if (result.state === "completed") return { status: "completed", assets: [{ role: "video", asset: result.asset }], video: { script: input.copy.videoScript, provider: provider.name, jobId: result.jobId }, notes: result.reused ? ["Vorhandenes Video wiederverwendet"] : [] };
  if (result.state === "in_progress") return { status: "in_progress", assets: [], video: { script: input.copy.videoScript, provider: provider.name, jobId: result.jobId }, notes: [`${label} wird noch erzeugt; wird beim nächsten Lauf fortgesetzt, nicht neu gestartet`] };
  return { status: "failed", assets: [], error: `${kind === "avatar" ? "heygen" : "video"}_${result.category}`, notes: [] };
}

export const avatarVideoRenderer: Renderer = {
  format: "AVATAR_VIDEO",
  available(context) {
    if (!context.avatarProvider) return { ok: false, reason: "kein Avatar-Provider" };
    const status = context.avatarProvider.available();
    if (!status.ok) return status;
    if (!context.avatarQuota) return { ok: false, reason: "Avatar-Kontingent nicht konfiguriert" };
    return { ok: true };
  },
  render: (input, context) => renderVideo("avatar", input, context),
};

export const standardVideoRenderer: Renderer = {
  format: "STANDARD_VIDEO",
  available: context => context.standardVideoProvider ? context.standardVideoProvider.available() : { ok: false, reason: "kein Video-Provider" },
  render: (input, context) => renderVideo("standard", input, context),
};

export async function avatarQuotaRemaining(quota: { store: QuotaStore; limit: number }, provider: string, now = new Date()) {
  return remainingQuota(quota.limit, await quota.store.usage(provider, monthOf(now)));
}

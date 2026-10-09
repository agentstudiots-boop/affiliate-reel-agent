import { FALLBACK_CHAIN, type ContentFormat } from "../formats/catalog";
import { emitEvent } from "../observability/events";
import { avatarVideoRenderer, carouselRenderer, singleImageRenderer, standardVideoRenderer, textRenderer, type RenderContext, type RenderInput, type Renderer } from "./renderers";
import type { ProductionResult } from "./types";

// Visual Content Engine: executes the router's decision. It does not choose topics or publish.
// If a renderer is unavailable or fails, it degrades along FALLBACK_CHAIN (never to a more expensive format and
// never to an excluded one). TEXT needs no provider, so production always ends with a usable result.

export const DEFAULT_RENDERERS: Renderer[] = [textRenderer, singleImageRenderer, carouselRenderer, standardVideoRenderer, avatarVideoRenderer];

export async function produceContent(request: RenderInput & { format: ContentFormat; exclude?: ContentFormat[] },
  context: RenderContext & { renderers?: Renderer[] }): Promise<ProductionResult> {
  const renderers = new Map((context.renderers ?? DEFAULT_RENDERERS).map(renderer => [renderer.format, renderer]));
  const chain = [request.format, ...FALLBACK_CHAIN[request.format]].filter(format => format === request.format || !request.exclude?.includes(format));
  const fallbacks: ProductionResult["fallbacks"] = [];
  const errors: string[] = [];
  for (const format of chain) {
    const renderer = renderers.get(format);
    const next = chain[chain.indexOf(format) + 1];
    if (!renderer) { if (next) fallbacks.push({ from: format, to: next, reason: "kein Renderer für dieses Format" }); continue; }
    const availability = renderer.available(context);
    if (!availability.ok) {
      errors.push(`${format}: ${availability.reason ?? "nicht verfügbar"}`);
      if (next) { fallbacks.push({ from: format, to: next, reason: availability.reason ?? "nicht verfügbar" }); emitEvent("production_fallback", { contentId: request.contentId, from: format, to: next, reason: availability.reason }, "warn"); }
      continue;
    }
    let outcome;
    try { outcome = await renderer.render(request, context); }
    catch (error) { outcome = { status: "failed" as const, assets: [], notes: [], error: error instanceof Error ? error.name : "renderer_error" }; }
    if (outcome.status === "failed") {
      errors.push(`${format}: ${outcome.error ?? "fehlgeschlagen"}`);
      if (next) { fallbacks.push({ from: format, to: next, reason: outcome.error ?? "fehlgeschlagen" }); emitEvent("production_fallback", { contentId: request.contentId, from: format, to: next, reason: outcome.error }, "warn"); }
      continue;
    }
    // A started video job is not a failure: it is resumed later with the same provider job id.
    const status = request.dryRun ? "dry_run" : outcome.status === "in_progress" ? "in_progress" : outcome.status === "degraded" || fallbacks.length ? "degraded" : "completed";
    const result: ProductionResult = { contentId: request.contentId, requestedFormat: request.format, producedFormat: format, status, assets: outcome.assets,
      carousel: outcome.carousel, video: outcome.video, fallbacks, errors,
      dryRun: request.dryRun ? { wouldGenerateImages: outcome.wouldGenerateImages ?? 0, wouldUseAvatar: !!outcome.wouldUseAvatar, wouldUseStandardVideo: !!outcome.wouldUseStandardVideo, notes: outcome.notes } : null };
    emitEvent("production_completed", { contentId: request.contentId, requested: request.format, produced: format, status, fallbacks: fallbacks.length });
    return result;
  }
  // Only reachable if TEXT itself was excluded and everything else failed.
  emitEvent("production_completed", { contentId: request.contentId, requested: request.format, produced: null, status: "failed" }, "error");
  return { contentId: request.contentId, requestedFormat: request.format, producedFormat: request.format, status: "failed", assets: [], fallbacks, errors, dryRun: null };
}

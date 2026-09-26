import { productionRepository, ProductionConflictError } from "./repository";
import { facelessClient, facelessVisualDirection, FacelessError } from "./faceless-so";
import { runwayStoryClient } from "./runway-story";

// UI and automatic continuation use the same persistent one-attempt gates.
export async function advanceVideo(jobId: string, action: "startVideo" | "pollVideo",
  repo = productionRepository(), provider = facelessClient()) {
  const run = await repo.getByJobId(jobId);
  if (run?.providerMode === "RUNWAY_SINGLE_CLIP") {
    const runway = runwayStoryClient();
    if (action === "startVideo") {
      if (run.status !== "approved_for_spend") throw new ProductionConflictError("Runway-Kostenfreigabe fehlt.");
      const quote = await runway.quote();
      if (quote.balance < quote.credits) throw new ProductionConflictError("Runway-Guthaben reicht für 30 Sekunden nicht aus.");
      const claimed = await repo.claimRunwayCreation(jobId, quote.credits);
      // A transport error after this POST is ambiguous; never create another task automatically.
      const created = await runway.create(claimed.job,claimed.imageUrl);
      return { run: await repo.bindProviderJob(claimed.run.id,created.id) };
    }
    if (run.status !== "rendering" || !run.providerJobId) throw new ProductionConflictError("Runway-Auftrag unklar; keinen zweiten kostenpflichtigen Auftrag starten.");
    const task = await runway.status(run.providerJobId);
    if (task.status === "FAILED" || task.status === "CANCELLED") { await repo.markFailed(run.id); return {stage:"failed",errors:["Runway konnte das Video nicht fertigstellen."]}; }
    if (task.status !== "SUCCEEDED") return {stage:task.status.toLowerCase()};
    if (!task.output[0]) throw new ProductionConflictError("Runway meldet Erfolg ohne MP4. Anbieterstatus prüfen.");
    // Archive the temporary provider URL before Instagram receives a permanent asset.
    const outputUrl = await runway.archive(run.providerJobId,task.output[0]);
    return {stage:"ready",run:await repo.markReady(run.id,outputUrl)};
  }
  if (!run || run.providerMode !== "FACELESS_STORYBOARD") throw new ProductionConflictError("Vorbereiteter Faceless-Lauf fehlt.");
  if (action === "startVideo") {
    if (run.status !== "approved_for_spend") throw new ProductionConflictError("Keine gespeicherte WhatsApp-Freigabe für diesen Videostart.");
    const quote = await provider.quote();
    if (quote.balance < quote.credits) throw new ProductionConflictError("Faceless.so-Credits reichen nicht aus.");
    const job = await repo.approvedJob(jobId);
    const claimed = await repo.claimPaidCreation(jobId, quote.credits);
    // This POST charges credits. Never retry automatically, even with the same idempotency key.
    const created = await provider.create(claimed.script, claimed.voiceId, `Affiliate Reel ${jobId}`, claimed.key, facelessVisualDirection(job));
    // Preserve a confirmed paid job before reporting a cost discrepancy so
    // it remains observable without ever buying a replacement.
    const boundRun = await repo.bindProviderJob(claimed.run.id, created.id);
    if (created.creditsUsed !== undefined && created.creditsUsed > quote.credits) {
      console.warn(JSON.stringify({ event: "faceless_credit_mismatch", jobId: jobId, quotedCredits: quote.credits, reportedCredits: created.creditsUsed }));
      throw new FacelessError("Provider meldet höhere Kosten. Provider-Auftrag gespeichert; Status neu laden und Kosten manuell prüfen. Kein neuer Videostart.");
    }
    return { run: boundRun };
  }
  if (run.status !== "rendering" || !run.providerJobId) throw new ProductionConflictError("Provider-ID fehlt oder kein aktiver Videolauf. Bei unklarem Start manuell abgleichen.");
  const progress = await repo.providerProgress(jobId);
  if (progress?.renderId) {
    const rendering = await provider.renderStatus(progress.renderId);
    if (rendering.status === "error") { await repo.markFailed(run.id); return { stage: "failed" }; }
    if (rendering.status === "done" && rendering.url) return { stage: "ready", run: await repo.markReady(run.id, rendering.url) };
    return { stage: "rendering" };
  }
  // A prior render request with no renderId is ambiguous. Reconcile via the free video read.
  if (progress?.renderAttempted) {
    const video = await provider.video(run.providerJobId);
    if (video.renderedVideoUrl) return { stage: "ready", run: await repo.markReady(run.id, video.renderedVideoUrl) };
    throw new ProductionConflictError("MP4-Render-Ergebnis unklar. Keine zweite Render-Anforderung senden.");
  }
  const generation = await provider.videoStatus(run.providerJobId);
  if (generation.status === "failed") { await repo.markFailed(run.id); return { stage: "failed", errors: generation.errorMessages || [] }; }
  if (generation.renderedVideoUrl) return { stage: "ready", run: await repo.markReady(run.id, generation.renderedVideoUrl) };
  if (generation.status !== "completed") return { stage: generation.status };
  const claim = await repo.claimFreeRender(run.id);
  const rendered = await provider.render(run.providerJobId, claim.key);
  return { stage: "rendering", run: await repo.bindRender(run.id, rendered.renderId) };
}

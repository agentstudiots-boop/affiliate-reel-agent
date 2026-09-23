import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { chooseVideoProvider } from "@/lib/production/policy";
import { ProductionConflictError, productionRepository } from "@/lib/production/repository";
import { facelessClient, FacelessError, narration } from "@/lib/production/faceless-so";
import { sendWhatsAppText, whatsappApprovalReady, whatsappConfig } from "@/lib/whatsapp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres ist noch nicht eingerichtet." }, { status: 503 });
}

function publicConfiguration() {
  return {
    facelessApiKeyConfigured: !!process.env.FACELESS_API_KEY,
    facelessApiContractVerified: true,
    whatsapp: whatsappConfig(),
    whatsappApprovalReady: whatsappApprovalReady(),
    spendLocked: true,
  };
}

export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const jobId = z.string().uuid().parse(new URL(request.url).searchParams.get("jobId"));
    const repo = productionRepository();
    const [run, approval, successfulVideos] = await Promise.all([
      repo.getByJobId(jobId),
      repo.latestApproval(jobId),
      repo.successfulVideoCount(),
    ]);
    return Response.json({
      run,
      approval,
      learningPolicy: chooseVideoProvider(successfulVideos),
      configuration: publicConfiguration(),
      progress: run?.status === "rendering" ? await repo.providerProgress(jobId) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Ungültige Job-ID." : "Produktionsstatus konnte nicht geladen werden." },
      { status: error instanceof z.ZodError ? 400 : 503 });
  }
}

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepareVideo"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("quoteVideo"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("requestApproval"), jobId: z.string().uuid(), voiceId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("startVideo"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("pollVideo"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("reviseContent"), jobId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return Response.json({ error: "Eingabe zu groß." }, { status: 413 });
    const input = mutation.parse(JSON.parse(raw));
    const repo = productionRepository();
    if (input.action === "prepareVideo") {
      const prepared = await repo.prepareVideo(input.jobId);
      return Response.json({ ...prepared, configuration: publicConfiguration() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "reviseContent") return Response.json({ job: await repo.reviseRequestedVideo(input.jobId) }, { headers: { "Cache-Control": "no-store" } });
    const run = await repo.getByJobId(input.jobId);
    if (!run || run.providerMode !== "FACELESS_STORYBOARD") throw new ProductionConflictError("Nur vorbereitete Faceless Storyboard-Läufe werden unterstützt.");
    const provider = facelessClient();
    if (input.action === "quoteVideo") {
      if (!["needs_provider_quote", "changes_requested"].includes(run.status)) throw new ProductionConflictError("Quote nur vor einer neuen Freigabe abrufen.");
      const job = await repo.approvedJob(input.jobId);
      return Response.json({ quote: await provider.quote(), script: narration(job) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "requestApproval") {
      if (!whatsappApprovalReady()) throw new ProductionConflictError("WhatsApp-Zugang, Verify-Token, App-Secret und Approver müssen zuerst konfiguriert werden.");
      const job = await repo.approvedJob(input.jobId);
      const quote = await provider.quote();
      if (quote.balance < quote.credits) throw new ProductionConflictError("Faceless.so-Credits reichen für diesen Auftrag nicht aus.");
      if (!quote.voices.some(voice => voice.id === input.voiceId)) throw new ProductionConflictError("Stimme ist nicht im aktuellen deutschen Faceless.so-Katalog.");
      const product = job.opportunity.product.name;
      const summary = `Produkt: ${product}\nContent-Typ: Video\nProvider: Faceless.so Storyboard\nGeschätzte Kosten: ${quote.credits} Provider-Credits (EUR-Betrag unbekannt)\nErwartete Affiliate-Provision: unbekannt\nSprechtext:\n${narration(job)}`.slice(0, 3000);
      const approval = await repo.createRenderApproval({ jobId: input.jobId, estimatedCostCents: null, estimatedProviderCredits: quote.credits, estimatedCommissionCents: null, summary, approverWaId: process.env.WHATSAPP_APPROVER_WA_ID!.replace(/\D/g, ""), script: narration(job), voiceId: input.voiceId });
      // Claim before the outbound request: an ambiguous network result must not send a second approval.
      await repo.claimWhatsAppSend(approval.id);
      const messageId = await sendWhatsAppText(`${summary}\n\nAntworte auf diese Nachricht mit „Freigeben“ oder „OK, freigeben“ für genau einen kostenpflichtigen Videostart. „Ablehnen“ stoppt ihn; Änderungswünsche bitte als Text senden.`);
      await repo.bindApprovalMessage(approval.id, messageId);
      return Response.json({ approvalSent: true, approvalId: approval.id }, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "startVideo") {
      if (run.status !== "approved_for_spend") throw new ProductionConflictError("Keine gespeicherte WhatsApp-Freigabe für diesen Videostart.");
      const quote = await provider.quote();
      if (quote.balance < quote.credits) throw new ProductionConflictError("Faceless.so-Credits reichen nicht aus.");
      const claimed = await repo.claimPaidCreation(input.jobId, quote.credits);
      // This POST charges credits. Never retry automatically, even with the same idempotency key.
      const created = await provider.create(claimed.script, claimed.voiceId, `Affiliate Reel ${input.jobId}`, claimed.key);
      if (created.creditsUsed !== undefined && created.creditsUsed > quote.credits) throw new FacelessError("Provider meldet höhere Kosten. Auftrag manuell prüfen.");
      return Response.json({ run: await repo.bindProviderJob(claimed.run.id, created.id) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (run.status !== "rendering" || !run.providerJobId) throw new ProductionConflictError("Provider-ID fehlt oder kein aktiver Videolauf. Bei unklarem Start manuell abgleichen.");
    const progress = await repo.providerProgress(input.jobId);
    if (progress?.renderId) {
      const rendering = await provider.renderStatus(progress.renderId);
      if (rendering.status === "error") { await repo.markFailed(run.id); return Response.json({ stage: "failed" }); }
      if (rendering.status === "done" && rendering.url) return Response.json({ stage: "ready", run: await repo.markReady(run.id, rendering.url) });
      return Response.json({ stage: "rendering" });
    }
    // A prior render request with no renderId is ambiguous. Reconcile via the free video read.
    if (progress?.renderAttempted) {
      const video = await provider.video(run.providerJobId);
      if (video.renderedVideoUrl) return Response.json({ stage: "ready", run: await repo.markReady(run.id, video.renderedVideoUrl) });
      throw new ProductionConflictError("MP4-Render-Ergebnis unklar. Keine zweite Render-Anforderung senden.");
    }
    const generation = await provider.videoStatus(run.providerJobId);
    if (generation.status === "failed") { await repo.markFailed(run.id); return Response.json({ stage: "failed", errors: generation.errorMessages || [] }); }
    if (generation.renderedVideoUrl) return Response.json({ stage: "ready", run: await repo.markReady(run.id, generation.renderedVideoUrl) });
    if (generation.status !== "completed") return Response.json({ stage: generation.status });
    const claim = await repo.claimFreeRender(run.id);
    const rendered = await provider.render(run.providerJobId, claim.key);
    return Response.json({ stage: "rendering", run: await repo.bindRender(run.id, rendered.renderId) });
  } catch (error) {
    return Response.json({
      error: error instanceof z.ZodError ? "Ungültige Produktionsanfrage."
        : error instanceof ProductionConflictError || error instanceof FacelessError ? error.message
        : "Provider-Ergebnis unklar. Keine kostenpflichtige Aktion automatisch wiederholen; Status manuell abgleichen.",
    }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error instanceof ProductionConflictError ? 409 : 503 });
  }
}

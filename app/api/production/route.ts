import { advanceVideo } from "@/lib/production/advance";
import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { chooseVideoProvider } from "@/lib/production/policy";
import { ProductionConflictError, productionRepository } from "@/lib/production/repository";
import { facelessClient, facelessVisualDirection, FacelessError, narration } from "@/lib/production/faceless-so";
import { sendWhatsAppText, whatsappApprovalReady, whatsappConfig } from "@/lib/whatsapp/client";
import { requestContentApproval } from "@/lib/whatsapp/content-approval";
import { runwayStoryClient, runwayPrompt } from "@/lib/production/runway-story";
import { productionProviderSchema } from "@/lib/production/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres ist noch nicht eingerichtet." }, { status: 503 });
}

function publicConfiguration() {
  return {
    facelessApiKeyConfigured: !!process.env.FACELESS_API_KEY,
    runwayApiKeyConfigured: !!process.env.RUNWAYML_API_SECRET,
    facelessApiContractVerified: true,
    whatsapp: whatsappConfig(),
    whatsappApprovalReady: whatsappApprovalReady(),
    spendLocked: true,
  };
}

export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const jobId = z.string().uuid().parse(params.get("jobId"));
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
      providerDiagnostics: params.get("diagnostics") === "1" && run?.status === "failed" && run.providerMode === "FACELESS_STORYBOARD" && run.providerJobId
        ? await facelessClient().videoStatus(run.providerJobId) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Ungültige Job-ID." : "Produktionsstatus konnte nicht geladen werden." },
      { status: error instanceof z.ZodError ? 400 : 503 });
  }
}

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepareVideo"), jobId: z.string().uuid(), provider: productionProviderSchema.optional() }),
  z.object({ action: z.literal("quoteVideo"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("requestApproval"), jobId: z.string().uuid(), voiceId: z.string().max(200).optional(), imageUrl: z.string().url().max(1000).optional(), rightsConfirmed: z.boolean().optional() }),
  z.object({ action: z.literal("startVideo"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("pollVideo"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("reviseContent"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("requestRevision"), jobId: z.string().uuid(), feedback: z.string().trim().min(5).max(1200) }),
]);

export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return Response.json({ error: "Eingabe zu groß." }, { status: 413 });
    const input = mutation.parse(JSON.parse(raw));
    const repo = productionRepository();
    if (input.action === "prepareVideo") {
      const prepared = await repo.prepareVideo(input.jobId,input.provider ?? "runway");
      return Response.json({ ...prepared, configuration: publicConfiguration() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "reviseContent") {
      const job=await repo.reviseRequestedVideo(input.jobId);
      try { await requestContentApproval(job.id); } catch { /* Saved plan remains reviewable in the studio. */ }
      return Response.json({job},{headers:{"Cache-Control":"no-store"}});
    }
    if (input.action === "requestRevision") {
      await repo.requestVideoRevision(input.jobId, input.feedback);
      const job=await repo.reviseRequestedVideo(input.jobId);
      try { await requestContentApproval(job.id); } catch { /* Saved plan remains reviewable in the studio. */ }
      return Response.json({job},{headers:{"Cache-Control":"no-store"}});
    }
    const run = await repo.getByJobId(input.jobId);
    if (!run) throw new ProductionConflictError("Produktionslauf fehlt.");
    if (run.providerMode === "RUNWAY_SINGLE_CLIP") {
      if (input.action === "quoteVideo") {
        if (run.status !== "needs_provider_quote") throw new ProductionConflictError("Quote nur vor WhatsApp-Freigabe abrufen.");
        const job = await repo.approvedJob(input.jobId);
        if (job.content?.format !== "video" || job.content.durationSeconds !== 30) throw new ProductionConflictError("Zuerst einen 30-Sekunden-Content-Plan freigeben.");
        return Response.json({quote:await runwayStoryClient().quote(),script:runwayPrompt(job)},{headers:{"Cache-Control":"no-store"}});
      }
      if (input.action === "requestApproval") {
        if (!whatsappApprovalReady()) throw new ProductionConflictError("WhatsApp-Freigabe ist noch nicht eingerichtet.");
        const job=await repo.approvedJob(input.jobId);
        const quote=await runwayStoryClient().quote();
        const imageUrl=input.imageUrl || "";
        const script=job.content?.format === "video" ? job.content.scenes.map(scene=>scene.audio.trim()).join("\n\n") : "";
        const summary=`Produkt: ${job.opportunity.product.name}\nASIN: ${job.opportunity.product.asin}\nContent-Typ: 30-Sekunden-Video\nProvider: Runway WAN 3 (720p, Audio)\nGeschätzte Kosten: ${quote.credits} Runway-Credits (ca. $${quote.estimatedUsd.toFixed(2)} vor Steuern; EUR-Betrag unbekannt)\nAktuelles Runway-Guthaben: ${quote.balance} Credits\nBild mit bestätigten Nutzungsrechten: ${imageUrl}\nErwartete Affiliate-Provision: unbekannt\nSprechtext und Szenen:\n${runwayPrompt(job)}`.slice(0,3000);
        const approval=await repo.createRunwayApproval({jobId:input.jobId,credits:quote.credits,balance:quote.balance,imageUrl,rightsConfirmed:input.rightsConfirmed===true,approverWaId:process.env.WHATSAPP_APPROVER_WA_ID!.replace(/\D/g,""),summary,script});
        await repo.claimWhatsAppSend(approval.id);
        const messageId=await sendWhatsAppText(`${summary}\n\nAntworte auf DIESE Nachricht mit „Freigeben“ für genau einen kostenpflichtigen Runway-Videostart. „Ablehnen“ stoppt ihn; Änderungen bitte als Text senden.`);
        await repo.bindApprovalMessage(approval.id,messageId);
        return Response.json({approvalSent:true,approvalId:approval.id},{headers:{"Cache-Control":"no-store"}});
      }
      return Response.json(await advanceVideo(input.jobId,input.action,repo),{headers:{"Cache-Control":"no-store"}});
    }
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
      if (!input.voiceId || !quote.voices.some(voice => voice.id === input.voiceId)) throw new ProductionConflictError("Stimme ist nicht im aktuellen deutschen Faceless.so-Katalog.");
      const product = job.opportunity.product.name;
      const visual = facelessVisualDirection(job);
      const summary = `Produkt: ${product}\nContent-Typ: Video\nProvider: Faceless.so Storyboard\nGeschätzte Kosten: ${quote.credits} Provider-Credits (EUR-Betrag unbekannt)\nErwartete Affiliate-Provision: unbekannt\nSprechtext:\n${narration(job)}${visual ? `\n\nBildvorgabe:\n${visual.masterStyle}\nAusschlüsse: ${visual.globalNegativePrompt}` : ""}`.slice(0, 3000);
      const approval = await repo.createRenderApproval({ jobId: input.jobId, estimatedCostCents: null, estimatedProviderCredits: quote.credits, estimatedCommissionCents: null, summary, approverWaId: process.env.WHATSAPP_APPROVER_WA_ID!.replace(/\D/g, ""), script: narration(job), voiceId: input.voiceId });
      // Claim before the outbound request: an ambiguous network result must not send a second approval.
      await repo.claimWhatsAppSend(approval.id);
      const messageId = await sendWhatsAppText(`${summary}\n\nAntworte auf diese Nachricht mit „Freigeben“ oder „OK, freigeben“ für genau einen kostenpflichtigen Videostart. „Ablehnen“ stoppt ihn; Änderungswünsche bitte als Text senden.`);
      await repo.bindApprovalMessage(approval.id, messageId);
      return Response.json({ approvalSent: true, approvalId: approval.id }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await advanceVideo(input.jobId, input.action, repo, provider), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      error: error instanceof z.ZodError ? "Ungültige Produktionsanfrage."
        : error instanceof ProductionConflictError || error instanceof FacelessError ? error.message
        : "Provider-Ergebnis unklar. Keine kostenpflichtige Aktion automatisch wiederholen; Status manuell abgleichen.",
    }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error instanceof ProductionConflictError ? 409 : 503 });
  }
}

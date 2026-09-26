import { advanceVideo } from "@/lib/production/advance";
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
      providerDiagnostics: params.get("diagnostics") === "1" && run?.status === "failed" && run.providerJobId
        ? await facelessClient().videoStatus(run.providerJobId) : null,
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
    return Response.json(await advanceVideo(input.jobId, input.action, repo, provider), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      error: error instanceof z.ZodError ? "Ungültige Produktionsanfrage."
        : error instanceof ProductionConflictError || error instanceof FacelessError ? error.message
        : "Provider-Ergebnis unklar. Keine kostenpflichtige Aktion automatisch wiederholen; Status manuell abgleichen.",
    }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error instanceof ProductionConflictError ? 409 : 503 });
  }
}

import { productionRepository, ProductionConflictError } from "./repository";
import { runwayStoryClient, runwayPrompt } from "./runway-story";
import { facelessClient, facelessVisualDirection, narration } from "./faceless-so";
import { sendWhatsAppText, whatsappApprovalReady } from "../whatsapp/client";

async function sendPendingCostApproval(jobId:string, repo:ReturnType<typeof productionRepository>) {
  const approval=await repo.latestApproval(jobId);
  if (!approval || approval.status !== "pending") throw new ProductionConflictError("Kostenangebot für diesen Auftrag fehlt.");
  if (approval.whatsappMessageId) return {status:"awaiting_whatsapp_approval",approvalSent:true};
  // A recorded send attempt is ambiguous. Never send a second message.
  await repo.claimWhatsAppSend(approval.id);
  const messageId=await sendWhatsAppText(`${approval.summary}\n\nAntworte auf DIESE Nachricht mit „Freigabe“ für genau einen kostenpflichtigen Videostart oder „Ablehnen“. Änderungswünsche bitte als Text senden.`);
  await repo.bindApprovalMessage(approval.id,messageId);
  return {status:"awaiting_whatsapp_approval",approvalSent:true};
}

// A content approval starts the quote workflow without a Content Studio click.
// Provider POSTs remain behind the exact, separate WhatsApp cost approval.
export async function requestVideoCostApproval(jobId: string) {
  if (!whatsappApprovalReady()) throw new ProductionConflictError("WhatsApp ist für die Kostenfreigabe nicht vollständig eingerichtet.");
  const repo = productionRepository();
  let run = await repo.getByJobId(jobId);
  if (!run) {
    const provider = process.env.RUNWAYML_API_SECRET ? "runway" : process.env.FACELESS_API_KEY ? "faceless_video" : null;
    if (!provider) throw new ProductionConflictError("Weder Runway noch Faceless ist für die Videoproduktion eingerichtet.");
    run = (await repo.prepareVideo(jobId,provider)).run;
  }
  if (run.status === "awaiting_whatsapp_approval") return sendPendingCostApproval(jobId,repo);
  if (run.status !== "needs_provider_quote") return {status:run.status};
  const job=await repo.approvedJob(jobId);
  const approver=process.env.WHATSAPP_APPROVER_WA_ID!.replace(/\D/g,"");
  if(run.providerMode === "RUNWAY_SINGLE_CLIP") {
    const quote=await runwayStoryClient().quote();
    if(quote.balance<quote.credits)throw new ProductionConflictError("Runway-Guthaben für 30 Sekunden reicht nicht aus.");
    const script=job.content!.format==="video"?job.content!.scenes.map(scene=>scene.audio.trim()).join("\n\n"):"";
    const summary=`Produkt: ${job.opportunity.product.name}\nASIN: ${job.opportunity.product.asin}\nProvider: Runway WAN 3, 30 Sekunden, ohne Startbild\nGeschätzte Kosten: ${quote.credits} Credits (ca. $${quote.estimatedUsd.toFixed(2)} vor Steuern; EUR unbekannt)\nAktuelles Guthaben: ${quote.balance} Credits\nAffiliate-Provision: unbekannt\n\nSzenen und Stimme laut freigegebenem Plan:\n${runwayPrompt(job)}`.slice(0,3000);
    await repo.createRunwayApproval({jobId,credits:quote.credits,balance:quote.balance,imageUrl:"",rightsConfirmed:false,approverWaId:approver,summary,script});
  } else {
    const provider=facelessClient();
    const quote=await provider.quote();
    if(quote.balance<quote.credits)throw new ProductionConflictError("Faceless-Guthaben reicht für das Video nicht aus.");
    const voice=quote.voices[0];
    if(!voice)throw new ProductionConflictError("Keine deutsche Faceless-Stimme verfügbar.");
    const visual=facelessVisualDirection(job);
    const summary=`Produkt: ${job.opportunity.product.name}\nASIN: ${job.opportunity.product.asin}\nProvider: Faceless.so Storyboard\nGeschätzte Kosten: ${quote.credits} Credits (EUR unbekannt)\nStimme: ${voice.name}\nAffiliate-Provision: unbekannt\nHinweis: Frühere Kürbis-Versuche erzeugten kein brauchbares Bildmaterial; ein neuer Versuch kann ebenfalls scheitern.\n\nSprechtext:\n${narration(job)}${visual?`\n\nBildvorgabe: ${visual.masterStyle}`:""}`.slice(0,3000);
    await repo.createRenderApproval({jobId,estimatedCostCents:null,estimatedProviderCredits:quote.credits,estimatedCommissionCents:null,summary,approverWaId:approver,script:narration(job),voiceId:voice.id});
  }
  return sendPendingCostApproval(jobId,repo);
}

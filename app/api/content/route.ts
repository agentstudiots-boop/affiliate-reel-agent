import { resolveAmazonProduct, reuseRecentProductIdentity } from "@/lib/product-resolver";
import { z } from "zod";
import { opportunitySchema } from "@/lib/content/schema";
import { runContentJob } from "@/lib/orchestrator";
import { databaseConfigured, getDatabase } from "@/lib/memory/db";
import { authorized } from "@/lib/memory/auth";
import { ConflictError, memoryRepository } from "@/lib/memory/repository";
import { requestContentApproval } from "@/lib/whatsapp/content-approval";
import { loadApprovedEditorialCorrections } from "@/lib/whatsapp/language-memory";
export const runtime = "nodejs";
export const maxDuration = 300;
const requestSchema = z.object({ requestId: z.string().uuid(), opportunity: opportunitySchema, mode: z.enum(["reference","ai"]).default("reference"), formatPreference: z.enum(["automatic","video"]).default("automatic") });
export function GET() {
  return Response.json({ databaseConfigured: databaseConfigured(), planningMode: process.env.REPLICATE_API_TOKEN?.trim()?"reference_or_ai":"reference", researchProvider: "tavily", maxAutomaticRevisions: 2, operatorRevisions: "until_approval", maxModelCalls: process.env.REPLICATE_API_TOKEN?.trim()?8:0 }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode für den zentralen Speicher erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres ist noch nicht eingerichtet. Keine Planung gestartet." }, { status: 503 });
  let input: z.infer<typeof requestSchema>;
  try {
    if (Number(request.headers.get("content-length") || 0) > 24000) return Response.json({ error: "Briefing zu groß." }, { status: 413 });
    const raw = await request.text();
    if (raw.length > 24000) return Response.json({ error: "Briefing zu groß." }, { status: 413 });
    input = requestSchema.parse(JSON.parse(raw));
    if (input.formatPreference === "video" && input.opportunity.targetPlatform !== "instagram") {
      return Response.json({ error: "Ein gezielter Reel-Test braucht die Zielplattform Instagram." }, { status: 400 });
    }
  } catch { return Response.json({ error: "Bitte Produkt, Link, Zielgruppe und konkreten Use Case vollständig eintragen." }, { status: 400 }); }
  try { input.opportunity.product = await resolveAmazonProduct(input.opportunity.product); }
  catch {
    try { input.opportunity.product = await reuseRecentProductIdentity(input.opportunity.product,getDatabase()); }
    catch {
      // Persist a blocked job through the existing job identity and event stream.
      input.opportunity.product.productVerifiedAt = undefined;
      input.opportunity.product.productVerifiedName = undefined;
      input.opportunity.product.affiliateUrl = "";
    }
  }
  const repo = memoryRepository();
  let corrections;
  try { corrections=await loadApprovedEditorialCorrections(getDatabase(),(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,""),input.opportunity); }
  catch { return Response.json({error:"Bestätigte Korrekturen konnten nicht geladen werden. Keine Planung gestartet."},{status:503}); }
  const mode=(input.mode==="ai" || (corrections.length>0 && !!process.env.REPLICATE_API_TOKEN?.trim()))?"ai" as const:"reference" as const;
  if(mode==="ai" && !process.env.REPLICATE_API_TOKEN?.trim())return Response.json({error:"Replicate-Zugang für KI-Planung fehlt."},{status:503});
  try { await repo.claim(input.requestId,input.opportunity,mode); }
  catch (error) { return Response.json({ error: error instanceof ConflictError ? error.message : "Postgres ist nicht erreichbar oder die Migration fehlt. Kein Modellaufruf gestartet." }, { status: error instanceof ConflictError ? 409 : 503 }); }
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const planned=await runContentJob(input.opportunity, { id: input.requestId, mode, signal, ...(input.formatPreference === "video" ? { allowedFormats: ["video" as const] } : {}), async loadCorrections() {
          return corrections;
        }, async loadLearning(opportunity) {
          try { return await repo.learn(opportunity); } catch { throw new Error("Historischer Datenbankvergleich nicht verfügbar. Planung gestoppt."); }
        }, async onUpdate(job) {
          // Database commit precedes UI delivery. A lost browser connection cannot erase saved work.
          try { await repo.save(job); } catch { throw new Error("Postgres-Speicherung fehlgeschlagen. Planung gestoppt."); }
          if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(job)+"\n"));
        } });
        if(planned.status==="awaiting_approval" && !signal.aborted) {
          try { await requestContentApproval(planned.id); }
          catch(error) { console.info(JSON.stringify({event:"content_approval_pending_manual_send",jobId:planned.id,reason:error instanceof Error?error.message:"unavailable"})); }
        }
        if (!signal.aborted) controller.close();
      } catch { if (!signal.aborted) controller.error(new Error("Speicherung oder Planung unterbrochen. Gespeicherten Verlauf neu laden; kein automatischer Neustart.")); }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

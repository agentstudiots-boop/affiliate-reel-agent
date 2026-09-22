import { z } from "zod";
import { opportunitySchema } from "@/lib/content/schema";
import { runContentJob } from "@/lib/orchestrator";
import { databaseConfigured } from "@/lib/memory/db";
import { authorized } from "@/lib/memory/auth";
import { ConflictError, memoryRepository } from "@/lib/memory/repository";
export const runtime = "nodejs";
export const maxDuration = 300;
const requestSchema = z.object({ requestId: z.string().uuid(), opportunity: opportunitySchema, mode: z.enum(["reference", "ai"]).default("reference") });
function aiConfigured() { return process.env.CONTENT_AI_ENABLED === "true" && !!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !!process.env.CONTENT_MODEL; }
export function GET() {
  return Response.json({ aiAvailable: aiConfigured() && databaseConfigured(), databaseConfigured: databaseConfigured(), maxRevisions: 2, maxModelCalls: 8 }, { headers: { "Cache-Control": "no-store" } });
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
  } catch { return Response.json({ error: "Bitte Produkt, Link, Zielgruppe und konkreten Use Case vollständig eintragen." }, { status: 400 }); }
  if (input.mode === "ai" && !aiConfigured()) return Response.json({ error: "KI-Planung nicht freigeschaltet." }, { status: 503 });
  const repo = memoryRepository();
  try { await repo.claim(input.requestId,input.opportunity,input.mode); }
  catch (error) { return Response.json({ error: error instanceof ConflictError ? error.message : "Postgres ist nicht erreichbar oder die Migration fehlt. Kein Modellaufruf gestartet." }, { status: error instanceof ConflictError ? 409 : 503 }); }
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runContentJob(input.opportunity, { id: input.requestId, mode: input.mode, signal, async loadLearning(opportunity) {
          try { return await repo.learn(opportunity); } catch { throw new Error("Historischer Datenbankvergleich nicht verfügbar. Planung gestoppt."); }
        }, async onUpdate(job) {
          // Database commit precedes UI delivery. A lost browser connection cannot erase saved work.
          try { await repo.save(job); } catch { throw new Error("Postgres-Speicherung fehlgeschlagen. Planung gestoppt."); }
          if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(job)+"\n"));
        } });
        if (!signal.aborted) controller.close();
      } catch { if (!signal.aborted) controller.error(new Error("Speicherung oder Planung unterbrochen. Gespeicherten Verlauf neu laden; kein automatischer Neustart.")); }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

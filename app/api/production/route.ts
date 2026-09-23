import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { chooseVideoProvider } from "@/lib/production/policy";
import { ProductionConflictError, productionRepository } from "@/lib/production/repository";
import { whatsappApprovalReady, whatsappConfig } from "@/lib/whatsapp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres ist noch nicht eingerichtet." }, { status: 503 });
}

function publicConfiguration() {
  return {
    facelessApiKeyConfigured: !!process.env.FACELESS_API_KEY,
    facelessApiContractVerified: false,
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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Ungültige Job-ID." : "Produktionsstatus konnte nicht geladen werden." },
      { status: error instanceof z.ZodError ? 400 : 503 });
  }
}

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepareVideo"), jobId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return Response.json({ error: "Eingabe zu groß." }, { status: 413 });
    const input = mutation.parse(JSON.parse(raw));
    const repo = productionRepository();
    const prepared = await repo.prepareVideo(input.jobId);
    return Response.json({ ...prepared, configuration: publicConfiguration() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      error: error instanceof z.ZodError ? "Ungültige Produktionsanfrage."
        : error instanceof ProductionConflictError ? error.message
        : "Produktionsweg konnte nicht vorbereitet werden. Keine kostenpflichtige Aktion wurde gestartet.",
    }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error instanceof ProductionConflictError ? 409 : 503 });
  }
}

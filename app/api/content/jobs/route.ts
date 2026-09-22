import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { ConflictError, memoryRepository } from "@/lib/memory/repository";
import { performanceSchema } from "@/lib/memory/schema";
export const runtime = "nodejs";
function guard(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres ist noch nicht eingerichtet." }, { status: 503 });
}
export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const jobId = params.get("jobId");
    const before = params.get("before");
    if (jobId) z.string().uuid().parse(jobId);
    if (before) z.string().datetime().parse(before);
    const repo = memoryRepository();
    const data = jobId ? { performance: await repo.performance(jobId) } : { jobs: await repo.list(before || undefined) };
    return Response.json(data,{ headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof z.ZodError ? "Ungültige Abfrage." : "Datenbankabfrage fehlgeschlagen. Verbindung und Migration prüfen." },{ status: error instanceof z.ZodError ? 400 : 503 }); }
}
const mutation = z.discriminatedUnion("action",[
  z.object({ action:z.literal("approve"), jobId:z.string().uuid() }),
  z.object({ action:z.literal("performance"), data:performanceSchema }),
]);
export async function POST(request: Request) {
  const denied=guard(request);if(denied)return denied;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return Response.json({ error:"Eingabe zu groß." },{status:413});
    const input=mutation.parse(JSON.parse(raw));
    const repo=memoryRepository();
    return Response.json(input.action === "approve" ? { job:await repo.approve(input.jobId) } : { result:await repo.recordPerformance(input.data) });
  } catch(error) {
    return Response.json({error:error instanceof z.ZodError ? error.issues.map(i=>i.message).join(" ") : error instanceof ConflictError ? error.message : "Speichern fehlgeschlagen. Keine Änderung bestätigt."},
      {status:error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error instanceof ConflictError ? 409 : 503});
  }
}

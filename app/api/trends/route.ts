import { runProductScout } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function POST() {
  try {
    return Response.json(await runProductScout());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return Response.json({ error: message }, { status: 400 });
  }
}

import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { getOperationsSnapshot } from "@/lib/reporting/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres fehlt." }, { status: 503 });
  try {
    return Response.json(await getOperationsSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Tageslauf und Messwerte nicht abrufbar. Datenbank/Migration prüfen." }, { status: 503 });
  }
}

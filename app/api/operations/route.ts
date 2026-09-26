import { createDailyDraft } from "@/lib/daily/draft";
import { continuePendingReels } from "@/lib/automation/continue";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { getOperationsSnapshot } from "@/lib/reporting/operations";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres fehlt." }, { status: 503 });
  try {
    return Response.json(await getOperationsSnapshot(undefined,!!request.headers.get("x-vercel-oidc-token")), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Tageslauf und Messwerte nicht abrufbar. Datenbank/Migration prüfen." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Zugangscode erforderlich." }, { status: 401 });
  if (!databaseConfigured()) return Response.json({ error: "Postgres fehlt." }, { status: 503 });
  try {
    const raw = await request.text();
    if (raw.length > 200) return Response.json({ error: "Anfrage zu groß." }, { status: 413 });
    const input = JSON.parse(raw);
    if (input.action === "daily") return Response.json(await createDailyDraft(), { headers: { "Cache-Control": "no-store" } });
    if (input.action === "continue") return Response.json(await continuePendingReels(), { headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch {
    return Response.json({ error: "Ablauf nicht bestätigt. Gespeicherten Status prüfen." }, { status: 503 });
  }
}

import { addPrice, endPrice, listPrices } from "@/lib/enterprise/controlling/price-catalog";
import { authorized, unauthorizedResponse } from "@/lib/memory/auth";
import { databaseConfigured, getDatabase } from "@/lib/memory/db";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

// Price catalogue (task E-02 wired): the operator enters prices from the provider's public price page with source URL,
// currency and validity. Nothing is fetched or assumed here; the module validates every field and never overwrites.
export async function GET(request: Request) {
  if (!authorized(request)) return unauthorizedResponse();
  if (!databaseConfigured()) return Response.json({ error: "Postgres fehlt." }, { status: 503, headers });
  try {
    const db = getDatabase();
    await ensureAutomationSchema(db);
    return Response.json({ prices: await listPrices(db) }, { headers });
  } catch { return Response.json({ error: "Preiskatalog nicht lesbar." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorizedResponse();
  if (!databaseConfigured()) return Response.json({ error: "Postgres fehlt." }, { status: 503, headers });
  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return Response.json({ error: "Anfrage zu groß." }, { status: 413, headers });
    input = JSON.parse(raw);
  } catch { return Response.json({ error: "Ungültige Anfrage." }, { status: 400, headers }); }
  // Valid JSON that is not an object (null, a number, a list) is a bad request as well, not a catalogue failure.
  if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Ungültige Anfrage." }, { status: 400, headers });
  try {
    const db = getDatabase();
    await ensureAutomationSchema(db);
    const text = (key: string) => typeof input[key] === "string" ? input[key] as string : "";
    if (input.action === "add") {
      const result = await addPrice(db, { provider: text("provider"), item: text("item"), unit: text("unit"), price: text("price"),
        currency: text("currency") || undefined, validFrom: text("validFrom"), validTo: text("validTo") || null, sourceUrl: text("sourceUrl"),
        enteredBy: "operator" });
      return Response.json(result, { status: result.status === "rejected" ? 400 : 200, headers });
    }
    if (input.action === "end") {
      const result = await endPrice(db, text("id"), text("validTo"));
      return Response.json(result, { status: result.status === "rejected" ? 400 : 200, headers });
    }
    return Response.json({ error: "Unbekannte Aktion." }, { status: 400, headers });
  } catch { return Response.json({ error: "Preis nicht gespeichert. Katalog prüfen." }, { status: 503, headers }); }
}

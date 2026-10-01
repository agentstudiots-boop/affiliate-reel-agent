import { getDatabase } from "@/lib/memory/db";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Counts one click on „Produkt ansehen“. The target link is never taken from the request;
// only an id of an actually published item is accepted. Failures never affect the visitor.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return new Response(null, { status: 403 }); }
    catch { return new Response(null, { status: 403 }); }
  }
  try {
    const raw = await request.text();
    if (raw.length > 200) return new Response(null, { status: 204 });
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response(null, { status: 204 });
    const db = getDatabase();
    await ensureAutomationSchema(db);
    await db.query(`INSERT INTO landing_clicks(publication_id,job_id)
      SELECT id,job_id FROM publication_requests WHERE id=$1 AND status='published' AND platform='facebook'`, [id]);
  } catch { console.error(JSON.stringify({ event: "landing_click_failed" })); }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

import { productSchema } from "@/lib/schema";
import { runScriptWriter } from "@/lib/orchestrator";
import { authorized, unauthorizedResponse } from "@/lib/memory/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorizedResponse();
  let product;
  try { product = productSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Ungültige Produktdaten." }, { status: 400 }); }
  try {
    return Response.json(await runScriptWriter(product));
  } catch {
    console.error(JSON.stringify({ event: "legacy_generate_failed" }));
    return Response.json({ error: "Der Entwurf konnte nicht erstellt werden." }, { status: 500 });
  }
}

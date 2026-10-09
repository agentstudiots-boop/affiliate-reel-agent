import { runProductReview } from "@/lib/orchestrator";
import { trendCandidateSchema } from "@/lib/schema";
import { authorized, unauthorizedResponse } from "@/lib/memory/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Spends Tavily credits and contacts product pages: operator only.
  if (!authorized(request)) return unauthorizedResponse();
  let candidate;
  try { candidate = trendCandidateSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Ungültiger Produktkandidat." }, { status: 400 }); }
  try {
    return Response.json(await runProductReview(candidate));
  } catch {
    console.error(JSON.stringify({ event: "product_review_failed" }));
    return Response.json({ error: "Die Produkt-Prüfung ist fehlgeschlagen." }, { status: 502 });
  }
}

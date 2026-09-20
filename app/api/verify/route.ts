import { runProductReview } from "@/lib/orchestrator";
import { trendCandidateSchema } from "@/lib/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const candidate = trendCandidateSchema.parse(await request.json());
    return Response.json(await runProductReview(candidate));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return Response.json({ error: message }, { status: 400 });
  }
}

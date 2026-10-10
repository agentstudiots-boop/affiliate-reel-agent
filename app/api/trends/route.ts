import { runProductScout } from "@/lib/orchestrator";
import { authorized, unauthorizedResponse } from "@/lib/memory/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Spends Tavily credits: operator only.
  if (!authorized(request)) return unauthorizedResponse();
  try {
    return Response.json(await runProductScout());
  } catch {
    console.error(JSON.stringify({ event: "trend_scout_failed" }));
    return Response.json({ error: "Der Trend-Scout konnte nicht recherchieren." }, { status: 502 });
  }
}

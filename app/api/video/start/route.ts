import { z } from "zod";
import { currentMonthRange, getRunwayClient, monthlyBudgetCredits, RUNWAY_DURATION_SECONDS, RUNWAY_ESTIMATED_CREDITS, RUNWAY_MODEL, RUNWAY_RATIO } from "@/lib/runway";

export const runtime = "nodejs";
const requestSchema = z.object({
  productName: z.string().min(2).max(160),
  prompt: z.string().min(10).max(900),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const client = getRunwayClient();
    const usage = await client.organization.retrieveUsage(currentMonthRange());
    const usedCredits = usage.results.flatMap((day) => day.usedCredits).reduce((sum, item) => sum + item.amount, 0);
    const budgetCredits = monthlyBudgetCredits();
    if (usedCredits + RUNWAY_ESTIMATED_CREDITS > budgetCredits) {
      return Response.json({ error: `Monatslimit erreicht: ${usedCredits} von ${budgetCredits} Credits verbraucht. Kein Video gestartet.` }, { status: 402 });
    }
    const task = await client.textToVideo.create({
      model: RUNWAY_MODEL,
      promptText: `Vertical generic lifestyle advertisement for the product category ${input.productName}. ${input.prompt} Create an original unbranded visualization, not a copy of an Amazon listing or a specific manufacturer's product. Natural realistic motion, clean lighting, no text, no logos, no packaging, no people, no prices, no medical or unsupported claims.`,
      ratio: RUNWAY_RATIO,
      duration: RUNWAY_DURATION_SECONDS,
    });
    return Response.json({ taskId: task.id, estimatedCredits: task.estimatedCost.credits, usedCredits, budgetCredits });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runway-Job konnte nicht gestartet werden.";
    return Response.json({ error: message }, { status: 400 });
  }
}

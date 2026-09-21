import { z } from "zod";
import { buildVideoPrompt } from "@/lib/video-prompt";
import { currentMonthRange, getRunwayClient, monthlyBudgetCredits, RUNWAY_DURATION_SECONDS, RUNWAY_ESTIMATED_CREDITS, RUNWAY_MODEL, RUNWAY_RATIO } from "@/lib/runway";

export const runtime = "nodejs";
const requestSchema = z.object({
  productName: z.string().min(2).max(160),
  prompt: z.string().min(10).max(900),
});

export async function POST(request: Request) {
  let creationAttempted = false;
  try {
    const input = requestSchema.parse(await request.json());
    const client = getRunwayClient();
    const usage = await client.organization.retrieveUsage(currentMonthRange());
    const usedCredits = usage.results.flatMap((day) => day.usedCredits).reduce((sum, item) => sum + item.amount, 0);
    const budgetCredits = monthlyBudgetCredits();
    if (usedCredits + RUNWAY_ESTIMATED_CREDITS > budgetCredits) {
      return Response.json({ error: `Monatslimit erreicht: ${usedCredits} von ${budgetCredits} Credits verbraucht. Kein Video gestartet.`, notStarted: true }, { status: 402 });
    }
    creationAttempted = true;
    const task = await client.textToVideo.create({
      model: RUNWAY_MODEL,
      promptText: buildVideoPrompt(input.productName, input.prompt),
      ratio: RUNWAY_RATIO,
      duration: RUNWAY_DURATION_SECONDS,
    });
    return Response.json({ taskId: task.id, estimatedCredits: task.estimatedCost.credits, usedCredits, budgetCredits });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runway-Job konnte nicht gestartet werden.";
    const validationRejected = error instanceof Error && "status" in error && error.status === 400 && message.includes("Validation of body failed");
    return Response.json({ error: message, notStarted: !creationAttempted || validationRejected }, { status: 400 });
  }
}

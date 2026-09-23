import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { startApprovedProduction } from "@/lib/production/service";
import { completeProduction } from "@/lib/production/service";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
const requestSchema = z.object({ productionRequestId:z.string().uuid() });

export async function POST(request: Request) {
  if(!authorized(request))return Response.json({error:"Zugangscode erforderlich. Kostenpflichtige Produktion bleibt gesperrt."},{status:401});
  try {
    const input = requestSchema.parse(await request.json());
    const production=await startApprovedProduction(input.productionRequestId);
    if(!production)return Response.json({error:"Produktionsanfrage nicht gefunden."},{status:404});
    if(production.status==="awaiting_cost_approval")return Response.json({error:"Keine ausdrückliche WhatsApp-Kostenfreigabe gespeichert. Kein Render gestartet.",notStarted:true},{status:409});
    if(["submitted","generating","rendering","transferring"].includes(production.status))after(()=>completeProduction(production.id));
    return Response.json({productionRequestId:production.id,taskId:production.external_job_id,status:production.status,estimatedCredits:production.estimated_credits,actualCredits:production.actual_credits});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video-Job konnte nicht gestartet werden.";
    return Response.json({ error: message, notStarted:true }, { status: 400 });
  }
}

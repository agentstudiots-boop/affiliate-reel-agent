import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { timelineRepository, socialSnapshotSchema, affiliateSnapshotSchema, priceSnapshotSchema, costEventSchema } from "@/lib/memory/timeline";

export const runtime = "nodejs";
const contentId = z.string().regex(/^cnt_[a-zA-Z0-9_]+$/);
const mutation = z.discriminatedUnion("action", [
  z.object({action:z.literal("social"),data:socialSnapshotSchema}),
  z.object({action:z.literal("affiliate"),data:affiliateSnapshotSchema}),
  z.object({action:z.literal("price"),data:priceSnapshotSchema}),
  z.object({action:z.literal("cost"),data:costEventSchema}),
  z.object({action:z.literal("bindAffiliateTracking"),contentId,provider:z.string().min(1).max(200),trackingId:z.string().min(1).max(200)}),
]);
function guard(request: Request) {
  if (!authorized(request)) return Response.json({error:"Zugangscode erforderlich."},{status:401});
  if (!databaseConfigured()) return Response.json({error:"Postgres nicht eingerichtet."},{status:503});
}
export async function GET(request: Request) {
  const denied=guard(request);if(denied)return denied;
  try {
    const id=contentId.parse(new URL(request.url).searchParams.get("contentId"));
    const repo=timelineRepository();
    return Response.json({contentId:id,history:await repo.history(id),economics:await repo.economics(id)},
      {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    return Response.json({error:error instanceof z.ZodError?"Ungültige content_id.":"Datenbankabfrage fehlgeschlagen."},
      {status:error instanceof z.ZodError?400:503});
  }
}
export async function POST(request: Request) {
  const denied=guard(request);if(denied)return denied;
  try {
    const raw=await request.text();
    if(raw.length>12000)return Response.json({error:"Eingabe zu groß."},{status:413});
    const input=mutation.parse(JSON.parse(raw)),repo=timelineRepository();
    if(input.action==="bindAffiliateTracking") {
      await repo.bindAffiliateTracking(input.contentId,input.provider,input.trackingId);
      return Response.json({bound:true});
    }
    const result=input.action==="social"?await repo.social(input.data)
      :input.action==="affiliate"?await repo.affiliate(input.data)
      :input.action==="price"?await repo.price(input.data):await repo.cost(input.data);
    return Response.json(result,{status:result.created?201:200});
  } catch(error) {
    return Response.json({error:error instanceof z.ZodError?error.issues.map(i=>i.message).join(" ")
      :error instanceof Error&&/Snapshot|Tracking-ID|Trackingcode|mismatch|already|anders gebunden/.test(error.message)?error.message:"Speichern fehlgeschlagen; historische Daten unverändert."},
    {status:error instanceof z.ZodError||error instanceof SyntaxError?400:409});
  }
}

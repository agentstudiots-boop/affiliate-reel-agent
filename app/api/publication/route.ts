import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { PublicationConflictError, publicationRepository } from "@/lib/meta/publication-gate";
import { requestFacebookApproval } from "@/lib/meta/request-publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const idSchema = z.string().uuid();
function guard(request: Request) {
  if (!authorized(request)) return Response.json({error:"Zugangscode erforderlich."},{status:401});
  if (!databaseConfigured()) return Response.json({error:"Postgres fehlt."},{status:503});
}
export async function GET(request: Request) {
  const denied=guard(request);if(denied)return denied;
  try {
    const jobId=idSchema.parse(new URL(request.url).searchParams.get("jobId"));
    return Response.json({publication:await publicationRepository().get(jobId)},{headers:{"Cache-Control":"no-store"}});
  } catch { return Response.json({error:"Publikationsstatus nicht abrufbar."},{status:400}); }
}
export async function POST(request: Request) {
  const denied=guard(request);if(denied)return denied;
  try {
    const raw=await request.text();
    if(raw.length>1500)return Response.json({error:"Anfrage zu groß."},{status:413});
    const {jobId}=z.object({jobId:idSchema}).parse(JSON.parse(raw));
    return Response.json(await requestFacebookApproval(jobId));
  } catch(error) {
    return Response.json({error:error instanceof PublicationConflictError?error.message:"Ergebnis unklar; kein automatischer zweiter Veröffentlichungs- oder WhatsApp-Versuch."},
      {status:error instanceof PublicationConflictError?409:503});
  }
}

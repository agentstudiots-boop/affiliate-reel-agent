import { z } from "zod";
import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { PublicationConflictError, publicationRepository } from "@/lib/meta/publication-gate";
import { requestFacebookApproval } from "@/lib/meta/request-publication";
import { imageProviderStatus } from "@/lib/content/image-provider";
import { reconcileFacebookPhoto } from "@/lib/meta/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const idSchema = z.string().uuid();
const postSchema = z.union([
  z.object({ jobId: idSchema, action: z.literal("request").optional() }),
  z.object({ jobId: idSchema, action: z.literal("reset_whatsapp"), confirmedNoMessage: z.literal(true) }),
  z.object({ jobId: idSchema, action: z.literal("reconcile") }),
  z.object({ jobId: idSchema, action: z.literal("reuse_visual"), confirmedNoVisiblePost: z.literal(true) }),
]);
function guard(request: Request) {
  if (!authorized(request)) return Response.json({error:"Zugangscode erforderlich."},{status:401});
  if (!databaseConfigured()) return Response.json({error:"Postgres fehlt."},{status:503});
}
export async function GET(request: Request) {
  const denied=guard(request);if(denied)return denied;
  try {
    const jobId=idSchema.parse(new URL(request.url).searchParams.get("jobId"));
    return Response.json({publication:await publicationRepository().get(jobId),imageProvider:imageProviderStatus()},{headers:{"Cache-Control":"no-store"}});
  } catch { return Response.json({error:"Publikationsstatus nicht abrufbar."},{status:400}); }
}
export async function POST(request: Request) {
  const denied=guard(request);if(denied)return denied;
  try {
    const raw=await request.text();
    if(raw.length>1500)return Response.json({error:"Anfrage zu groß."},{status:413});
    const input=postSchema.parse(JSON.parse(raw));
    if(input.action==="reconcile"){
      const target=await publicationRepository().reconciliationTarget(input.jobId);
      const reconciliation=await reconcileFacebookPhoto(target.caption,target.attemptedAt);
      console.info(JSON.stringify({event:"facebook_publication_reconciliation",jobId:input.jobId,status:reconciliation.status,...(reconciliation.status!=="found"?{reason:reconciliation.reason,httpStatus:reconciliation.httpStatus,code:reconciliation.code,subcode:reconciliation.subcode}:{})}));
      return Response.json({reconciliation},{headers:{"Cache-Control":"no-store"}});
    }
    if(input.action==="reset_whatsapp"){
      const publication=await publicationRepository().resetWhatsAppSendAfterOperatorConfirmation(input.jobId);
      console.info(JSON.stringify({event:"whatsapp_publication_reset_confirmed",publicationId:publication.id,jobId:input.jobId}));
      return Response.json({publication,reset:true});
    }
    if(input.action==="reuse_visual"){
      const target=await publicationRepository().reconciliationTarget(input.jobId);
      const reconciliation=await reconcileFacebookPhoto(target.caption,target.attemptedAt);
      if(reconciliation.status!=="not_found")throw new PublicationConflictError(
        reconciliation.status==="found"?"Facebook hat bereits ein passendes Foto gefunden. Kein zweiter Post.":"Facebook-Abgleich nicht vollständig; kein zweiter Post."
      );
      const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
      if(!approver)throw new PublicationConflictError("WhatsApp-Freigabe ist nicht eingerichtet.");
      const publication=await publicationRepository().reuseUnknownVisual(input.jobId,approver);
      console.info(JSON.stringify({event:"facebook_visual_reuse",jobId:input.jobId,publicationId:publication.id,revision:publication.revision}));
      return Response.json(await requestFacebookApproval(input.jobId));
    }
    return Response.json(await requestFacebookApproval(input.jobId));
  } catch(error) {
    return Response.json({error:error instanceof PublicationConflictError?error.message:"Ergebnis unklar; kein automatischer zweiter Veröffentlichungs- oder WhatsApp-Versuch."},
      {status:error instanceof PublicationConflictError?409:503});
  }
}

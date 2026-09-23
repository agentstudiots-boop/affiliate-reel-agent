import { authorized } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { createProductionSchema } from "@/lib/production/schema";
import { productionRepository } from "@/lib/production/repository";
import { chooseGermanVoice, FacelessService } from "@/lib/renderers/faceless";
import { selectRenderer, facelessModel } from "@/lib/renderers/selection";
import { RUNWAY_ESTIMATED_CREDITS } from "@/lib/production/service";
import { operatorNumber, productionApprovalMessage, sendWhatsAppText, senderHash } from "@/lib/whatsapp/client";
export const runtime="nodejs";export const maxDuration=60;
export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Zugangscode erforderlich."},{status:401});
  if(!databaseConfigured())return Response.json({error:"Postgres ist nicht eingerichtet."},{status:503});
  try{
    const raw=await request.text();if(raw.length>30000)return Response.json({error:"Produktionsplan zu groß."},{status:413});
    const input=createProductionSchema.parse(JSON.parse(raw));const repo=productionRepository();const successful=await repo.successfulFacelessVideos();const decision=selectRenderer(successful,input.factors);
    let estimatedCredits:number|null=null,voiceId=input.voiceId || null;
    if(decision.provider==="faceless"){
      const api=new FacelessService();const [models,voices]=await Promise.all([api.models(),voiceId?Promise.resolve([]):api.voices()]);
      const model=models.find(item=>item.value===facelessModel(decision.mode));if(!model)throw new Error("Gewähltes Faceless-Modell ist im Live-Katalog nicht verfügbar.");
      estimatedCredits=model.credits;if(!voiceId)voiceId=chooseGermanVoice(voices);
    }else estimatedCredits=RUNWAY_ESTIMATED_CREDITS;
    const prior=await repo.opportunityCosts(input.contentJobId);const recipient=operatorNumber();
    const performance=input.factors.availablePerformanceData?`${input.factors.provenClicks} Klicks, ${input.factors.provenConversions} Conversions`:"Noch keine belastbaren Performance-Daten";
    const message=productionApprovalMessage({productName:input.productName,affiliateProgram:input.affiliateProgram,commission:input.factors.knownAffiliateCommission,creative:input.creativeConcept,hook:input.hook,description:input.description,renderer:decision.mode,reason:decision.explanation,estimatedCredits,estimatedCostCents:input.factors.estimatedProductionCostCents,priorCostCents:prior,performance});
    const created=await repo.create({contentJobId:input.contentJobId,script:input.script,voiceId,decision,factors:input.factors,estimatedCredits,estimatedCostCents:input.factors.estimatedProductionCostCents,affiliateCommission:input.factors.knownAffiliateCommission,approvalPayload:{productName:input.productName,affiliateProgram:input.affiliateProgram,creativeConcept:input.creativeConcept,hook:input.hook,description:input.description,decision,estimatedCredits,estimatedCostCents:input.factors.estimatedProductionCostCents,priorCostCents:prior,performance},senderHash:recipient?senderHash(recipient):""});
    const notification=recipient?await sendWhatsAppText(recipient,message):{sent:false as const,reason:"WHATSAPP_OPERATOR_PHONE_NUMBER fehlt."};
    return Response.json({productionRequestId:created.id,approvalRequestId:created.approvalId,status:"awaiting_cost_approval",decision,estimatedCredits,bootstrap:{successful,target:15},notification});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Produktionsplan konnte nicht gespeichert werden."},{status:400});}
}

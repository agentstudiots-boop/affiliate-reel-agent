import { FacelessApiError, FacelessService } from "@/lib/renderers/faceless";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
  try{const service=new FacelessService();const [me,models,voices]=await Promise.all([service.connection(),service.models(),service.voices()]);return Response.json({connected:true,plan:me.plan??null,creditBalance:me.team.credits,scopes:me.auth.scopes,models,voices:voices.map(v=>({id:v.id,name:v.name,labels:v.labels,targetLanguages:v.targetLanguages,isRecommended:v.isRecommended}))},{headers:{"Cache-Control":"no-store"}});}
  catch(error){return Response.json({connected:false,error:error instanceof FacelessApiError?error.type:"not_configured"},{status:error instanceof FacelessApiError?error.status:503,headers:{"Cache-Control":"no-store"}});}
}

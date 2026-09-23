import { allowedSender, normalizePhone, operatorNumber, sendWhatsAppText, senderHash, verifyWebhookSignature } from "@/lib/whatsapp/client";
import { interpretGermanMessage } from "@/lib/whatsapp/intent";
import { whatsappRepository } from "@/lib/whatsapp/repository";
import { productionRepository } from "@/lib/production/repository";
import { completeProduction, startApprovedProduction } from "@/lib/production/service";
import { after } from "next/server";
import { contentApprovalRepository } from "@/lib/content/approvals";
import { publishApprovedContentVersion } from "@/lib/meta/publishing";
export const runtime="nodejs";export const maxDuration=300;export const dynamic="force-dynamic";

export function GET(request:Request){const url=new URL(request.url);const mode=url.searchParams.get("hub.mode"),token=url.searchParams.get("hub.verify_token"),challenge=url.searchParams.get("hub.challenge");if(mode==="subscribe"&&token&&token===process.env.WHATSAPP_VERIFY_TOKEN&&challenge)return new Response(challenge,{status:200,headers:{"Content-Type":"text/plain"}});return new Response("Forbidden",{status:403});}

type Incoming={id:string;from:string;text:string};
function messages(payload:unknown):Incoming[]{
  const result:Incoming[]=[];if(!payload||typeof payload!=="object")return result;
  const entries=(payload as {entry?:unknown[]}).entry;if(!Array.isArray(entries))return result;
  for(const entry of entries){const changes=(entry as {changes?:unknown[]})?.changes;if(!Array.isArray(changes))continue;for(const change of changes){const list=(change as {value?:{messages?:unknown[]}})?.value?.messages;if(!Array.isArray(list))continue;for(const message of list){const item=message as {id?:unknown;from?:unknown;type?:unknown;text?:{body?:unknown}};if(typeof item.id==="string"&&typeof item.from==="string"&&item.type==="text"&&typeof item.text?.body==="string")result.push({id:item.id,from:item.from,text:item.text.body});}}}
  return result;
}

export async function POST(request:Request){
  const raw=await request.text();if(!verifyWebhookSignature(raw,request.headers.get("x-hub-signature-256")))return new Response("Unauthorized",{status:401});
  let payload:unknown;try{payload=JSON.parse(raw);}catch{return new Response("Bad Request",{status:400});}
  const repo=whatsappRepository();
  for(const message of messages(payload)){
    if(!await repo.claimEvent(message.id,JSON.stringify(message)))continue;
    try{
      if(!allowedSender(message.from)){await repo.eventStatus(message.id,"ignored");continue;}
      const sender=senderHash(message.from),context=await repo.openContext(sender);
      if(!context){await sendWhatsAppText(normalizePhone(message.from),"Es gibt gerade keine offene Freigabe, der diese Nachricht sicher zugeordnet werden kann.");await repo.eventStatus(message.id,"ignored");continue;}
      const intent=interpretGermanMessage(message.text,context.kind);await repo.record(context,sender,intent,message.text);
      if(intent.intent==="CLARIFY"){await sendWhatsAppText(normalizePhone(message.from),"Ich konnte die Entscheidung nicht eindeutig zuordnen. Bitte schreibe zum Beispiel: „Freigeben“, „Nicht veröffentlichen“ oder nenne konkret die gewünschte Änderung.");await repo.eventStatus(message.id,"processed");continue;}
      if(intent.intent==="REJECT"){await repo.reject(context,message.text);await sendWhatsAppText(normalizePhone(message.from),"Abgelehnt. Es wird weder produziert noch veröffentlicht.");await repo.eventStatus(message.id,"processed");continue;}
      if(intent.intent==="REVISION_REQUEST"){
        if(context.kind==="CONTENT_PUBLISH"&&context.content_version_id){const revised=await contentApprovalRepository().revise(context.content_version_id,intent.target,message.text,sender);const content=revised.content as Record<string,unknown>;await sendWhatsAppText(normalizePhone(message.from),`Änderung umgesetzt und als neue Content-Version gespeichert.\n\nHook: ${String(content.hook || "unverändert")}\nCaption/Text: ${String(content.caption || content.body || "unverändert")}\nCTA: ${String(content.cta || "unverändert")}\n\nBitte erneut freigeben oder eine weitere konkrete Änderung nennen.`);}
        else {await repo.revision(context,message.text);await sendWhatsAppText(normalizePhone(message.from),"Änderungswunsch gespeichert. Es wird kein kostenpflichtiger Auftrag gestartet. Nach der neuen Produktionsplanung ist eine erneute Freigabe nötig.");}
        await repo.eventStatus(message.id,"processed");continue;
      }
      if(context.kind==="RENDER_COST"&&context.production_request_id){const id=await productionRepository().approveByApprovalId(context.approval_id,message.text);await sendWhatsAppText(operatorNumber()||normalizePhone(message.from),"Kostenfreigabe gespeichert. Der eindeutig zugeordnete Produktionsauftrag wird jetzt gestartet.");const started=await startApprovedProduction(id);if(started&&["submitted","generating","rendering","transferring"].includes(started.status))after(()=>completeProduction(id));}
      else {await repo.approveNonRender(context,intent);if(context.kind==="CONTENT_PUBLISH"&&context.content_version_id){const publishing=await publishApprovedContentVersion(context.content_version_id);await sendWhatsAppText(normalizePhone(message.from),publishing?.status==="published"?`Freigabe gespeichert und veröffentlicht.${publishing.permalink?`\n${publishing.permalink}`:""}`:"Freigabe gespeichert. Meta verarbeitet den Beitrag; der Publishing-Status wird weiter geprüft.");}else await sendWhatsAppText(normalizePhone(message.from),"Entscheidung zum Capability Proposal wurde gespeichert.");}
      await repo.eventStatus(message.id,"processed");
    }catch{await repo.eventStatus(message.id,"failed");await sendWhatsAppText(normalizePhone(message.from),"Die Entscheidung konnte nicht sicher verarbeitet werden. Es wurde keine kostenpflichtige oder veröffentlichende Aktion ausgelöst.");}
  }
  return new Response("EVENT_RECEIVED",{status:200});
}

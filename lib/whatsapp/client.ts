import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function normalizePhone(value:string){return value.replace(/[^0-9]/g,"");}
export function senderHash(value:string){return createHash("sha256").update(normalizePhone(value)).digest("hex");}
export function operatorNumber(){return normalizePhone(process.env.WHATSAPP_OPERATOR_PHONE_NUMBER || "");}
export function allowedSender(value:string){
  const normalized=normalizePhone(value);if(!normalized)return false;
  const allowed=(process.env.WHATSAPP_ALLOWED_SENDERS || process.env.WHATSAPP_OPERATOR_PHONE_NUMBER || "").split(",").map(normalizePhone).filter(Boolean);
  return allowed.some(item=>{const a=Buffer.from(item),b=Buffer.from(normalized);return a.length===b.length&&timingSafeEqual(a,b);});
}
export function verifyWebhookSignature(raw:string,signature:string|null){
  const secret=process.env.WHATSAPP_APP_SECRET;if(!secret||!signature?.startsWith("sha256="))return false;
  const expected=`sha256=${createHmac("sha256",secret).update(raw).digest("hex")}`;const a=Buffer.from(expected),b=Buffer.from(signature);
  return a.length===b.length&&timingSafeEqual(a,b);
}

const sendResponse=z.object({messages:z.array(z.object({id:z.string()})).min(1)});
export async function sendWhatsAppText(to:string,body:string){
  const token=process.env.WHATSAPP_ACCESS_TOKEN?.trim(),phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if(!token||!phoneId||!normalizePhone(to))return {sent:false as const,reason:"WhatsApp-Versand ist noch nicht vollständig konfiguriert."};
  const version=process.env.META_GRAPH_API_VERSION || "v25.0";
  const template=process.env.WHATSAPP_TEMPLATE_NAME?.trim();const payload=template?{messaging_product:"whatsapp",to:normalizePhone(to),type:"template",template:{name:template,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE||"de"},components:[{type:"body",parameters:[{type:"text",text:body.slice(0,4096)}]}]}}:{messaging_product:"whatsapp",recipient_type:"individual",to:normalizePhone(to),type:"text",text:{preview_url:true,body:body.slice(0,4096)}};
  const response=await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload),redirect:"error",signal:AbortSignal.timeout(15_000)});
  if(!response.ok)return {sent:false as const,reason:`WhatsApp-Versand von Meta abgelehnt (${response.status}).`};
  const parsed=sendResponse.safeParse(await response.json());
  return parsed.success?{sent:true as const,messageId:parsed.data.messages[0].id}:{sent:false as const,reason:"WhatsApp-Antwort war unvollständig."};
}

export function productionApprovalMessage(input:{productName:string;affiliateProgram:string;commission:string|null;creative:string;hook:string;description:string;renderer:string;reason:string;estimatedCredits:number|null;estimatedCostCents:number|null;priorCostCents:number;performance:string}){
  const cost=input.estimatedCostCents===null?`${input.estimatedCredits ?? "unbekannte"} Provider-Credits; Eurobetrag nicht automatisch verfügbar`:`${(input.estimatedCostCents/100).toFixed(2).replace(".",",")} €`;
  return `VIDEO-PRODUKTION – FREIGABE\n\nProdukt:\n${input.productName}\n\nAffiliate-Programm:\n${input.affiliateProgram}\n\nProvision:\n${input.commission || "Noch nicht bekannt"}\n\nCreative:\n${input.creative}\n\nHook:\n${input.hook}\n\nGeplantes Video:\n${input.description}\n\nRenderer:\n${input.renderer}\n\nGeschätzte Kosten:\n${cost}\n\nBisherige Kosten dieser Opportunity:\n${(input.priorCostCents/100).toFixed(2).replace(".",",")} €\n\nWarum:\n${input.reason}\n\nPerformance:\n${input.performance}\n\nAntworte einfach in normalem Deutsch, z. B. „Freigeben“, „Zu teuer“ oder mit einem Änderungswunsch.`;
}

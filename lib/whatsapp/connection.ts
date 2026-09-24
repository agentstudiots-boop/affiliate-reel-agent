type WhatsAppStatus =
  | "connected"
  | "token_missing"
  | "sender_missing"
  | "token_invalid"
  | "missing_permission"
  | "sender_unreachable"
  | "rate_limited"
  | "service_unavailable";

type GraphFailure = { code: number; subcode: number; httpStatus: number };

export async function checkWhatsAppConnection(transport: typeof fetch = fetch) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATTSAPP_ACCESS_TOKEN;
  const sender = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATTSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_API_VERSION || "v25.0";
  const configured = {
    token: !!token,
    phoneNumberId: !!sender,
    businessAccountId: !!(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WHATTSAPP_BUSINESS_ACCOUNT_ID),
    approver: !!process.env.WHATSAPP_APPROVER_WA_ID,
    verifyToken: !!process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: !!process.env.META_APP_SECRET,
    graphVersion: version,
  };
  const finish=(status:WhatsAppStatus,message:string,code?:number,subcode?:number)=>({
    status,message,checkedAt:new Date().toISOString(),connectionOk:status==="connected",configured,
    ...(code!==undefined?{code}:{code:undefined}),
    ...(subcode!==undefined?{subcode}:{subcode:undefined}),
  });
  if(!token?.trim())return finish("token_missing","WhatsApp-Zugriffstoken fehlt im Server-Environment.");
  if(!sender?.trim())return finish("sender_missing","WhatsApp Phone Number ID fehlt im Server-Environment.");
  if(!/^\d+$/.test(sender) || !/^v\d+\.0$/.test(version))return finish("sender_unreachable","WhatsApp Phone Number ID oder Graph-Version ist ungültig.");

  try {
    const url=new URL(`https://graph.facebook.com/${version}/${sender}`);
    url.searchParams.set("fields","id,verified_name,quality_rating");
    const response=await transport(url,{
      method:"GET",
      headers:{Authorization:`Bearer ${token.trim()}`},
      cache:"no-store",
      redirect:"error",
      signal:AbortSignal.timeout(8000),
    });
    let body:{id?:string;error?:{code?:number;error_subcode?:number}};
    try{body=await response.json();}catch{body={};}
    if(!response.ok || body.error){
      const failure:GraphFailure={code:body.error?.code||0,subcode:body.error?.error_subcode||0,httpStatus:response.status};
      if([190,102].includes(failure.code))return finish("token_invalid","Meta weist den WhatsApp-Token als ungültig oder abgelaufen zurück.",failure.code,failure.subcode);
      if([10,200,294].includes(failure.code))return finish("missing_permission","Meta verweigert die lesende WhatsApp-Prüfung wegen fehlender Berechtigung oder Asset-Zuweisung.",failure.code,failure.subcode);
      if([4,17,32,613].includes(failure.code))return finish("rate_limited","Meta begrenzt derzeit die WhatsApp-API.",failure.code,failure.subcode);
      if([100,803].includes(failure.code))return finish("sender_unreachable","Die konfigurierte WhatsApp Phone Number ID ist mit diesem Token nicht erreichbar.",failure.code,failure.subcode);
      return finish("service_unavailable","WhatsApp-Verbindung konnte nicht zuverlässig geprüft werden.",failure.code,failure.subcode);
    }
    if(body.id!==sender)return finish("sender_unreachable","Meta antwortet, aber nicht mit der erwarteten WhatsApp Phone Number ID.");
    return finish("connected","WhatsApp-Token und Phone Number ID sind lesend erreichbar.");
  } catch {
    return finish("service_unavailable","WhatsApp-Verbindung konnte wegen Netzwerkfehler oder Timeout nicht zuverlässig geprüft werden.");
  }
}

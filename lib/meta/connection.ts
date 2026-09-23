export type MetaStatus = "connected" | "token_missing" | "token_invalid" | "token_expired" | "missing_permission" | "page_unreachable" | "page_ambiguous" | "instagram_not_linked" | "instagram_unreachable" | "identity_mismatch" | "configuration_error" | "rate_limited" | "service_unavailable" | "discovery_limit";
export type MetaReport = { status: MetaStatus; message: string; checkedAt: string; connectionOk: boolean; publishingReadCheck: boolean;
  configured: { token: boolean; pageId: boolean; instagramId: boolean; businessId: boolean; graphVersion: string };
  steps: { stage: string; result: "ok"|"failed"|"unknown"; code?: number; subcode?: number }[];
  missingPermissions: string[]; resolved?: { pageId: string; instagramId: string }; };
export type MetaConfig = { token?: string; pageId?: string; instagramId?: string; businessId?: string; version?: string;
  pageName?: string; instagramUsername?: string; systemUserName?: string };
type GraphObject = { id?: string; name?: string; username?: string; instagram_business_account?: {id?:string}|null;
  data?: (GraphObject & {permission?:string;status?:string})[]; paging?: {cursors?:{after?:string};next?:string}; error?:{code?:number;error_subcode?:number} };
export class GraphFailure extends Error {
  constructor(public code: number, public subcode: number, public httpStatus: number) { super("Meta Graph API request failed"); }
}
const normalizeName = (s:string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const validId = (s:unknown): s is string => typeof s === "string" && /^\d+$/.test(s);
export function metaConfig(): MetaConfig {
  return { token:process.env.META_SYSTEM_USER_TOKEN, pageId:process.env.META_PAGE_ID,instagramId:process.env.META_INSTAGRAM_USER_ID,
    businessId:process.env.META_BUSINESS_ID,version:process.env.META_GRAPH_API_VERSION || "v25.0",
    pageName:process.env.META_PAGE_NAME || "Alltäglich leichter",instagramUsername:process.env.META_INSTAGRAM_USERNAME || "alltaeglich.leichter",
    systemUserName:process.env.META_SYSTEM_USER_NAME || "affiliatecontentsystem" };
}
export async function checkMetaConnection(config:MetaConfig, transport: typeof fetch = fetch): Promise<MetaReport> {
  const version=config.version || "v25.0";
  const report:MetaReport={status:"service_unavailable",message:"Verbindung nicht geprüft.",checkedAt:new Date().toISOString(),connectionOk:false,publishingReadCheck:false,
    configured:{token:!!config.token,pageId:!!config.pageId,instagramId:!!config.instagramId,businessId:!!config.businessId,graphVersion:version},steps:[],missingPermissions:[]};
  const finish=(status:MetaStatus,message:string)=>{report.status=status;report.message=message;return report;};
  if(!config.token?.trim())return finish("token_missing","META_SYSTEM_USER_TOKEN fehlt im Server-Environment.");
  if(!/^v\d+\.0$/.test(version) || [config.pageId,config.instagramId,config.businessId].some(id=>id && !validId(id)))return finish("configuration_error","Graph-Version oder konfigurierte Objekt-ID ist ungültig.");
  let requests=0;let stage="token";
  const read=async(path:string,params:Record<string,string>={}):Promise<GraphObject>=>{
    if(++requests>14)throw new GraphFailure(-2,0,0);
    const url=new URL(`https://graph.facebook.com/${version}/${path}`);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    // Tokens never appear in URLs, thrown errors, logs or serialized diagnostics.
    const response=await transport(url,{method:"GET",headers:{Authorization:`Bearer ${config.token!.trim()}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
    let body:GraphObject;
    try {body=await response.json();}catch{throw new GraphFailure(0,0,response.status);}
    if(!response.ok || body.error)throw new GraphFailure(body.error?.code || 0,body.error?.error_subcode || 0,response.status);
    return body;
  };
  const fatal=(error:unknown)=>error instanceof GraphFailure && ([190,102,4,17,32,613,-2].includes(error.code) || error.httpStatus>=500);
  let discoveryError:GraphFailure|undefined;
  let truncated=false;
  const list=async(path:string):Promise<GraphObject[]>=>{
    const result:GraphObject[]=[];let after="";
    for(let i=0;i<3;i++){
      const response=await read(path,{fields:"id,name",limit:"100",...(after?{after}:{})});
      if(!Array.isArray(response.data))throw new GraphFailure(0,0,200);
      result.push(...response.data);
      if(!response.paging?.next)return result;
      after=response.paging.cursors?.after || "";
      if(!after){truncated=true;return result;}
    }
    truncated=true;return result;
  };
  try {
    const identity=await read("me",{fields:"id,name"});
    if(!validId(identity.id))throw new GraphFailure(0,0,200);
    if(normalizeName(identity.name || "")!==normalizeName(config.systemUserName || "affiliatecontentsystem"))return finish("identity_mismatch","Der Token gehört nicht zum erwarteten Systemnutzer affiliatecontentsystem.");
    report.steps.push({stage,result:"ok"});
    stage="permissions";
    let permissions:Set<string>|undefined;
    try{
      const result=await read("me/permissions",{limit:"100"});
      if(Array.isArray(result.data))permissions=new Set(result.data.filter(p=>p.status==="granted").map(p=>p.permission || ""));
      report.steps.push({stage,result:permissions?"ok":"unknown"});
    }catch(error){if(fatal(error))throw error;report.steps.push({stage,result:"unknown"});}
    // Do not infer missing scopes from an unsupported permission-list edge.
    if(permissions)report.missingPermissions=["instagram_basic","pages_read_engagement","instagram_content_publish","pages_manage_posts"].filter(p=>!permissions!.has(p));
    stage="page_discovery";
    let pageId=config.pageId;
    if(!pageId){
      const pages=new Map<string,GraphObject>();
      const paths=[`${identity.id}/assigned_pages`,"me/accounts",...(config.businessId?[`${config.businessId}/owned_pages`,`${config.businessId}/client_pages`]:[])];
      for(const path of paths){
        try{for(const page of await list(path))if(validId(page.id))pages.set(page.id,page);}
        catch(error){if(fatal(error))throw error;if(error instanceof GraphFailure)discoveryError=error;continue;}
        const matches=[...pages.values()].filter(p=>normalizeName(p.name||"")===normalizeName(config.pageName||"Alltäglich leichter"));
        if(matches.length>1)return finish("page_ambiguous","Mehrere gleichnamige Seiten gefunden. META_PAGE_ID muss die gewünschte Seite eindeutig festlegen.");
        if(matches.length===1){pageId=matches[0].id;break;}
      }
    }
    if(!pageId){
      if(truncated)return finish("discovery_limit","Begrenzte Seitensuche unvollständig. META_PAGE_ID gezielt festlegen.");
      if(discoveryError && [10,200,294].includes(discoveryError.code))throw discoveryError;
      return finish("page_unreachable","Die erwartete Facebook-Seite wurde unter den erreichbaren Assets nicht gefunden. Zuweisung, Seitenname oder META_PAGE_ID prüfen.");
    }
    stage="facebook_page";
    const page=await read(pageId,{fields:"id,name"});
    if(page.id!==pageId || normalizeName(page.name||"")!==normalizeName(config.pageName||"Alltäglich leichter"))return finish("identity_mismatch","Die erreichbare Facebook-Seite entspricht nicht der erwarteten Projektseite.");
    report.steps.push({stage,result:"ok"});
    stage="instagram_link";
    const linked=await read(pageId,{fields:"instagram_business_account"});
    const instagramId=linked.instagram_business_account?.id;
    if(!validId(instagramId))return finish("instagram_not_linked","Facebook-Seite erreichbar, aber kein verknüpftes professionelles Instagram-Konto zurückgegeben.");
    if(config.instagramId && instagramId!==config.instagramId)return finish("identity_mismatch","Konfigurierte Instagram-ID stimmt nicht mit der Facebook-Verknüpfung überein.");
    report.steps.push({stage,result:"ok"});
    stage="instagram_account";
    const instagram=await read(instagramId,{fields:"id,username"});
    if(instagram.id!==instagramId || instagram.username?.toLowerCase()!==(config.instagramUsername||"alltaeglich.leichter").replace(/^@/,"").toLowerCase())return finish("identity_mismatch","Das erreichbare Instagram-Konto entspricht nicht @alltaeglich.leichter.");
    report.steps.push({stage,result:"ok"});report.connectionOk=true;report.resolved={pageId,instagramId};
    if(report.missingPermissions.length)return finish("missing_permission","Konten erreichbar, aber mindestens eine benötigte Instagram-/Seitenberechtigung fehlt im Token.");
    stage="publishing_read_check";
    await read(`${instagramId}/content_publishing_limit`,{fields:"config,quota_usage"});
    report.publishingReadCheck=true;report.steps.push({stage,result:"ok"});
    return finish("connected","Systemnutzer, Facebook-Seite und Instagram-Konto sind verbunden. Lesender Publishing-Vorabtest bestanden; es wurde nichts veröffentlicht.");
  }catch(error){
    const failure=error instanceof GraphFailure?error:undefined;
    report.steps.push({stage,result:"failed",...(failure?{code:failure.code,subcode:failure.subcode}:{})});
    if(failure?.code===190 && failure.subcode===463)return finish("token_expired","Der Meta-Token ist abgelaufen. Neuen Systemnutzer-Token serverseitig hinterlegen.");
    if(failure && [190,102].includes(failure.code))return finish("token_invalid","Meta hat den Token als ungültig, widerrufen oder nicht mehr gültig abgewiesen.");
    if(failure && [10,200,294].includes(failure.code))return finish("missing_permission","Meta verweigert diese Abfrage wegen fehlender Berechtigungen oder Asset-Zugriffsrechte.");
    if(failure && [4,17,32,613].includes(failure.code))return finish("rate_limited","Meta begrenzt derzeit die API-Nutzung. Kein automatischer Neuversuch.");
    if(failure?.code===-2)return finish("discovery_limit","Maximale Anzahl lesender Prüfaufrufe erreicht. IDs gezielt konfigurieren.");
    if(failure && [100,803].includes(failure.code))return finish(stage.startsWith("instagram")?"instagram_unreachable":"page_unreachable","Das angefragte Meta-Objekt ist nicht erreichbar. ID, Asset-Zuweisung und Berechtigungen prüfen; Meta unterscheidet diese Ursachen nicht immer eindeutig.");
    return finish("service_unavailable","Meta konnte nicht zuverlässig geprüft werden (Netzwerk, Timeout oder API-Antwort). Kein automatischer Neuversuch.");
  }
}

let cached: {until:number;report:MetaReport}|undefined;
let inFlight:Promise<MetaReport>|undefined;
export async function cachedMetaConnection() {
  if(cached && cached.until>Date.now())return cached.report;
  if(inFlight)return inFlight;
  inFlight=checkMetaConnection(metaConfig()).then(report=>{cached={until:Date.now()+120000,report};return report;}).finally(()=>{inFlight=undefined;});
  return inFlight;
}
export function publicMetaReport(report:MetaReport) {
  // Explicit allowlist: no discovered IDs, identity payloads or raw provider responses.
  return {status:report.status,message:report.message,checkedAt:report.checkedAt,connectionOk:report.connectionOk,
    publishingReadCheck:report.publishingReadCheck,configured:report.configured,steps:report.steps,
    missingPermissions:report.missingPermissions,pageIdResolved:!!report.resolved?.pageId,instagramIdResolved:!!report.resolved?.instagramId,publishingEnabled:false};
}

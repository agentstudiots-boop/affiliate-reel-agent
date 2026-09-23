import type { Database } from "../memory/db";
import { getDatabase } from "../memory/db";
import type { RendererDecision, ProductionFactors } from "../renderers/types";

export type ProductionRow=Record<string,unknown> & {id:string;provider:"faceless"|"runway";renderer_mode:string;renderer_reason:string;script:string;voice_id:string|null;status:string;idempotency_key:string;external_job_id:string|null;external_render_id:string|null;estimated_credits:number|null;actual_credits:number|null;blob_url:string|null};

export function productionRepository(db:Database=getDatabase()){
  return {
    async successfulFacelessVideos(){const r=await db.query("SELECT count(*) AS count FROM production_requests WHERE provider='faceless' AND status='completed' AND blob_url IS NOT NULL",[]);return Number(r.rows[0]?.count || 0);},
    async opportunityCosts(contentJobId:string){const r=await db.query("SELECT COALESCE(sum(actual_cost_cents),0) AS cents FROM production_requests WHERE content_job_id=$1",[contentJobId]);return Number(r.rows[0]?.cents || 0);},
    async create(input:{contentJobId:string;script:string;voiceId:string|null;decision:RendererDecision;factors:ProductionFactors;estimatedCredits:number|null;estimatedCostCents:number|null;affiliateCommission:string|null;approvalPayload:Record<string,unknown>;senderHash:string}){
      return db.transaction(async sql=>{
        const job=await sql.query("SELECT product_id,status FROM content_jobs WHERE id=$1 FOR SHARE",[input.contentJobId]);
        if(!job.rows.length)throw new Error("Content-Job nicht gefunden.");
        if(job.rows[0].status!=="approved")throw new Error("Der Content-Plan muss vor der Produktionsplanung freigegeben sein.");
        const id=crypto.randomUUID(),approvalId=crypto.randomUUID(),now=new Date().toISOString(),key=crypto.randomUUID();
        await sql.query(`INSERT INTO production_requests(id,content_job_id,product_id,provider,renderer_mode,renderer_reason,decision_factors,script,voice_id,estimated_credits,estimated_cost_cents,affiliate_commission,prior_opportunity_cost_cents,status,idempotency_key,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,(SELECT COALESCE(sum(actual_cost_cents),0) FROM production_requests WHERE content_job_id=$2),'awaiting_cost_approval',$13,$14,$14)`,
          [id,input.contentJobId,job.rows[0].product_id,input.decision.provider,input.decision.mode,input.decision.reason,JSON.stringify(input.factors),input.script,input.voiceId,input.estimatedCredits,input.estimatedCostCents,input.affiliateCommission?JSON.stringify({known:input.affiliateCommission}):null,key,now]);
        await sql.query("INSERT INTO approval_requests(id,kind,production_request_id,payload,status,created_at) VALUES($1,'RENDER_COST',$2,$3,'AWAITING_HUMAN_APPROVAL',$4)",[approvalId,id,JSON.stringify(input.approvalPayload),now]);
        if(input.senderHash){
          await sql.query("UPDATE conversation_contexts SET status='closed',updated_at=$2 WHERE sender_hash=$1 AND status='open'",[input.senderHash,now]);
          await sql.query("INSERT INTO conversation_contexts(id,sender_hash,approval_request_id,status,created_at,updated_at) VALUES($1,$2,$3,'open',$4,$4)",[crypto.randomUUID(),input.senderHash,approvalId,now]);
        }
        return {id,approvalId,idempotencyKey:key};
      });
    },
    async get(id:string){const r=await db.query("SELECT * FROM production_requests WHERE id=$1",[id]);return r.rows[0] as ProductionRow|undefined;},
    async approveByApprovalId(approvalId:string,text:string){return db.transaction(async sql=>{
      const a=await sql.query("SELECT production_request_id,status FROM approval_requests WHERE id=$1 AND kind='RENDER_COST' FOR UPDATE",[approvalId]);
      if(!a.rows.length)throw new Error("Freigabeanfrage nicht gefunden.");
      if(a.rows[0].status==="APPROVED")return String(a.rows[0].production_request_id);
      if(a.rows[0].status!=="AWAITING_HUMAN_APPROVAL")throw new Error("Diese Freigabe ist nicht mehr offen.");
      const now=new Date().toISOString();
      await sql.query("UPDATE approval_requests SET status='APPROVED',decision_text=$2,approved_at=$3,decided_at=$3 WHERE id=$1",[approvalId,text,now]);
      await sql.query("UPDATE production_requests SET status='approved',approved_at=$2,updated_at=$2 WHERE id=$1 AND status='awaiting_cost_approval'",[a.rows[0].production_request_id,now]);
      await sql.query("UPDATE conversation_contexts SET status='closed',updated_at=$2 WHERE approval_request_id=$1",[approvalId,now]);
      return String(a.rows[0].production_request_id);
    });},
    async rejectByApprovalId(approvalId:string,text:string){return db.transaction(async sql=>{
      const a=await sql.query("SELECT production_request_id,status FROM approval_requests WHERE id=$1 AND kind='RENDER_COST' FOR UPDATE",[approvalId]);
      if(!a.rows.length || a.rows[0].status!=="AWAITING_HUMAN_APPROVAL")throw new Error("Diese Freigabe ist nicht mehr offen.");
      const now=new Date().toISOString();
      await sql.query("UPDATE approval_requests SET status='REJECTED',decision_text=$2,decided_at=$3 WHERE id=$1",[approvalId,text,now]);
      await sql.query("UPDATE production_requests SET status='rejected',updated_at=$2 WHERE id=$1",[a.rows[0].production_request_id,now]);
      await sql.query("UPDATE conversation_contexts SET status='closed',updated_at=$2 WHERE approval_request_id=$1",[approvalId,now]);
      return String(a.rows[0].production_request_id);
    });},
    async claimStart(id:string){return db.transaction(async sql=>{const r=await sql.query("UPDATE production_requests SET status='starting',attempt_count=attempt_count+1,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 AND status IN ('approved','start_unknown') RETURNING *",[id]);return r.rows[0] as ProductionRow|undefined;});},
    async update(id:string,fields:Record<string,unknown>){const allowed=new Set(["status","external_job_id","external_render_id","provider_asset_url","blob_url","blob_path","actual_credits","actual_cost_cents","error_code","error_message","completed_at"]);const entries=Object.entries(fields).filter(([k])=>allowed.has(k));if(!entries.length)return;const values=entries.map(([,v])=>v);const sets=entries.map(([k],i)=>`${k}=$${i+2}`);await db.query(`UPDATE production_requests SET ${sets.join(",")},updated_at=now() WHERE id=$1`,[id,...values]);},
    async ensureContentApproval(id:string,senderHash:string){return db.transaction(async sql=>{
      const current=await sql.query(`SELECT p.*,j.snapshot FROM production_requests p JOIN content_jobs j ON j.id=p.content_job_id WHERE p.id=$1 FOR UPDATE`,[id]);
      if(!current.rows.length)throw new Error("Produktionsanfrage nicht gefunden.");const row=current.rows[0];
      if(row.status!=="completed"||!row.blob_url)throw new Error("Nur vollständig gespeicherte Videos können vorgelegt werden.");
      if(row.content_version_id){const existing=await sql.query("SELECT a.id AS approval_id,v.id AS content_version_id,v.content FROM content_versions v JOIN approval_requests a ON a.content_version_id=v.id WHERE v.id=$1 ORDER BY a.created_at DESC LIMIT 1",[row.content_version_id]);return existing.rows[0];}
      const snapshot=row.snapshot as {content?:Record<string,unknown>;opportunity?:{product?:{name?:string};targetPlatform?:string}};const base=snapshot.content || {};
      const versionResult=await sql.query("SELECT COALESCE(max(version),0)+1 AS version FROM content_versions WHERE job_id=$1",[row.content_job_id]);const version=Number(versionResult.rows[0].version);
      const versionId=crypto.randomUUID(),approvalId=crypto.randomUUID(),now=new Date().toISOString();
      const content={...base,product:snapshot.opportunity?.product?.name || "Unbekannt",videoUrl:row.blob_url,renderer:row.renderer_mode,actualCredits:row.actual_credits,actualCostCents:row.actual_cost_cents};
      await sql.query("INSERT INTO content_versions(id,job_id,version,format,platform,content,status,created_at) VALUES($1,$2,$3,'video',$4,$5,'awaiting_approval',$6)",[versionId,row.content_job_id,version,snapshot.opportunity?.targetPlatform==="facebook"?"facebook":"instagram",JSON.stringify(content),now]);
      await sql.query("UPDATE production_requests SET content_version_id=$2,updated_at=$3 WHERE id=$1",[id,versionId,now]);
      await sql.query("INSERT INTO approval_requests(id,kind,content_version_id,payload,status,created_at) VALUES($1,'CONTENT_PUBLISH',$2,$3,'AWAITING_HUMAN_APPROVAL',$4)",[approvalId,versionId,JSON.stringify(content),now]);
      if(senderHash){await sql.query("UPDATE conversation_contexts SET status='closed',updated_at=$2 WHERE sender_hash=$1 AND status='open'",[senderHash,now]);await sql.query("INSERT INTO conversation_contexts(id,sender_hash,approval_request_id,status,created_at,updated_at) VALUES($1,$2,$3,'open',$4,$4)",[crypto.randomUUID(),senderHash,approvalId,now]);}
      return {approval_id:approvalId,content_version_id:versionId,content};
    });},
  };
}

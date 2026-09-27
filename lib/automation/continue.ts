import { getDatabase, type Database } from "../memory/db";
import { productionRepository, ProductionConflictError } from "../production/repository";
import { advanceVideo } from "../production/advance";
import { instagramReelRepository, InstagramReelConflict } from "../meta/instagram-reel";
import { InstagramPublishFailure } from "../meta/instagram-publisher";
import { advanceInstagram } from "../meta/advance-instagram";
import { requestVideoCostApproval } from "../production/request-cost-approval";

// A Reel was seen live on Instagram despite an ambiguous local result. Keep
// every unknown Graph write locked until a read-only provider reconciliation.
export async function recoverRunwayPreflightIncident(db: Database = getDatabase()) {
  // Report only state and booleans; never expose a provider URL or token.
  const probe=await db.query(`SELECT p.status,p.publish_attempted_at,
      p.instagram_container_id IS NOT NULL AS has_container,
      p.instagram_media_publish_attempted_at IS NOT NULL AS has_media_publish_attempt,
      p.meta_post_id IS NOT NULL AS has_meta_post,
      p.whatsapp_message_id IS NOT NULL AS has_whatsapp_approval,
      p.decided_at IS NOT NULL AS has_decision,
      r.provider_mode,r.status AS production_status,r.output_url=p.video_url AS video_matches
      FROM publication_requests p LEFT JOIN production_runs r ON r.job_id=p.job_id
      WHERE p.job_id=$1 AND p.platform='instagram' ORDER BY p.revision DESC LIMIT 1`,
    ['9ede14e4-4b2d-4da2-9709-21e74dcc7772']);
  console.info(JSON.stringify({event:'runway_preflight_probe',jobId:'9ede14e4-4b2d-4da2-9709-21e74dcc7772',state:probe.rows[0]||null}));
  return 0;
}

export async function latestInstagramReelStatus(db: Database = getDatabase()) {
  const result=await db.query(`SELECT j.id,r.status AS production_status,p.status AS publication_status,p.permalink
    FROM content_jobs j LEFT JOIN production_runs r ON r.job_id=j.id
    LEFT JOIN LATERAL (SELECT status,permalink FROM publication_requests
      WHERE job_id=j.id AND platform='instagram' ORDER BY revision DESC LIMIT 1) p ON true
    WHERE j.status='approved' AND j.snapshot->'content'->>'format'='video'
      AND j.snapshot->'opportunity'->>'targetPlatform'='instagram'
    ORDER BY j.updated_at DESC LIMIT 1`);
  const row=result.rows[0];
  if(!row)return 'Kein freigegebener Instagram-Reel-Auftrag gefunden.';
  const state=String(row.publication_status||'');
  const production=String(row.production_status||'');
  console.info(JSON.stringify({event:'instagram_reel_status',jobId:row.id,productionStatus:production,publicationStatus:state,hasPermalink:!!row.permalink}));
  if(state==='published')return row.permalink
    ? `Der Instagram-Reel ist veröffentlicht: ${row.permalink}`
    : 'Instagram hat die Veröffentlichung bestätigt; der Beitragslink wird noch abgefragt.';
  if(state==='unknown'||state==='publishing')return 'Der Veröffentlichungsversuch hat einen unklaren Status. Ich prüfe ihn; bitte nicht erneut freigeben. Ein weiterer Veröffentlichungsversuch ist gesperrt, bis der Status geklärt ist.';
  if(state==='processing')return 'Instagram verarbeitet den bereits freigegebenen Reel. Ich frage den Veröffentlichungsstatus weiter ab.';
  if(state==='approved')return 'Deine Veröffentlichungsfreigabe ist gespeichert. Der Reel ist noch nicht als veröffentlicht bestätigt; ich setze den Auftrag fort.';
  if(state==='pending')return 'Das Video ist fertig; die Veröffentlichungsfreigabe steht noch aus. Antworte direkt auf die separate Freigabenachricht.';
  if(production==='ready')return 'Das Video ist fertig; die separate WhatsApp-Veröffentlichungsfreigabe wird vorbereitet.';
  if(production==='rendering')return 'Das Video wird produziert. Eine Veröffentlichung ist noch nicht bestätigt.';
  if(production==='approved_for_spend')return 'Die Kostenfreigabe ist gespeichert; die Produktion wird fortgesetzt.';
  return 'Der Auftrag ist freigegeben. Der nächste Produktionsschritt wird geprüft.';
}

// Only saved, explicit approvals can reach a write. Unknown writes are never
// candidates; rendering GETs always use the already persisted provider ID.
export async function continueReel(jobId: string) {
  const production = productionRepository();
  let run = await production.getByJobId(jobId);
  if (!run || !["FACELESS_STORYBOARD","RUNWAY_SINGLE_CLIP"].includes(run.providerMode)) return;
  if (run.status === "approved_for_spend") await advanceVideo(jobId, "startVideo");
  else if (run.status === "rendering" && run.providerJobId) await advanceVideo(jobId, "pollVideo");
  run = await production.getByJobId(jobId);
  if (run?.status !== "ready") return;
  const publication = await instagramReelRepository().get(jobId);
  if (!publication || (publication.status === "pending" && !publication.whatsappSendAttempted)) {
    await advanceInstagram(jobId, "request");
  } else if (publication.status === "approved") {
    await advanceInstagram(jobId, "publish");
  } else if (publication.status === "processing" || (publication.status === "published" && !publication.permalink)) {
    await advanceInstagram(jobId, "poll");
  }
}

export async function continuePendingReels(db: Database = getDatabase(), advance = continueReel) {
  // Recover a previously approved plan that has never reached the quote stage.
  // This includes approvals processed before WhatsApp-only continuation shipped.
  const unprepared=await db.query(`SELECT j.id FROM content_jobs j
    WHERE j.status='approved' AND j.snapshot->'content'->>'format'='video'
      AND j.snapshot->'opportunity'->>'targetPlatform'='instagram'
      AND j.updated_at > now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM production_runs r WHERE r.job_id=j.id)
      AND EXISTS (SELECT 1 FROM content_approval_requests c WHERE c.job_id=j.id AND c.status='approved' AND c.whatsapp_message_id IS NOT NULL)
    ORDER BY j.updated_at DESC LIMIT 1`);
  for(const row of unprepared.rows){
    try {await requestVideoCostApproval(String(row.id));}
    catch(error){console.warn(JSON.stringify({event:"video_cost_request_blocked",jobId:String(row.id),reason:error instanceof Error?error.message:"unknown"}));}
  }
  const jobs = await db.query(`SELECT r.job_id FROM production_runs r JOIN content_jobs j ON j.id=r.job_id
    LEFT JOIN LATERAL (SELECT status,whatsapp_send_attempted_at,permalink FROM publication_requests
      WHERE job_id=r.job_id AND platform='instagram' ORDER BY revision DESC LIMIT 1) p ON true
    WHERE r.provider_mode IN ('FACELESS_STORYBOARD','RUNWAY_SINGLE_CLIP') AND j.status='approved'
      AND j.snapshot->'opportunity'->>'targetPlatform'='instagram'
      AND (r.status='approved_for_spend' OR (r.status='rendering' AND r.provider_job_id IS NOT NULL)
        OR (r.status='ready' AND (p.status IS NULL
          OR (p.status='pending' AND p.whatsapp_send_attempted_at IS NULL)
          OR p.status IN ('approved','processing') OR (p.status='published' AND p.permalink IS NULL))))
    ORDER BY r.updated_at ASC LIMIT 10`);
  const deadline = Date.now() + 240_000;
  let advanced = 0, blocked = 0;
  for (const row of jobs.rows) {
    if (Date.now() > deadline) break;
    const jobId = String(row.job_id);
    try { await advance(jobId); advanced++; }
    catch (error) {
      blocked++;
      console.warn(JSON.stringify({ event: "reel_continuation_blocked", jobId,
        reason: error instanceof ProductionConflictError || error instanceof InstagramReelConflict ? "gate_or_concurrent_claim" : "provider_or_storage",
        ...(error instanceof InstagramPublishFailure ? {phase:error.phase,detail:error.detail,httpStatus:error.httpStatus,code:error.code,subcode:error.subcode} : {}) }));
    }
  }
  return { considered: jobs.rows.length, advanced, blocked };
}

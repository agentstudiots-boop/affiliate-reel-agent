import { getDatabase, type Database } from "../memory/db";
import { productionRepository, ProductionConflictError } from "../production/repository";
import { advanceVideo } from "../production/advance";
import { instagramReelRepository, InstagramReelConflict } from "../meta/instagram-reel";
import { InstagramPublishFailure } from "../meta/instagram-publisher";
import { advanceInstagram } from "../meta/advance-instagram";
import { requestVideoCostApproval } from "../production/request-cost-approval";

// On 26 September at 20:37 UTC the Runway publication below was claimed and
// rejected by a local Faceless-only URL check before any Instagram POST.
// Reopen only this exact, approved incident; all other unknown writes stay locked.
export async function recoverRunwayPreflightIncident(db: Database = getDatabase()) {
  const result = await db.query(`UPDATE publication_requests p
    SET status='approved',publish_attempted_at=NULL,updated_at=now()
    FROM production_runs r
    WHERE p.job_id=$1 AND p.platform='instagram' AND p.status='unknown'
      AND p.publish_attempted_at >= $2 AND p.publish_attempted_at < $3
      AND p.instagram_container_id IS NULL AND p.instagram_media_publish_attempted_at IS NULL AND p.meta_post_id IS NULL
      AND p.whatsapp_message_id IS NOT NULL AND p.decided_at IS NOT NULL
      AND r.job_id=p.job_id AND r.provider_mode='RUNWAY_SINGLE_CLIP' AND r.status='ready' AND r.output_url=p.video_url
    RETURNING p.id`,['9ede14e4-4b2d-4da2-9709-21e74dcc7772','2026-09-26T20:37:00Z','2026-09-26T20:38:00Z']);
  if(result.rows.length)console.info(JSON.stringify({event:'runway_preflight_recovered',jobId:'9ede14e4-4b2d-4da2-9709-21e74dcc7772'}));
  return result.rows.length;
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
  await recoverRunwayPreflightIncident(db);
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

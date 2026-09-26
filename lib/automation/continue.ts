import { getDatabase, type Database } from "../memory/db";
import { productionRepository, ProductionConflictError } from "../production/repository";
import { advanceVideo } from "../production/advance";
import { instagramReelRepository, InstagramReelConflict } from "../meta/instagram-reel";
import { advanceInstagram } from "../meta/advance-instagram";

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
        reason: error instanceof ProductionConflictError || error instanceof InstagramReelConflict ? "gate_or_concurrent_claim" : "provider_or_storage" }));
    }
  }
  return { considered: jobs.rows.length, advanced, blocked };
}

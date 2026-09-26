import { requireJobProduct } from "../content/product-contract";
import type { ContentJob } from "../content/schema";
import { createHash, randomUUID } from "node:crypto";
import { parseJob } from "../content/history";
import { getDatabase, type Database } from "../memory/db";

export class InstagramReelConflict extends Error {}

export function validReelVideoUrl(value: string, mode: "FACELESS_STORYBOARD" | "RUNWAY_SINGLE_CLIP" = "FACELESS_STORYBOARD") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname.endsWith(".mp4")
      && (mode === "FACELESS_STORYBOARD" ? url.hostname === "exports.faceless.so"
        : /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname) && url.pathname.startsWith("/reels/"));
  } catch { return false; }
}

function reelPublication(job: ContentJob, videoUrl: string) {
  requireJobProduct(job);
  if (job.status !== "approved" || job.content?.format !== "video" || job.opportunity.targetPlatform !== "instagram" || job.marketing?.primary !== "Instagram Reel") throw new InstagramReelConflict("Freigegebener Instagram-Reel-Plan fehlt.");
  const product = job.opportunity.product;
  const caption = `${job.content.caption}\n\n${product.name} · ASIN ${product.asin}\nAffiliate-Produktlink (als Text): ${product.affiliateUrl}`;
  if (caption.length > 2200) throw new InstagramReelConflict("Reel-Text ist für Instagram zu lang.");
  const hash = createHash("sha256").update(JSON.stringify({ jobId: job.id, videoUrl, content: job.content, caption })).digest("hex");
  return { caption, hash };
}

async function checkPublication(sql: Pick<Database, "query">, id: string) {
  const rows = await sql.query("SELECT j.snapshot,p.content_hash,p.caption,p.video_url FROM publication_requests p JOIN content_jobs j ON j.id=p.job_id WHERE p.id=$1 AND p.platform='instagram' FOR UPDATE OF p,j", [id]);
  if (!rows.rows[0]) throw new InstagramReelConflict("product_unresolved");
  const row = rows.rows[0];
  const current = reelPublication(parseJob(row.snapshot), String(row.video_url));
  if (current.hash !== row.content_hash || current.caption !== row.caption) throw new InstagramReelConflict("product_unresolved: Reel oder CTA geändert.");
}

function map(row: Record<string, unknown>) {
  return {
    id: String(row.id), jobId: String(row.job_id), status: String(row.status),
    caption: String(row.caption), videoUrl: String(row.video_url),
    containerId: row.instagram_container_id ? String(row.instagram_container_id) : null,
    mediaId: row.meta_post_id ? String(row.meta_post_id) : null,
    permalink: row.permalink ? String(row.permalink) : null,
    feedback: String(row.feedback || ""),
    whatsappMessageId: row.whatsapp_message_id ? String(row.whatsapp_message_id) : null,
    whatsappSendAttempted: !!row.whatsapp_send_attempted_at,
  };
}

export function instagramReelRepository(db: Database = getDatabase()) {
  return {
    async get(jobId: string) {
      const rows = await db.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='instagram' ORDER BY revision DESC LIMIT 1", [jobId]);
      return rows.rows[0] ? map(rows.rows[0]) : null;
    },
    async prepare(jobId: string, approver: string) {
      if (!/^\d{6,20}$/.test(approver)) throw new InstagramReelConflict("WhatsApp-Empfänger fehlt.");
      return db.transaction(async sql => {
        const rows = await sql.query("SELECT j.snapshot,r.status,r.provider_mode,r.output_url FROM content_jobs j JOIN production_runs r ON r.job_id=j.id WHERE j.id=$1 FOR UPDATE OF j,r", [jobId]);
        const row = rows.rows[0];
        if (!row) throw new InstagramReelConflict("Fertiges Video zu diesem Job fehlt.");
        const job = parseJob(row.snapshot);
        if (job.status !== "approved" || job.content?.format !== "video" || job.opportunity.targetPlatform !== "instagram" || job.marketing?.primary !== "Instagram Reel") {
          throw new InstagramReelConflict("Nur ein freigegebener Instagram-Reel-Plan kann veröffentlicht werden.");
        }
        const videoUrl = String(row.output_url || "");
        if (row.status !== "ready" || !["FACELESS_STORYBOARD","RUNWAY_SINGLE_CLIP"].includes(String(row.provider_mode)) || !validReelVideoUrl(videoUrl,String(row.provider_mode) as "FACELESS_STORYBOARD" | "RUNWAY_SINGLE_CLIP")) {
          throw new InstagramReelConflict("Fertiges öffentliches MP4 des gewählten Produzenten fehlt oder hat eine ungeprüfte URL.");
        }
        const { caption, hash } = reelPublication(job, videoUrl);
        const previous = await sql.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='instagram' ORDER BY revision DESC LIMIT 1 FOR UPDATE", [jobId]);
        if (previous.rows[0]) {
          if (previous.rows[0].content_hash !== hash) throw new InstagramReelConflict("Video oder Text hat sich geändert. Alten Veröffentlichungsversuch nicht wiederverwenden.");
          return map(previous.rows[0]);
        }
        const created = await sql.query("INSERT INTO publication_requests(id,job_id,platform,status,caption,video_url,content_hash,approver_wa_id,revision) VALUES($1,$2,'instagram','pending',$3,$4,$5,$6,1) RETURNING *",
          [randomUUID(), jobId, caption, videoUrl, hash, approver]);
        return map(created.rows[0]);
      });
    },
    async claimWhatsAppSend(id: string) {
      const result = await db.query("UPDATE publication_requests SET whatsapp_send_attempted_at=now() WHERE id=$1 AND platform='instagram' AND status='pending' AND video_url IS NOT NULL AND whatsapp_send_attempted_at IS NULL RETURNING id", [id]);
      if (!result.rows.length) throw new InstagramReelConflict("WhatsApp bereits gesendet oder Ergebnis unklar.");
    },
    async releaseRejectedWhatsAppSend(id: string) {
      const result = await db.query("UPDATE publication_requests SET whatsapp_send_attempted_at=NULL WHERE id=$1 AND platform='instagram' AND status='pending' AND whatsapp_message_id IS NULL AND whatsapp_send_attempted_at IS NOT NULL RETURNING id", [id]);
      if (!result.rows.length) throw new InstagramReelConflict("WhatsApp-Status ist unklar.");
    },
    async bindMessage(id: string, messageId: string) {
      const result = await db.query("UPDATE publication_requests SET whatsapp_message_id=$2,updated_at=now() WHERE id=$1 AND platform='instagram' AND status='pending' AND whatsapp_message_id IS NULL RETURNING *", [id,messageId]);
      if (!result.rows[0]) throw new InstagramReelConflict("WhatsApp-Nachricht konnte nicht zugeordnet werden.");
      return map(result.rows[0]);
    },
    async claimContainer(id: string) {
      return db.transaction(async sql => {
      await checkPublication(sql, id);
      const result = await sql.query(`UPDATE publication_requests p SET status='publishing',publish_attempted_at=now(),updated_at=now()
        WHERE p.id=$1 AND p.platform='instagram' AND p.status='approved' AND p.whatsapp_message_id IS NOT NULL
          AND p.publish_attempted_at IS NULL AND p.video_url IS NOT NULL
          AND EXISTS (SELECT 1 FROM production_runs r WHERE r.job_id=p.job_id AND r.status='ready' AND r.output_url=p.video_url)
        RETURNING *`, [id]);
      if (!result.rows[0]) throw new InstagramReelConflict("Reel nicht freigegeben oder Container bereits angefordert.");
      return map(result.rows[0]);
      });
    },
    async bindContainer(id: string, containerId: string) {
      const result = await db.query("UPDATE publication_requests SET status='processing',instagram_container_id=$2,updated_at=now() WHERE id=$1 AND platform='instagram' AND status='publishing' AND instagram_container_id IS NULL AND instagram_media_publish_attempted_at IS NULL RETURNING *", [id,containerId]);
      if (!result.rows[0]) throw new InstagramReelConflict("Container-Ergebnis ist unklar; keinen neuen Container anlegen.");
      return map(result.rows[0]);
    },
    async claimMediaPublish(id: string) {
      return db.transaction(async sql => {
      await checkPublication(sql, id);
      const result = await sql.query("UPDATE publication_requests SET status='publishing',instagram_media_publish_attempted_at=now(),updated_at=now() WHERE id=$1 AND platform='instagram' AND status='processing' AND instagram_container_id IS NOT NULL AND instagram_media_publish_attempted_at IS NULL AND whatsapp_message_id IS NOT NULL AND decided_at IS NOT NULL RETURNING *", [id]);
      if (!result.rows[0]) throw new InstagramReelConflict("Reel bereits veröffentlicht oder Veröffentlichungsversuch unklar.");
      return map(result.rows[0]);
      });
    },
    async markUnknown(id: string) {
      await db.query("UPDATE publication_requests SET status='unknown',updated_at=now() WHERE id=$1 AND platform='instagram' AND status IN ('publishing','processing')", [id]);
    },
    async markPublished(id: string, mediaId: string) {
      return db.transaction(async sql => {
        const result = await sql.query("UPDATE publication_requests SET status='published',meta_post_id=$2,updated_at=now() WHERE id=$1 AND platform='instagram' AND status='publishing' AND instagram_media_publish_attempted_at IS NOT NULL RETURNING *", [id,mediaId]);
        if (!result.rows[0]) throw new InstagramReelConflict("Instagram-Antwort unklar; kein zweiter Post.");
        await sql.query("INSERT INTO publications(id,job_id,platform,status) VALUES($1,$2,'instagram','draft') ON CONFLICT(job_id,platform) DO NOTHING", [randomUUID(),result.rows[0].job_id]);
        return map(result.rows[0]);
      });
    },
    async setPermalink(id: string, permalink: string) {
      return db.transaction(async sql => {
        const result = await sql.query("UPDATE publication_requests SET permalink=$2,updated_at=now() WHERE id=$1 AND platform='instagram' AND status='published' AND permalink IS NULL RETURNING *", [id,permalink]);
        if (!result.rows[0]) return null;
        await sql.query("UPDATE publications SET url=$2,status='published',published_at=now(),updated_at=now() WHERE job_id=$1 AND platform='instagram' AND status='draft'", [result.rows[0].job_id,permalink]);
        return map(result.rows[0]);
      });
    },
  };
}

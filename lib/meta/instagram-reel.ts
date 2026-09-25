import { createHash, randomUUID } from "node:crypto";
import { parseJob } from "../content/history";
import { getDatabase, type Database } from "../memory/db";

export class InstagramReelConflict extends Error {}

export function validReelVideoUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname === "exports.faceless.so" && url.pathname.endsWith(".mp4");
  } catch { return false; }
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
        if (row.status !== "ready" || row.provider_mode !== "FACELESS_STORYBOARD" || !validReelVideoUrl(videoUrl)) {
          throw new InstagramReelConflict("Fertiges öffentliches Faceless-MP4 fehlt oder hat eine ungeprüfte URL.");
        }
        let link: URL;
        try { link = new URL(job.opportunity.product.affiliateUrl); }
        catch { throw new InstagramReelConflict("Affiliate-Link fehlt."); }
        if (link.protocol !== "https:" || link.username || link.password) throw new InstagramReelConflict("Affiliate-Link ist ungültig.");
        const caption = `${job.content.caption}\n\n${job.opportunity.product.name} ansehen: ${link.href}`;
        if (caption.length > 2200) throw new InstagramReelConflict("Reel-Text ist für Instagram zu lang.");
        const hash = createHash("sha256").update(JSON.stringify({ jobId, videoUrl, content: job.content, caption })).digest("hex");
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
      const result = await db.query(`UPDATE publication_requests p SET status='publishing',publish_attempted_at=now(),updated_at=now()
        WHERE p.id=$1 AND p.platform='instagram' AND p.status='approved' AND p.whatsapp_message_id IS NOT NULL
          AND p.publish_attempted_at IS NULL AND p.video_url IS NOT NULL
          AND EXISTS (SELECT 1 FROM production_runs r WHERE r.job_id=p.job_id AND r.status='ready' AND r.output_url=p.video_url)
        RETURNING *`, [id]);
      if (!result.rows[0]) throw new InstagramReelConflict("Reel nicht freigegeben oder Container bereits angefordert.");
      return map(result.rows[0]);
    },
    async bindContainer(id: string, containerId: string) {
      const result = await db.query("UPDATE publication_requests SET status='processing',instagram_container_id=$2,updated_at=now() WHERE id=$1 AND platform='instagram' AND status='publishing' AND instagram_container_id IS NULL AND instagram_media_publish_attempted_at IS NULL RETURNING *", [id,containerId]);
      if (!result.rows[0]) throw new InstagramReelConflict("Container-Ergebnis ist unklar; keinen neuen Container anlegen.");
      return map(result.rows[0]);
    },
    async claimMediaPublish(id: string) {
      const result = await db.query("UPDATE publication_requests SET status='publishing',instagram_media_publish_attempted_at=now(),updated_at=now() WHERE id=$1 AND platform='instagram' AND status='processing' AND instagram_container_id IS NOT NULL AND instagram_media_publish_attempted_at IS NULL AND whatsapp_message_id IS NOT NULL AND decided_at IS NOT NULL RETURNING *", [id]);
      if (!result.rows[0]) throw new InstagramReelConflict("Reel bereits veröffentlicht oder Veröffentlichungsversuch unklar.");
      return map(result.rows[0]);
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

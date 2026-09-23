import { createHash } from "node:crypto";
import { parseJob } from "../content/history";
import { getDatabase, type Database } from "../memory/db";

export class PublicationConflictError extends Error {}

function publication(row: Record<string, unknown>) {
  return {
    id: String(row.id), jobId: String(row.job_id), platform: "facebook" as const,
    status: String(row.status), caption: String(row.caption), imageUrl: row.image_url ? String(row.image_url) : null,
    whatsappMessageId: row.whatsapp_message_id ? String(row.whatsapp_message_id) : null,
    metaPostId: row.meta_post_id ? String(row.meta_post_id) : null,
    permalink: row.permalink ? String(row.permalink) : null,
    feedback: String(row.feedback || ""),
  };
}

export function publicationRepository(db: Database = getDatabase()) {
  return {
    async get(jobId: string) {
      const result = await db.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='facebook'", [jobId]);
      return result.rows[0] ? publication(result.rows[0]) : null;
    },
    async prepare(jobId: string, approver: string) {
      return db.transaction(async sql => {
        const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new PublicationConflictError("Content-Job fehlt.");
        const job = parseJob(stored.rows[0].snapshot);
        if (job.status !== "approved" || !job.content || !["image", "text"].includes(job.content.format)
          || job.marketing?.primary !== "Facebook Post") throw new PublicationConflictError("Ein freigegebener Bild-/Textentwurf für eine Facebook-Seite fehlt.");
        const source = new URL(job.opportunity.product.affiliateUrl);
        if (source.protocol !== "https:" || source.username || source.password) throw new PublicationConflictError("Affiliate-Link ist nicht sicher.");
        const base = job.content.format === "text" ? job.content.body : job.content.caption;
        const caption = `${base}\n\n${job.content.cta}\n${source}`;
        const contentHash = createHash("sha256").update(JSON.stringify({caption,content:job.content,jobId})).digest("hex");
        const existing = await sql.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='facebook'", [jobId]);
        if (existing.rows[0]) {
          if (existing.rows[0].content_hash !== contentHash) throw new PublicationConflictError("Der Entwurf wurde verändert. Alte Veröffentlichungsfreigabe ist gesperrt.");
          return publication(existing.rows[0]);
        }
        const result = await sql.query(
          "INSERT INTO publication_requests(id,job_id,platform,status,caption,content_hash,approver_wa_id) VALUES($1,$2,'facebook','preparing',$3,$4,$5) RETURNING *",
          [crypto.randomUUID(), jobId, caption, contentHash, approver],
        );
        return publication(result.rows[0]);
      });
    },
    async claimImage(id: string) {
      const result = await db.query("UPDATE publication_requests SET status='unknown',updated_at=now() WHERE id=$1 AND status='preparing' RETURNING job_id", [id]);
      if (!result.rows[0]) throw new PublicationConflictError("Bild wurde bereits angefordert. Ergebnis prüfen, nicht erneut generieren.");
      return String(result.rows[0].job_id);
    },
    async bindImage(id: string, url: string) {
      const result = await db.query("UPDATE publication_requests SET status='pending',image_url=$2,updated_at=now() WHERE id=$1 AND status='unknown' AND image_url IS NULL AND whatsapp_send_attempted_at IS NULL RETURNING *", [id,url]);
      if (!result.rows[0]) throw new PublicationConflictError("Bild konnte nicht zugeordnet werden.");
      return publication(result.rows[0]);
    },
    async claimWhatsAppSend(id: string) {
      const result = await db.query("UPDATE publication_requests SET whatsapp_send_attempted_at=now() WHERE id=$1 AND status='pending' AND image_url IS NOT NULL AND whatsapp_send_attempted_at IS NULL RETURNING id", [id]);
      if (!result.rows[0]) throw new PublicationConflictError("WhatsApp bereits gesendet oder Ergebnis unklar.");
    },
    async bindMessage(id: string, messageId: string) {
      const result = await db.query("UPDATE publication_requests SET whatsapp_message_id=$2,updated_at=now() WHERE id=$1 AND status='pending' AND whatsapp_message_id IS NULL RETURNING *", [id,messageId]);
      if (!result.rows[0]) throw new PublicationConflictError("WhatsApp-Nachricht nicht zugeordnet.");
      return publication(result.rows[0]);
    },
    async claimPublish(id: string) {
      const result = await db.query("UPDATE publication_requests SET status='publishing',publish_attempted_at=now(),updated_at=now() WHERE id=$1 AND status='approved' AND whatsapp_message_id IS NOT NULL AND publish_attempted_at IS NULL AND image_url IS NOT NULL RETURNING *", [id]);
      if (!result.rows[0]) throw new PublicationConflictError("Veröffentlichung nicht freigegeben oder bereits versucht.");
      return publication(result.rows[0]);
    },
    async markUnknown(id: string) {
      await db.query("UPDATE publication_requests SET status='unknown',updated_at=now() WHERE id=$1 AND status='publishing'", [id]);
    },
    async published(id: string, metaPostId: string, permalink: string) {
      return db.transaction(async sql => {
        const result = await sql.query("UPDATE publication_requests SET status='published',meta_post_id=$2,permalink=$3,updated_at=now() WHERE id=$1 AND status='publishing' AND publish_attempted_at IS NOT NULL RETURNING *", [id,metaPostId,permalink]);
        if (!result.rows[0]) throw new PublicationConflictError("Unklarer Veröffentlichungsstatus; keine Wiederholung.");
        await sql.query("INSERT INTO publications(id,job_id,platform,status,url,published_at) VALUES($1,$2,'facebook','published',$3,now()) ON CONFLICT(job_id,platform) DO NOTHING", [crypto.randomUUID(),result.rows[0].job_id,permalink]);
        return publication(result.rows[0]);
      });
    },
  };
}

import { createHash } from "node:crypto";
import { parseJob } from "../content/history";
import { getDatabase, type Database } from "../memory/db";
import { facebookPagePublicationError } from "./publication-eligibility";
import { reviseApprovedStaticContent } from "../content/orchestrator";
import type { OriginalVisualAsset } from "../content/image-provider";
import type { ContentJob } from "../content/schema";

export class PublicationConflictError extends Error {}

function publicationContent(job: ContentJob) {
  const eligibilityError = facebookPagePublicationError(job);
  if (eligibilityError) throw new PublicationConflictError(eligibilityError);
  if (!job.content || job.content.format === "video") throw new PublicationConflictError("Bild- oder Textentwurf fehlt.");
  let source: URL;
  try { source = new URL(job.opportunity.product.affiliateUrl); }
  catch { throw new PublicationConflictError("Affiliate-Link fehlt."); }
  if (source.protocol !== "https:" || source.username || source.password) throw new PublicationConflictError("Affiliate-Link ist nicht sicher.");
  const base = job.content.format === "text" ? job.content.body : job.content.caption;
  const caption = `${base}\n\n${job.content.cta}\n${source}`;
  const hash = createHash("sha256").update(JSON.stringify({caption,content:job.content,jobId:job.id})).digest("hex");
  return { caption, hash };
}

function publication(row: Record<string, unknown>) {
  return {
    id: String(row.id), jobId: String(row.job_id), platform: "facebook" as const,
    status: String(row.status), caption: String(row.caption), imageUrl: row.image_url ? String(row.image_url) : null,
    whatsappMessageId: row.whatsapp_message_id ? String(row.whatsapp_message_id) : null,
    metaPostId: row.meta_post_id ? String(row.meta_post_id) : null,
    permalink: row.permalink ? String(row.permalink) : null,
    feedback: String(row.feedback || ""), revision: Number(row.revision || 1),
    whatsappSendAttempted: !!row.whatsapp_send_attempted_at,
  };
}

export function publicationRepository(db: Database = getDatabase()) {
  return {
    async reconciliationTarget(jobId: string) {
      const result = await db.query(
        "SELECT caption,publish_attempted_at FROM publication_requests WHERE job_id=$1 AND platform='facebook' AND status='unknown' AND publish_attempted_at IS NOT NULL ORDER BY revision DESC LIMIT 1",
        [jobId],
      );
      if (!result.rows[0]) throw new PublicationConflictError("Kein unklarer Facebook-Versuch für diesen Job vorhanden.");
      return { caption: String(result.rows[0].caption), attemptedAt: new Date(result.rows[0].publish_attempted_at as string).toISOString() };
    },
    async reuseUnknownVisual(jobId: string, approver: string) {
      return db.transaction(async sql => {
        const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new PublicationConflictError("Content-Job fehlt.");
        const { hash, caption } = publicationContent(parseJob(stored.rows[0].snapshot));
        const previous = await sql.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='facebook' ORDER BY revision DESC LIMIT 1 FOR UPDATE", [jobId]);
        const row = previous.rows[0];
        if (!row || row.status !== "unknown" || !row.publish_attempted_at || row.content_hash !== hash || !row.image_url) {
          throw new PublicationConflictError("Nur ein ungeklärter Post mit unverändertem Bild kann neu freigegeben werden.");
        }
        const attempts = await sql.query("SELECT count(*)::int AS count FROM publication_requests WHERE job_id=$1 AND platform='facebook' AND publish_attempted_at IS NOT NULL", [jobId]);
        if (Number(attempts.rows[0].count) !== 1) throw new PublicationConflictError("Für diesen Auftrag wurde bereits mehr als ein Veröffentlichungsversuch begonnen.");
        const visual = await sql.query("SELECT status,sha256,image_url FROM original_visual_attempts WHERE job_id=$1 AND content_hash=$2", [jobId, hash]);
        const asset = visual.rows[0];
        let verified = false;
        try {
          const url = new URL(String(row.image_url));
          verified = asset?.status === "media_ready" && asset.image_url === row.image_url && /^[a-f0-9]{64}$/.test(String(asset.sha256))
            && url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com")
            && url.pathname === `/generated/facebook/${jobId}/${asset.sha256}.png`;
        } catch { /* Reject malformed media URLs. */ }
        if (!verified) throw new PublicationConflictError("Das alte Originalbild konnte nicht sicher zugeordnet werden.");
        const result = await sql.query(
          "INSERT INTO publication_requests(id,job_id,platform,status,caption,image_url,content_hash,approver_wa_id,revision) VALUES($1,$2,'facebook','pending',$3,$4,$5,$6,$7) RETURNING *",
          [crypto.randomUUID(), jobId, caption, row.image_url, hash, approver, Number(row.revision) + 1],
        );
        return publication(result.rows[0]);
      });
    },
    async claimVisual(jobId: string, model: string, provider = "openai"): Promise<{ job: ContentJob; existing: null | ReturnType<typeof publication> }> {
      if (!["openai", "replicate"].includes(provider)) throw new PublicationConflictError("Bildprovider ungültig.");
      return db.transaction(async sql => {
        const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new PublicationConflictError("Content-Job fehlt.");
        const job = parseJob(stored.rows[0].snapshot);
        const { hash } = publicationContent(job);
        const existing = await sql.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='facebook' ORDER BY revision DESC LIMIT 1", [jobId]);
        if (existing.rows[0]) {
          if (existing.rows[0].content_hash === hash) {
            if (existing.rows[0].image_url) return { job, existing: publication(existing.rows[0]) };
            throw new PublicationConflictError("Bildversuch bereits begonnen; Ergebnis prüfen, nicht erneut generieren.");
          }
          if (!["changes_requested","rejected"].includes(String(existing.rows[0].status))) {
            throw new PublicationConflictError("Der Entwurf wurde verändert. Alte Veröffentlichungsfreigabe ist gesperrt.");
          }
        }
        const claimed = await sql.query(
          "INSERT INTO original_visual_attempts(job_id,content_hash,provider,model) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING job_id",
          [jobId, hash, provider, model],
        );
        if (!claimed.rows[0]) throw new PublicationConflictError("Bildversuch bereits begonnen; Ergebnis prüfen, nicht erneut generieren.");
        return { job, existing: null };
      });
    },
    async prepareWithVisual(jobId: string, approver: string, asset: OriginalVisualAsset) {
      const expectedPath = asset.sha256 && /^[a-f0-9]{64}$/.test(asset.sha256) ? `/generated/facebook/${jobId}/${asset.sha256}.png` : "";
      let validUrl = false;
      try { const parsed = new URL(asset.url); validUrl = parsed.protocol === "https:" && parsed.hostname.endsWith(".public.blob.vercel-storage.com") && parsed.pathname === expectedPath; }
      catch { /* Invalid asset stays blocked. */ }
      if (!["openai", "replicate"].includes(asset.provider) || asset.mediaType !== "image" || !asset.model || !validUrl) {
        throw new PublicationConflictError("Verifiziertes Originalbild fehlt.");
      }
      return db.transaction(async sql => {
        const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new PublicationConflictError("Content-Job fehlt.");
        const job = parseJob(stored.rows[0].snapshot);
        const { caption, hash } = publicationContent(job);
        const attempt = await sql.query("SELECT * FROM original_visual_attempts WHERE job_id=$1 AND content_hash=$2 FOR UPDATE", [jobId, hash]);
        if (attempt.rows[0]?.status !== "attempted" || attempt.rows[0].model !== asset.model || attempt.rows[0].provider !== asset.provider) {
          throw new PublicationConflictError("Bildversuch fehlt, ist bereits gebunden oder der Entwurf wurde geändert.");
        }
        const previous = await sql.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='facebook' ORDER BY revision DESC LIMIT 1", [jobId]);
        if (previous.rows[0] && !["changes_requested","rejected"].includes(String(previous.rows[0].status))) {
          throw new PublicationConflictError("Alte Veröffentlichungsfreigabe ist gesperrt.");
        }
        const revision = Number(previous.rows[0]?.revision || 0) + 1;
        const result = await sql.query(
          "INSERT INTO publication_requests(id,job_id,platform,status,caption,image_url,content_hash,approver_wa_id,revision) VALUES($1,$2,'facebook','pending',$3,$4,$5,$6,$7) RETURNING *",
          [crypto.randomUUID(), jobId, caption, asset.url, hash, approver, revision],
        );
        await sql.query("UPDATE original_visual_attempts SET status='media_ready',media_ready_at=now(),sha256=$3,image_url=$4,usage=$5 WHERE job_id=$1 AND content_hash=$2",
          [jobId, hash, asset.sha256, asset.url, asset.usage ? JSON.stringify(asset.usage) : null]);
        return publication(result.rows[0]);
      });
    },
    async get(jobId: string) {
      const result = await db.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='facebook' ORDER BY revision DESC LIMIT 1", [jobId]);
      return result.rows[0] ? publication(result.rows[0]) : null;
    },
    async prepare(jobId: string, approver: string) {
      return db.transaction(async sql => {
        const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new PublicationConflictError("Content-Job fehlt.");
        const job = parseJob(stored.rows[0].snapshot);
        const eligibilityError = facebookPagePublicationError(job);
        if (eligibilityError) throw new PublicationConflictError(eligibilityError);
        if (!job.content || job.content.format === "video") throw new PublicationConflictError("Bild- oder Textentwurf fehlt.");
        const source = new URL(job.opportunity.product.affiliateUrl);
        if (source.protocol !== "https:" || source.username || source.password) throw new PublicationConflictError("Affiliate-Link ist nicht sicher.");
        const base = job.content.format === "text" ? job.content.body : job.content.caption;
        const caption = `${base}\n\n${job.content.cta}\n${source}`;
        const contentHash = createHash("sha256").update(JSON.stringify({caption,content:job.content,jobId})).digest("hex");
        const existing = await sql.query("SELECT * FROM publication_requests WHERE job_id=$1 AND platform='facebook' ORDER BY revision DESC LIMIT 1", [jobId]);
        if (existing.rows[0]) {
          if (existing.rows[0].content_hash === contentHash) return publication(existing.rows[0]);
          if (!["changes_requested","rejected"].includes(String(existing.rows[0].status))) {
            throw new PublicationConflictError("Der Entwurf wurde verändert. Alte Veröffentlichungsfreigabe ist gesperrt.");
          }
        }
        const revision = Number(existing.rows[0]?.revision || 0) + 1;
        const result = await sql.query(
          "INSERT INTO publication_requests(id,job_id,platform,status,caption,content_hash,approver_wa_id,revision) VALUES($1,$2,'facebook','preparing',$3,$4,$5,$6) RETURNING *",
          [crypto.randomUUID(), jobId, caption, contentHash, approver, revision],
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
      if (url.includes("/social-cards/")) throw new PublicationConflictError("Preview-Textkarte darf nicht veröffentlicht werden.");
      const result = await db.query("UPDATE publication_requests SET status='pending',image_url=$2,updated_at=now() WHERE id=$1 AND status='unknown' AND image_url IS NULL AND whatsapp_send_attempted_at IS NULL RETURNING *", [id,url]);
      if (!result.rows[0]) throw new PublicationConflictError("Bild konnte nicht zugeordnet werden.");
      return publication(result.rows[0]);
    },
    async claimWhatsAppSend(id: string) {
      const result = await db.query("UPDATE publication_requests SET whatsapp_send_attempted_at=now() WHERE id=$1 AND status='pending' AND image_url IS NOT NULL AND whatsapp_send_attempted_at IS NULL RETURNING id", [id]);
      if (!result.rows[0]) throw new PublicationConflictError("WhatsApp bereits gesendet oder Ergebnis unklar.");
    },
    async releaseRejectedWhatsAppSend(id: string) {
      const result = await db.query(
        "UPDATE publication_requests SET whatsapp_send_attempted_at=NULL,updated_at=now() WHERE id=$1 AND status='pending' AND whatsapp_message_id IS NULL AND whatsapp_send_attempted_at IS NOT NULL RETURNING id",
        [id],
      );
      if (!result.rows[0]) throw new PublicationConflictError("WhatsApp-Versandversuch kann nicht sicher freigegeben werden.");
    },
    async resetWhatsAppSendAfterOperatorConfirmation(jobId: string) {
      const result = await db.query(
        "UPDATE publication_requests SET whatsapp_send_attempted_at=NULL,updated_at=now() WHERE job_id=$1 AND platform='facebook' AND status='pending' AND whatsapp_message_id IS NULL AND whatsapp_send_attempted_at IS NOT NULL RETURNING *",
        [jobId],
      );
      if (!result.rows[0]) throw new PublicationConflictError("Kein bestätigbarer offener WhatsApp-Versandversuch gefunden.");
      return publication(result.rows[0]);
    },
    async bindMessage(id: string, messageId: string) {
      const result = await db.query("UPDATE publication_requests SET whatsapp_message_id=$2,updated_at=now() WHERE id=$1 AND status='pending' AND whatsapp_message_id IS NULL RETURNING *", [id,messageId]);
      if (!result.rows[0]) throw new PublicationConflictError("WhatsApp-Nachricht nicht zugeordnet.");
      return publication(result.rows[0]);
    },
    async reviseRequested(id: string) {
      return db.transaction(async sql => {
        const request = await sql.query("SELECT * FROM publication_requests WHERE id=$1 AND status='changes_requested' FOR UPDATE", [id]);
        if (!request.rows[0] || !String(request.rows[0].feedback || "").trim()) {
          throw new PublicationConflictError("Kein offener Änderungswunsch für diesen Beitrag.");
        }
        const jobId = String(request.rows[0].job_id);
        const stored = await sql.query("SELECT snapshot,event_sequence FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new PublicationConflictError("Content-Job fehlt.");
        const original = parseJob(stored.rows[0].snapshot);
        let revised;
        try {
          revised = await reviseApprovedStaticContent(original, String(request.rows[0].feedback));
        } catch (error) {
          throw new PublicationConflictError(error instanceof Error ? error.message : "Änderung nicht umsetzbar.");
        }
        const previousSequence = Number(stored.rows[0].event_sequence);
        if (previousSequence !== original.events.length) throw new PublicationConflictError("Content-Protokoll wurde zwischenzeitlich geändert.");
        await sql.query("UPDATE content_jobs SET status='awaiting_approval',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",
          [jobId, JSON.stringify(revised), revised.events.length, revised.updatedAt]);
        for (const event of revised.events.filter(item => item.sequence > previousSequence)) {
          await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",
            [jobId,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
        }
        const daily = await sql.query("SELECT day FROM daily_drafts WHERE job_id=$1 FOR UPDATE", [jobId]);
        if (daily.rows[0]) {
          await sql.query(
            "UPDATE daily_drafts SET status='awaiting_approval',feedback='',whatsapp_send_attempted_at=NULL,whatsapp_message_id=NULL,updated_at=now() WHERE job_id=$1",
            [jobId],
          );
        }
        return { job: revised, daily: !!daily.rows[0] };
      });
    },
    async claimPublish(id: string) {
      return db.transaction(async sql => {
      const stored = await sql.query("SELECT j.snapshot,p.content_hash,p.caption FROM publication_requests p JOIN content_jobs j ON j.id=p.job_id WHERE p.id=$1 AND p.platform='facebook' FOR UPDATE OF p,j", [id]);
      if (!stored.rows[0]) throw new PublicationConflictError("product_unresolved");
      const current = publicationContent(parseJob(stored.rows[0].snapshot));
      if (current.hash !== stored.rows[0].content_hash || current.caption !== stored.rows[0].caption) throw new PublicationConflictError("product_unresolved: Freigegebenes Produkt oder Caption geändert.");
      const result = await sql.query("UPDATE publication_requests SET status='publishing',publish_attempted_at=now(),updated_at=now() WHERE id=$1 AND status='approved' AND whatsapp_message_id IS NOT NULL AND publish_attempted_at IS NULL AND image_url IS NOT NULL AND image_url NOT LIKE '%/social-cards/%' RETURNING *", [id]);
      if (!result.rows[0]) throw new PublicationConflictError("Veröffentlichung nicht freigegeben oder bereits versucht.");
      return publication(result.rows[0]);
      });
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

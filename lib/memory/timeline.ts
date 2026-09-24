import { z } from "zod";
import { getDatabase, type Database, type Sql } from "./db";

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const key = z.string().min(1).max(200);
const contentId = z.string().regex(/^cnt_[a-zA-Z0-9_]+$/);
const timestamp = z.string().datetime({ offset: true });
const base = { contentId, source: key, sourceSnapshotId: key, observedAt: timestamp };
export const socialSnapshotSchema = z.object({
  ...base, publicationId: z.string().uuid(), platform: z.enum(["facebook", "instagram"]), externalPostId: key,
  impressions: count.nullish(), reach: count.nullish(), views: count.nullish(), likes: count.nullish(),
  comments: count.nullish(), shares: count.nullish(), saves: count.nullish(),
  profileVisits: count.nullish(), followersDelta: z.number().int().safe().nullish(),
}).refine(v => [v.impressions,v.reach,v.views,v.likes,v.comments,v.shares,v.saves,v.profileVisits,v.followersDelta]
  .some(n => n != null), "Mindestens ein tatsächlich gemessener Wert ist erforderlich.");
export const affiliateSnapshotSchema = z.object({
  ...base, trackingId: key, clicks: count.nullish(), orders: count.nullish(), commissionCents: cents.nullish(),
}).refine(v => [v.clicks,v.orders,v.commissionCents].some(n => n != null), "Mindestens ein Affiliate-Wert ist erforderlich.");
export const priceSnapshotSchema = z.object({
  ...base, productId: key, priceCents: cents, referencePriceCents: cents.nullish(), currency: z.literal("EUR"),
  contentId: contentId.nullish(),
});
export const costEventSchema = z.object({
  contentId, source: key, sourceEventId: key, incurredAt: timestamp,
  kind: z.enum(["production", "api"]), amountCents: cents,
});

// The first observation of a source key wins. Retries with differing data fail instead of rewriting history.
async function append(sql: Sql, table: string, fields: Record<string, unknown>, uniqueKey: string) {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const inserted = await sql.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(",")}) ON CONFLICT DO NOTHING RETURNING id`, values);
  if (inserted.rows.length) return { id: String(inserted.rows[0].id), created: true };
  const existing = await sql.query(`SELECT * FROM ${table} WHERE source=$1 AND ${uniqueKey}=$2`, [fields.source,fields[uniqueKey]]);
  if (!existing.rows.length) throw new Error("Snapshot-Konflikt: gleicher Zeitpunkt oder abweichende Zuordnung.");
  const row = existing.rows[0];
  for (const [column,value] of Object.entries(fields)) {
    if (column === "id") continue;
    const normalized = value instanceof Date ? value.toISOString() : value;
    const stored = row[column] instanceof Date ? (row[column] as Date).toISOString() : row[column];
    if (String(stored ?? "") !== String(normalized ?? "")) throw new Error("Snapshot-Schlüssel bereits mit anderen Daten belegt.");
  }
  return { id: String(row.id), created: false };
}

export function timelineRepository(db: Database = getDatabase()) {
  return {
    async social(raw: z.input<typeof socialSnapshotSchema>) {
      const v = socialSnapshotSchema.parse(raw);
      const fields = { id: crypto.randomUUID(), content_id:v.contentId, publication_id:v.publicationId,
        platform:v.platform, external_post_id:v.externalPostId, source:v.source, source_snapshot_id:v.sourceSnapshotId,
        observed_at:new Date(v.observedAt), impressions:v.impressions ?? null, reach:v.reach ?? null,
        views:v.views ?? null, likes:v.likes ?? null, comments:v.comments ?? null, shares:v.shares ?? null,
        saves:v.saves ?? null, profile_visits:v.profileVisits ?? null, followers_delta:v.followersDelta ?? null };
      return db.transaction(sql => append(sql,"content_performance_snapshots",fields,"source_snapshot_id"));
    },
    async bindAffiliateTracking(content: string, provider: string, trackingId: string) {
      const id = contentId.parse(content), p = key.parse(provider), tracking = key.parse(trackingId);
      await db.transaction(async sql => {
        const job = await sql.query("SELECT id FROM content_jobs WHERE content_id=$1 FOR UPDATE",[id]);
        if (!job.rows.length) throw new Error("Content fehlt.");
        const result = await sql.query(`UPDATE affiliate_tracking SET tracking_id=$3
          WHERE content_id=$1 AND provider=$2 AND (tracking_id IS NULL OR tracking_id=$3)
            AND NOT EXISTS (SELECT 1 FROM publication_requests WHERE job_id=$4)
            AND NOT EXISTS (SELECT 1 FROM publications WHERE job_id=$4 AND status='published')
          RETURNING content_id`,[id,p,tracking,job.rows[0].id]);
        if (!result.rows.length) throw new Error("Tracking-ID bereits anders gebunden oder Content bereits veröffentlicht.");
      });
    },
    async affiliate(raw: z.input<typeof affiliateSnapshotSchema>) {
      const v = affiliateSnapshotSchema.parse(raw);
      return db.transaction(async sql => {
        const binding = await sql.query("SELECT 1 FROM affiliate_tracking WHERE content_id=$1 AND provider=$2 AND tracking_id=$3",[v.contentId,v.source,v.trackingId]);
        if (!binding.rows.length) throw new Error("Kein eindeutiger Affiliate-Trackingcode für diesen Content bestätigt.");
        return append(sql,"affiliate_performance_snapshots",{ id:crypto.randomUUID(),content_id:v.contentId,
          source:v.source,source_snapshot_id:v.sourceSnapshotId,observed_at:new Date(v.observedAt),
          clicks:v.clicks ?? null,orders:v.orders ?? null,commission_cents:v.commissionCents ?? null,
          currency:"EUR" },"source_snapshot_id");
      });
    },
    async price(raw: z.input<typeof priceSnapshotSchema>) {
      const v = priceSnapshotSchema.parse(raw);
      return db.transaction(sql => append(sql,"product_price_history",{id:crypto.randomUUID(),product_id:v.productId,
        content_id:v.contentId ?? null,source:v.source,source_snapshot_id:v.sourceSnapshotId,
        observed_at:new Date(v.observedAt),price_cents:v.priceCents,
        reference_price_cents:v.referencePriceCents ?? null,currency:v.currency},"source_snapshot_id"));
    },
    async cost(raw: z.input<typeof costEventSchema>) {
      const v = costEventSchema.parse(raw);
      return db.transaction(sql => append(sql,"content_cost_events",{id:crypto.randomUUID(),content_id:v.contentId,
        source:v.source,source_event_id:v.sourceEventId,incurred_at:new Date(v.incurredAt),
        kind:v.kind,amount_cents:v.amountCents,currency:"EUR"},"source_event_id"));
    },
    async history(content: string) {
      const id = contentId.parse(content);
      const [social,affiliate,prices,costs] = await Promise.all([
        db.query("SELECT * FROM content_performance_deltas WHERE content_id=$1 ORDER BY observed_at,id",[id]),
        db.query("SELECT * FROM affiliate_performance_deltas WHERE content_id=$1 ORDER BY observed_at,id",[id]),
        db.query("SELECT * FROM product_price_history WHERE content_id=$1 ORDER BY observed_at,id",[id]),
        db.query("SELECT * FROM content_cost_events WHERE content_id=$1 ORDER BY incurred_at,id",[id]),
      ]);
      return { social:social.rows, affiliate:affiliate.rows, prices:prices.rows, costs:costs.rows };
    },
    async economics(content: string) {
      const id = contentId.parse(content);
      const result = await db.query(`WITH latest AS (
        SELECT DISTINCT ON (source) commission_cents,clicks,orders FROM affiliate_performance_snapshots
        WHERE content_id=$1 ORDER BY source,observed_at DESC,id DESC
      ), totals AS (
        SELECT CASE WHEN count(*)>0 AND bool_and(commission_cents IS NOT NULL) THEN sum(commission_cents) END AS revenue,
          CASE WHEN count(*)>0 AND bool_and(clicks IS NOT NULL) THEN sum(clicks) END AS clicks,
          CASE WHEN count(*)>0 AND bool_and(orders IS NOT NULL) THEN sum(orders) END AS orders FROM latest
      ), costs AS (
        SELECT CASE WHEN count(*)>0 THEN sum(amount_cents) END AS cost FROM content_cost_events WHERE content_id=$1
      ) SELECT revenue,clicks,orders,cost,
        CASE WHEN revenue IS NOT NULL AND cost IS NOT NULL THEN revenue-cost END AS profit,
        CASE WHEN revenue IS NOT NULL AND cost>0 THEN (revenue-cost)::numeric/cost END AS roi,
        CASE WHEN revenue IS NOT NULL AND clicks>0 THEN revenue::numeric/clicks END AS revenue_per_click,
        CASE WHEN revenue IS NOT NULL AND cost IS NOT NULL AND clicks>0 THEN (revenue-cost)::numeric/clicks END AS profit_per_click,
        CASE WHEN orders IS NOT NULL AND clicks>0 THEN orders::numeric/clicks END AS conversion_rate
        FROM totals CROSS JOIN costs`,[id]);
      return result.rows[0];
    },
  };
}

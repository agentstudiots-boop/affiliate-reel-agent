import { randomUUID } from "node:crypto";
import type { Sql } from "../memory/db";
import { mergeChances, type ContentChance, type PipelineTarget, type Recommendation } from "./chance";
import { LOCK_DAYS, type JarvisRoute, type LedgerEntry, type RouteStatus } from "./routing";

// Shared research results (content_chances) and Jarvis' routes per pipeline (content_chance_routes, migration 035).
// Idempotent writes only: a chance found again is merged into the stored one; a route is opened at most once per
// chance and pipeline while it is open (unique index), so repeated cron calls never process a chance twice.

type Row = Record<string, unknown>;
const json = <T,>(value: unknown, fallback: T): T => value === null || value === undefined ? fallback : (typeof value === "string" ? JSON.parse(value) : value) as T;
const iso = (value: unknown) => new Date(String(value)).toISOString();

export function chanceFromRow(row: Row): ContentChance {
  return {
    chance_id: String(row.chance_id), concept_key: String(row.concept_key), title: String(row.title), hook: String(row.hook ?? ""),
    origins: (row.origins as ContentChance["origins"]) ?? [], origin_refs: json(row.origin_refs, []), sources: json(row.sources, []),
    detected_at: iso(row.detected_at), valid_until: iso(row.valid_until), scores: json(row.scores, {} as ContentChance["scores"]),
    suitability: Number(row.suitability), recommendation: row.recommendation as Recommendation, recommendation_reasons: json(row.recommendation_reasons, []),
    affiliate_angle: row.affiliate_angle ? String(row.affiliate_angle) : null, topic_angle: row.topic_angle ? String(row.topic_angle) : null,
    product_idea: row.product_idea ? String(row.product_idea) : null, sensitive: !!row.sensitive,
  };
}

export async function recordChances(db: Sql, chances: ContentChance[], now: Date): Promise<ContentChance[]> {
  const stored: ContentChance[] = [];
  for (const chance of mergeChances(chances)) {
    const existing = (await db.query("SELECT * FROM content_chances WHERE chance_id=$1", [chance.chance_id])).rows[0];
    const merged = existing ? mergeChances([chanceFromRow(existing), chance])[0] : chance;
    await db.query(`INSERT INTO content_chances(chance_id,concept_key,title,hook,origins,origin_refs,sources,detected_at,last_seen_at,valid_until,scores,suitability,recommendation,
        recommendation_reasons,affiliate_angle,topic_angle,product_idea,sensitive)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (chance_id) DO UPDATE SET origins=EXCLUDED.origins, origin_refs=EXCLUDED.origin_refs, sources=EXCLUDED.sources, last_seen_at=EXCLUDED.last_seen_at,
        valid_until=EXCLUDED.valid_until, scores=EXCLUDED.scores, suitability=EXCLUDED.suitability, recommendation=EXCLUDED.recommendation,
        recommendation_reasons=EXCLUDED.recommendation_reasons, affiliate_angle=EXCLUDED.affiliate_angle, topic_angle=EXCLUDED.topic_angle,
        product_idea=EXCLUDED.product_idea, sensitive=EXCLUDED.sensitive, updated_at=now()`,
    [merged.chance_id, merged.concept_key, merged.title.slice(0, 200), merged.hook.slice(0, 240), merged.origins, JSON.stringify(merged.origin_refs), JSON.stringify(merged.sources),
      merged.detected_at, now.toISOString(), merged.valid_until, JSON.stringify(merged.scores), merged.suitability, merged.recommendation,
      JSON.stringify(merged.recommendation_reasons), merged.affiliate_angle?.slice(0, 300) ?? null, merged.topic_angle?.slice(0, 300) ?? null,
      merged.product_idea?.slice(0, 90) ?? null, merged.sensitive]);
    stored.push(merged);
  }
  return stored;
}

export async function loadLedger(db: Sql, days = 45): Promise<LedgerEntry[]> {
  const rows = (await db.query(`SELECT r.chance_id, c.concept_key, r.pipeline, r.status, r.updated_at FROM content_chance_routes r
    JOIN content_chances c ON c.chance_id=r.chance_id WHERE r.updated_at > now() - ($1::text || ' days')::interval ORDER BY r.updated_at DESC LIMIT 1000`, [String(days)])).rows;
  return rows.map(row => ({ chance_id: String(row.chance_id), concept_key: String(row.concept_key), pipeline: row.pipeline as PipelineTarget, status: row.status as RouteStatus, at: iso(row.updated_at) }));
}

// Opens the route of one pipeline. An open route older than the pipeline's lock window was never finished (e.g. a
// proposal nobody answered) and expires first. Returns false when the route is already open (no double processing).
export async function openRoute(db: Sql, route: JarvisRoute, pipeline: PipelineTarget, status: "routed" | "consumed", ref: string | null): Promise<boolean> {
  await db.query(`UPDATE content_chance_routes SET status='expired', updated_at=now() WHERE chance_id=$1 AND pipeline=$2 AND status IN ('routed','consumed')
    AND updated_at < now() - ($3::text || ' days')::interval`, [route.chance_id, pipeline, String(LOCK_DAYS[pipeline])]);
  // A pipeline taking up a chance Jarvis offered to it ("routed") turns that open route into its own.
  if (status === "consumed") {
    const taken = await db.query(`UPDATE content_chance_routes SET status='consumed', ref=coalesce($3, ref), priority=$4, updated_at=now()
      WHERE chance_id=$1 AND pipeline=$2 AND status='routed' RETURNING id`, [route.chance_id, pipeline, ref, route.priority]);
    if (taken.rows.length) return true;
  }
  const inserted = await db.query(`INSERT INTO content_chance_routes(id,chance_id,pipeline,status,priority,reasons,ref) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT DO NOTHING RETURNING id`, [randomUUID(), route.chance_id, pipeline, status, route.priority, JSON.stringify(route.reasons.slice(0, 12)), ref]);
  return inserted.rows.length > 0;
}

// Records the outcome of an open route (by chance id or, when only the concept is known, by its stored concept).
export async function closeRoute(db: Sql, input: { chanceId: string; pipeline: PipelineTarget; status: "consumed" | "published" | "rejected"; ref?: string | null }) {
  await db.query(`UPDATE content_chance_routes SET status=$3, ref=coalesce($4, ref), updated_at=now() WHERE chance_id=$1 AND pipeline=$2 AND status IN ('routed','consumed')`,
    [input.chanceId, input.pipeline, input.status, input.ref ?? null]);
}

// Shared research results that are still valid and recommended for a pipeline (newest first).
export async function openChances(db: Sql, now: Date, recommendations: Recommendation[], limit = 20): Promise<ContentChance[]> {
  const rows = (await db.query(`SELECT * FROM content_chances WHERE valid_until > $1 AND recommendation = ANY($2::text[]) ORDER BY last_seen_at DESC, suitability DESC LIMIT $3`,
    [now.toISOString(), recommendations, limit])).rows;
  return rows.map(chanceFromRow);
}

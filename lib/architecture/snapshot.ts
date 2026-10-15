import { getDatabase, type Sql } from "../memory/db";
import { reliablePostUrl } from "../publishing/report";
import { terminalStatuses } from "../content/schema";

// Read-only runtime evidence for the Command Center. Only SELECT statements, no migrations, no writes, no provider or
// messaging calls. Every section is isolated: a missing table or a failing query leaves just that section empty.
// In preview/development the runtime guard refuses the database handle; the snapshot then says so instead of guessing.

export type RuntimeSnapshot = {
  available: boolean;
  reason: string | null;
  generatedAt: string;
  topic: { byStage: Record<string, number>; recent: { contentId: string; title: string; stage: string; format: string; at: string; error: string | null }[];
    lastRun: { outcome: string; at: string; failure: string | null } | null } | null;
  affiliate: { runningJobs: number; pendingContentApprovals: number; pendingPublications: number } | null;
  publications: { platform: string; status: string; url: string | null; at: string; origin: string }[] | null;
  chances: { recent: { chanceId: string; title: string; recommendation: string; suitability: number; at: string }[]; openRoutes: number; last24h: number } | null;
  vision: { checked: number; lastStatus: string | null; lastAt: string | null } | null;
  visualJobs: { kind: string; status: string; at: string }[] | null;
  // "When did it last work?" – newest successful / failed evidence per source (read-only, from existing tables).
  activity: Activity | null;
};
export type ActivityEntry = { lastOkAt: string | null; lastAt: string | null; lastOk: boolean | null; lastError: string | null };
export type Activity = {
  models: Record<string, ActivityEntry>;          // model_calls per agent (migration 037)
  cron: (ActivityEntry & { lastOutcome: string | null }) | null;  // daily_slot_runs (036)
  whatsappInboundAt: string | null;               // whatsapp_events: last message received and processed
  drafts: { lastAt: string | null; lastMode: string | null } | null;     // content_jobs that reached the approval step
  productVerifiedAt: string | null;               // last content job with a verified Amazon product
  contentApprovedAt: string | null;               // last explicit content approval
  chancesSeenAt: string | null;                   // content_chances (035)
  topicRun: { lastOkAt: string | null; lastAt: string | null; lastOutcome: string | null } | null;
  // Affiliate posts (product pipeline): publication_requests (Facebook) and instagram_image_posts (Instagram feed).
  affiliatePublished: { facebook: string | null; instagram: string | null } | null;
};

const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : new Date(0).toISOString();
const clean = (value: unknown, max = 120) => value === null || value === undefined ? null : String(value).replace(/https?:\/\/\S+/g, "[URL]").slice(0, max);

type Readable = Sql & { transaction?: <T>(fn: (sql: Sql) => Promise<T>) => Promise<T> };
// Each section runs in its own READ ONLY transaction where the handle supports transactions: Postgres itself then rejects
// any write, and a failing section (e.g. a table from a not yet applied migration) cannot abort the others.
async function section<T>(db: Readable, work: (sql: Sql) => Promise<T>): Promise<T | null> {
  try {
    if (!db.transaction) return await work(db);
    return await db.transaction(async sql => { await sql.query("SET TRANSACTION READ ONLY"); return work(sql); });
  } catch { return null; }
}

export async function readSnapshot(now = new Date(), open: () => Readable = getDatabase): Promise<RuntimeSnapshot> {
  const empty = { topic: null, affiliate: null, publications: null, chances: null, vision: null, visualJobs: null, activity: null };
  let handle: Readable;
  try { handle = open(); }
  catch (error) {
    const blocked = error instanceof Error && /non_production_effect_blocked/.test(error.message);
    return { available: false, reason: blocked ? "Preview/Entwicklung: Datenbankzugriff durch den Runtime-Guard gesperrt" : "Keine Datenbank erreichbar oder nicht konfiguriert",
      generatedAt: now.toISOString(), ...empty };
  }
  const topic = await section(handle, async db => {
    const stages = (await db.query("SELECT stage, count(*)::int AS n FROM topic_contents GROUP BY stage")).rows;
    const recent = (await db.query(`SELECT content_id, candidate->'candidate'->>'title' AS title, stage, format, updated_at, last_error FROM topic_contents
      ORDER BY updated_at DESC LIMIT 6`)).rows;
    const run = (await db.query("SELECT outcome, created_at, failure FROM topic_runs ORDER BY created_at DESC LIMIT 1")).rows[0];
    return { byStage: Object.fromEntries(stages.map(row => [String(row.stage), Number(row.n)])),
      recent: recent.map(row => ({ contentId: String(row.content_id), title: clean(row.title, 90) ?? "", stage: String(row.stage), format: String(row.format), at: iso(row.updated_at),
        error: row.last_error && row.last_error !== "dry_run" ? clean(row.last_error) : null })),
      lastRun: run ? { outcome: String(run.outcome), at: iso(run.created_at), failure: clean(run.failure) } : null };
  });
  const affiliate = await section(handle, async db => {
    const jobs = (await db.query("SELECT count(*)::int AS n FROM content_jobs WHERE status <> ALL($1::text[]) AND updated_at > now() - interval '1 day'", [terminalStatuses])).rows[0];
    const approvals = (await db.query("SELECT count(*)::int AS n FROM content_approval_requests WHERE status='pending'")).rows[0];
    const publications = (await db.query("SELECT count(*)::int AS n FROM publication_requests WHERE status='pending'")).rows[0];
    return { runningJobs: Number(jobs?.n ?? 0), pendingContentApprovals: Number(approvals?.n ?? 0), pendingPublications: Number(publications?.n ?? 0) };
  });
  const publications = await section(handle, async db => (await db.query(`SELECT platform, status, url, origin, updated_at FROM publish_attempts
      WHERE status IN ('published','processing','failed','unknown') ORDER BY updated_at DESC LIMIT 12`)).rows
    .map(row => ({ platform: String(row.platform), status: String(row.status), url: reliablePostUrl(String(row.platform), row.url ? String(row.url) : null), origin: String(row.origin), at: iso(row.updated_at) })));
  const chances = await section(handle, async db => {
    const recent = (await db.query("SELECT chance_id, title, recommendation, suitability, last_seen_at FROM content_chances ORDER BY last_seen_at DESC LIMIT 6")).rows;
    const counts = (await db.query(`SELECT (SELECT count(*)::int FROM content_chance_routes WHERE status IN ('routed','consumed')) AS open,
      (SELECT count(*)::int FROM content_chances WHERE last_seen_at > now() - interval '1 day') AS day`)).rows[0];
    return { recent: recent.map(row => ({ chanceId: String(row.chance_id), title: clean(row.title, 90) ?? "", recommendation: String(row.recommendation), suitability: Number(row.suitability), at: iso(row.last_seen_at) })),
      openRoutes: Number(counts?.open ?? 0), last24h: Number(counts?.day ?? 0) };
  });
  const vision = await section(handle, async db => {
    const row = (await db.query(`SELECT count(*) FILTER (WHERE quality->'checked'->>'vision' = 'true')::int AS checked,
      (SELECT quality_status FROM image_generation_attempts WHERE quality_status IS NOT NULL ORDER BY updated_at DESC LIMIT 1) AS last_status,
      (SELECT max(updated_at) FROM image_generation_attempts WHERE quality_status IS NOT NULL) AS last_at FROM image_generation_attempts`)).rows[0];
    return { checked: Number(row?.checked ?? 0), lastStatus: row?.last_status ? String(row.last_status) : null, lastAt: row?.last_at ? iso(row.last_at) : null };
  });
  const visualJobs = await section(handle, async db => (await db.query(`SELECT DISTINCT ON (kind) kind, status, updated_at FROM visual_jobs ORDER BY kind, updated_at DESC`)).rows
    .map(row => ({ kind: String(row.kind), status: String(row.status), at: iso(row.updated_at) })));
  const activity = await readActivity(handle);
  const any = [topic, affiliate, publications, chances, vision, visualJobs, activity].some(item => item !== null);
  return { available: any, reason: any ? null : "Keine erfolgreiche Datenbankabfrage; Verbindung oder Tabellen unbekannt", generatedAt: now.toISOString(), topic, affiliate, publications, chances, vision, visualJobs, activity };
}

const at = (value: unknown) => value ? new Date(String(value)).toISOString() : null;

// Each source separately: a missing table (e.g. migration 037 not applied yet) leaves only that entry empty.
async function readActivity(handle: Readable): Promise<Activity | null> {
  const models = await section(handle, async db => Object.fromEntries((await db.query(`SELECT agent, max(created_at) FILTER (WHERE ok) AS last_ok_at, max(created_at) AS last_at,
      (array_agg(ok ORDER BY created_at DESC))[1] AS last_ok, (array_agg(error_class ORDER BY created_at DESC))[1] AS last_error
      FROM model_calls WHERE created_at > now() - interval '30 days' GROUP BY agent`)).rows
    .map(row => [String(row.agent), { lastOkAt: at(row.last_ok_at), lastAt: at(row.last_at), lastOk: row.last_ok === null ? null : row.last_ok === true, lastError: clean(row.last_error, 60) }])));
  const cron = await section(handle, async db => {
    const row = (await db.query(`SELECT max(invoked_at) FILTER (WHERE outcome NOT IN ('error','outside_berlin_slot')) AS last_ok_at, max(invoked_at) AS last_at,
      (array_agg(outcome ORDER BY invoked_at DESC))[1] AS last_outcome, (array_agg(reason ORDER BY invoked_at DESC) FILTER (WHERE outcome='error'))[1] AS last_error
      FROM daily_slot_runs WHERE invoked_at > now() - interval '30 days'`)).rows[0];
    return row ? { lastOkAt: at(row.last_ok_at), lastAt: at(row.last_at), lastOk: row.last_outcome ? row.last_outcome !== "error" : null, lastError: clean(row.last_error, 80), lastOutcome: row.last_outcome ? String(row.last_outcome) : null } : null;
  });
  const whatsapp = await section(handle, async db => at((await db.query("SELECT max(received_at) AS last FROM whatsapp_events")).rows[0]?.last));
  const drafts = await section(handle, async db => {
    const row = (await db.query(`SELECT updated_at, snapshot->>'mode' AS mode FROM content_jobs WHERE status IN ('awaiting_approval','approved') ORDER BY updated_at DESC LIMIT 1`)).rows[0];
    return { lastAt: at(row?.updated_at), lastMode: row?.mode ? String(row.mode) : null };
  });
  const product = await section(handle, async db => at((await db.query(`SELECT max(created_at) AS last FROM content_jobs WHERE opportunity->'product'->>'productVerifiedAt' IS NOT NULL`)).rows[0]?.last));
  const approved = await section(handle, async db => at((await db.query(`SELECT max(decided_at) AS last FROM content_approval_requests WHERE status='approved'`)).rows[0]?.last));
  const chances = await section(handle, async db => at((await db.query("SELECT max(last_seen_at) AS last FROM content_chances")).rows[0]?.last));
  const topicRun = await section(handle, async db => {
    const row = (await db.query(`SELECT max(created_at) FILTER (WHERE outcome <> 'failed') AS last_ok_at, max(created_at) AS last_at,
      (array_agg(outcome ORDER BY created_at DESC))[1] AS last_outcome FROM topic_runs`)).rows[0];
    return row ? { lastOkAt: at(row.last_ok_at), lastAt: at(row.last_at), lastOutcome: row.last_outcome ? String(row.last_outcome) : null } : null;
  });
  const affiliatePublished = await section(handle, async db => {
    const row = (await db.query(`SELECT (SELECT max(updated_at) FROM publication_requests WHERE status='published' AND platform='facebook') AS facebook,
      (SELECT max(updated_at) FROM instagram_image_posts WHERE status='published') AS instagram`)).rows[0];
    return { facebook: at(row?.facebook), instagram: at(row?.instagram) };
  });
  const parts = [models, cron, whatsapp, drafts, product, approved, chances, topicRun, affiliatePublished];
  if (parts.every(item => item === null)) return null;
  return { models: models ?? {}, cron, whatsappInboundAt: whatsapp, drafts, productVerifiedAt: product, contentApprovedAt: approved, chancesSeenAt: chances, topicRun, affiliatePublished };
}

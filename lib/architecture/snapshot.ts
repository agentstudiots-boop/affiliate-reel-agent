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
};

const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : new Date(0).toISOString();
const clean = (value: unknown, max = 120) => value === null || value === undefined ? null : String(value).replace(/https?:\/\/\S+/g, "[URL]").slice(0, max);

async function section<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch { return null; }
}

export async function readSnapshot(now = new Date(), open: () => Sql = getDatabase): Promise<RuntimeSnapshot> {
  const empty = { topic: null, affiliate: null, publications: null, chances: null, vision: null, visualJobs: null };
  let db: Sql;
  try { db = open(); }
  catch (error) {
    const blocked = error instanceof Error && /non_production_effect_blocked/.test(error.message);
    return { available: false, reason: blocked ? "Preview/Entwicklung: Datenbankzugriff durch den Runtime-Guard gesperrt" : "Keine Datenbank erreichbar oder nicht konfiguriert",
      generatedAt: now.toISOString(), ...empty };
  }
  const topic = await section(async () => {
    const stages = (await db.query("SELECT stage, count(*)::int AS n FROM topic_contents GROUP BY stage")).rows;
    const recent = (await db.query(`SELECT content_id, candidate->'candidate'->>'title' AS title, stage, format, updated_at, last_error FROM topic_contents
      ORDER BY updated_at DESC LIMIT 6`)).rows;
    const run = (await db.query("SELECT outcome, created_at, failure FROM topic_runs ORDER BY created_at DESC LIMIT 1")).rows[0];
    return { byStage: Object.fromEntries(stages.map(row => [String(row.stage), Number(row.n)])),
      recent: recent.map(row => ({ contentId: String(row.content_id), title: clean(row.title, 90) ?? "", stage: String(row.stage), format: String(row.format), at: iso(row.updated_at),
        error: row.last_error && row.last_error !== "dry_run" ? clean(row.last_error) : null })),
      lastRun: run ? { outcome: String(run.outcome), at: iso(run.created_at), failure: clean(run.failure) } : null };
  });
  const affiliate = await section(async () => {
    const jobs = (await db.query("SELECT count(*)::int AS n FROM content_jobs WHERE status <> ALL($1::text[]) AND updated_at > now() - interval '1 day'", [terminalStatuses])).rows[0];
    const approvals = (await db.query("SELECT count(*)::int AS n FROM content_approval_requests WHERE status='pending'")).rows[0];
    const publications = (await db.query("SELECT count(*)::int AS n FROM publication_requests WHERE status='pending'")).rows[0];
    return { runningJobs: Number(jobs?.n ?? 0), pendingContentApprovals: Number(approvals?.n ?? 0), pendingPublications: Number(publications?.n ?? 0) };
  });
  const publications = await section(async () => (await db.query(`SELECT platform, status, url, origin, updated_at FROM publish_attempts
      WHERE status IN ('published','processing','failed','unknown') ORDER BY updated_at DESC LIMIT 12`)).rows
    .map(row => ({ platform: String(row.platform), status: String(row.status), url: reliablePostUrl(String(row.platform), row.url ? String(row.url) : null), origin: String(row.origin), at: iso(row.updated_at) })));
  const chances = await section(async () => {
    const recent = (await db.query("SELECT chance_id, title, recommendation, suitability, last_seen_at FROM content_chances ORDER BY last_seen_at DESC LIMIT 6")).rows;
    const counts = (await db.query(`SELECT (SELECT count(*)::int FROM content_chance_routes WHERE status IN ('routed','consumed')) AS open,
      (SELECT count(*)::int FROM content_chances WHERE last_seen_at > now() - interval '1 day') AS day`)).rows[0];
    return { recent: recent.map(row => ({ chanceId: String(row.chance_id), title: clean(row.title, 90) ?? "", recommendation: String(row.recommendation), suitability: Number(row.suitability), at: iso(row.last_seen_at) })),
      openRoutes: Number(counts?.open ?? 0), last24h: Number(counts?.day ?? 0) };
  });
  const vision = await section(async () => {
    const row = (await db.query(`SELECT count(*) FILTER (WHERE quality->'checked'->>'vision' = 'true')::int AS checked,
      (SELECT quality_status FROM image_generation_attempts WHERE quality_status IS NOT NULL ORDER BY updated_at DESC LIMIT 1) AS last_status,
      (SELECT max(updated_at) FROM image_generation_attempts WHERE quality_status IS NOT NULL) AS last_at FROM image_generation_attempts`)).rows[0];
    return { checked: Number(row?.checked ?? 0), lastStatus: row?.last_status ? String(row.last_status) : null, lastAt: row?.last_at ? iso(row.last_at) : null };
  });
  const visualJobs = await section(async () => (await db.query(`SELECT DISTINCT ON (kind) kind, status, updated_at FROM visual_jobs ORDER BY kind, updated_at DESC`)).rows
    .map(row => ({ kind: String(row.kind), status: String(row.status), at: iso(row.updated_at) })));
  const any = [topic, affiliate, publications, chances, vision, visualJobs].some(item => item !== null);
  return { available: any, reason: any ? null : "Datenbank erreichbar, aber keine lesbaren Tabellen", generatedAt: now.toISOString(), topic, affiliate, publications, chances, vision, visualJobs };
}

import type { Sql } from "../memory/db";
import type { TopicGateVerdict } from "./gate";
import type { TopicHistoryEntry, TopicHistoryStatus } from "./history";
import type { ScoutResult, TopicCandidate } from "./schema";

// Persistence for topic runs, candidates (with gate verdicts) and topic history. Idempotent writes only.

export async function loadTopicHistory(db: Sql, days = 30): Promise<TopicHistoryEntry[]> {
  const result = await db.query(`SELECT topic_id, concept_key, title, hook, audience_problem, status, at
    FROM topic_history WHERE at > now() - ($1::text || ' days')::interval ORDER BY at DESC LIMIT 500`, [String(days)]);
  return result.rows.map(row => ({ topic_id: String(row.topic_id), concept_key: String(row.concept_key), title: String(row.title), hook: String(row.hook),
    audience_problem: String(row.audience_problem ?? ""), status: row.status as TopicHistoryStatus, at: new Date(String(row.at)).toISOString() }));
}

export async function recordTopicHistory(db: Sql, candidate: Pick<TopicCandidate, "topic_id" | "concept_key" | "title" | "hook" | "audience_problem">,
  status: TopicHistoryStatus, origin: string) {
  await db.query(`INSERT INTO topic_history(topic_id,concept_key,title,hook,audience_problem,status,origin) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (topic_id,status,origin) DO NOTHING`, [candidate.topic_id, candidate.concept_key, candidate.title.slice(0, 200), candidate.hook.slice(0, 200),
    candidate.audience_problem.slice(0, 300), status, origin.slice(0, 120)]);
}

// Claims a slot (e.g. "2026-10-05:morning") before any work: a repeated cron call for the same slot does nothing.
export async function claimTopicRun(db: Sql, runId: string, slotKey: string | null, startedAt: string): Promise<boolean> {
  const claimed = await db.query(`INSERT INTO topic_runs(id,slot_key,started_at,outcome) VALUES($1,$2,$3,'no_candidates')
    ON CONFLICT DO NOTHING RETURNING id`, [runId, slotKey, startedAt]);
  return claimed.rows.length > 0;
}

export async function saveTopicRun(db: Sql, runId: string, result: ScoutResult | null, verdicts: TopicGateVerdict[], candidates: TopicCandidate[],
  selected: TopicCandidate | null, failure: string | null) {
  await db.query(`UPDATE topic_runs SET outcome=$2, source_health=$3, candidate_count=$4, selected_topic_id=$5, dropped=$6, duration_ms=$7, failure=$8 WHERE id=$1`,
    [runId, result ? result.outcome : "failed", JSON.stringify(result?.sourceHealth ?? []), candidates.length, selected?.topic_id ?? null,
      JSON.stringify(result?.dropped ?? []), result?.durationMs ?? 0, failure]);
  for (const candidate of candidates) {
    const verdict = verdicts.find(item => item.topic_id === candidate.topic_id);
    if (!verdict) continue;
    await db.query(`INSERT INTO topic_candidates(run_id,topic_id,trend_type,title,relevance_score,risk_score,decision,candidate,gate)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (run_id,topic_id) DO UPDATE SET decision=EXCLUDED.decision, candidate=EXCLUDED.candidate, gate=EXCLUDED.gate`,
      [runId, candidate.topic_id, candidate.trend_type, candidate.title, candidate.relevance_score, candidate.risk_score, verdict.decision, JSON.stringify(candidate), JSON.stringify(verdict)]);
  }
}

export async function latestTopicRun(db: Sql) {
  const result = await db.query(`SELECT r.id, r.outcome, r.source_health, r.candidate_count, r.selected_topic_id, r.failure, r.created_at,
      (SELECT title FROM topic_candidates c WHERE c.run_id=r.id AND c.topic_id=r.selected_topic_id) AS selected_title,
      (SELECT max(created_at) FROM topic_runs WHERE outcome IN ('success','degraded','offline_fallback')) AS last_success
    FROM topic_runs r ORDER BY r.created_at DESC LIMIT 1`);
  return result.rows[0] ?? null;
}

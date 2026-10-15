import type { Sql } from "../memory/db";
import { monthlyBudgetCredits, RUNWAY_ESTIMATED_CREDITS } from "../runway";

// Called inside the SAME transaction as the reservation/claim, by both video pipelines.
// Failed/unknown creations remain spent. No provider calls while holding the lock.
export async function reserveRunwayBudget(sql: Sql, month: string, credits: number): Promise<boolean> {
  await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`runway-budget:${month}`]);
  if (!Number.isSafeInteger(credits) || credits <= 0 || credits > monthlyBudgetCredits()) return false;
  const row = (await sql.query(`SELECT
    (SELECT COALESCE(sum(estimated_provider_credits),0) FROM production_runs
      WHERE provider_mode='RUNWAY_SINGLE_CLIP' AND provider_request_attempted_at >= ($1 || '-01')::date
        AND provider_request_attempted_at < ($1 || '-01')::date + interval '1 month') AS product_credits,
    (SELECT count(*) FROM provider_usage WHERE provider='runway' AND month=$1) AS topic_jobs`, [month])).rows[0];
  const spent = Number(row?.product_credits ?? 0) + Number(row?.topic_jobs ?? 0) * RUNWAY_ESTIMATED_CREDITS;
  return Number.isFinite(spent) && spent + credits <= monthlyBudgetCredits();
}

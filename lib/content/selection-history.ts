import type { Sql } from "../memory/db";
import { functionalGroup, type SelectionHistory } from "./strategy";

type Row = { name: string | null; concept: string | null };
const toEntry = (row: Row) => ({ group: row.name ? functionalGroup(row.name) : null, concept: row.concept, name: row.name });

// Read-only. A rejection teaches more than the ASIN: the product's functional group and content
// concept weigh on similar candidates for the 7-day cooldown. System-internal rejections
// (provider errors, category changes, superseded text versions) are not operator judgement.
export async function loadSelectionHistory(db: Sql): Promise<SelectionHistory> {
  const rejected = await db.query(`
    SELECT j.opportunity->'product'->>'name' AS name, j.opportunity->'contentChance'->'chance'->>'concept' AS concept
    FROM content_jobs j
    WHERE j.created_at>now()-interval '7 days' AND (
      j.status='rejected'
      OR EXISTS(SELECT 1 FROM daily_drafts d WHERE d.job_id=j.id AND (d.status='rejected' OR d.feedback='replaced_by_operator'))
      OR EXISTS(SELECT 1 FROM content_approval_requests a WHERE a.job_id=j.id AND a.status='rejected'
        AND a.feedback NOT IN ('provider_rejected','category_changed') AND a.feedback NOT LIKE 'Durch neue%'))`);
  const recent = await db.query(`
    SELECT j.opportunity->'product'->>'name' AS name, j.opportunity->'contentChance'->'chance'->>'concept' AS concept
    FROM content_jobs j
    WHERE j.created_at>now()-interval '7 days' AND j.status NOT IN ('failed','rejected','needs_input','interrupted')`);
  return { rejected: rejected.rows.map(row => toEntry(row as Row)), recent: recent.rows.map(row => toEntry(row as Row)) };
}

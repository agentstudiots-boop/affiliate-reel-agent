import type { Database } from "../memory/db";

// Operator wording such as "Finde ein Artikel Silpat Matte, dann passt die Produktbeschreibung"
// or "Finde stattdessen eine Silpat Backmatte" asks to replace the open draft's product.
export type ReplacementRequest = { search?: string };
const STOP = /\s+(?:dann|damit|weil|sodass|so\s+dass|denn|da|und\s+dann|der|die|das|bei\s+dem|welche[rsm]?)\b|[,;.!:]/i;

export function replacementRequest(body: string): ReplacementRequest | null {
  const text = body.trim().replace(/\s+/g, " ");
  if (!text || text.endsWith("?") || /https?:\/\//i.test(text) || text.length > 400) return null;
  if (/\b(?:freigeben|freigabe|ablehnen|abgelehnt|bild|text|caption|beitragstext)\b/i.test(text) && !/\b(?:artikel|produkt)\b/i.test(text)) return null;
  const find = text.match(/\b(?:finde|suche|such|nimm|nimm\s+lieber)\s+(?:mir\s+)?(?:stattdessen\s+)?(?:ein(?:en|e|em)?\s+)?(?:anderen?\s+|neuen?\s+)?(?:artikel|produkt)\s+(.+)$/i);
  const findInstead = text.match(/\b(?:finde|suche|such|nimm)\s+(?:mir\s+)?stattdessen\s+(?:ein(?:en|e|em)?\s+)?(.+)$/i);
  const other = /\b(?:ein\s+)?ander(?:es|en)\s+(?:artikel|produkt)\b/i.test(text)
    || /\b(?:beschreibung|produktbeschreibung)\s+(?:passt|stimmt)\s+nicht\b/i.test(text)
    || /\bpasst\s+nicht\s+zum\s+(?:artikel|produkt)\b/i.test(text);
  const raw = find?.[1] ?? findInstead?.[1];
  if (raw) {
    const term = raw.split(STOP)[0].replace(/^(?:namens|wie|von|nach|mit\s+dem\s+namen)\s+/i, "").trim();
    if (term.length >= 3 && term.length <= 90 && term.split(" ").length <= 6 && /^[\p{L}\p{N}][\p{L}\p{N}\s.,+&-]*$/u.test(term)
      && !/^(?:artikel|produkt|das|der|die|eins|etwas)$/i.test(term)) return { search: term };
  }
  return other || find || findInstead ? {} : null;
}

// Stops the open draft the operator is replacing (like „Ablehnen“): content stage or a not yet
// attempted publication request. The exact ASIN stays locked for seven days so it is not offered
// again right away; only the family lock is released so a similar but different product can follow.
export async function supersedeOpenDraft(db: Database, replyToMessageId: string | null, jobId: string | null = null) {
  return db.transaction(async sql => {
    const open = await sql.query(`SELECT j.id AS job_id,j.snapshot->'opportunity'->'product'->>'name' AS name
      FROM content_jobs j
      LEFT JOIN daily_drafts d ON d.job_id=j.id AND d.status IN ('awaiting_approval','changes_requested') AND d.whatsapp_message_id IS NOT NULL
      LEFT JOIN publication_requests p ON p.job_id=j.id AND p.platform='facebook' AND p.status IN ('pending','changes_requested')
        AND p.whatsapp_message_id IS NOT NULL AND p.publish_attempted_at IS NULL
      WHERE (d.job_id IS NOT NULL OR p.job_id IS NOT NULL) AND j.status IN ('awaiting_approval','approved')
        AND j.updated_at>now()-interval '36 hours'
        AND ($2::text IS NULL OR j.id::text=$2)
        AND ($1::text IS NULL OR d.whatsapp_message_id=$1 OR p.whatsapp_message_id=$1)
      ORDER BY j.updated_at DESC LIMIT 1 FOR UPDATE OF j`, [replyToMessageId, jobId]);
    const row = open.rows[0];
    if (!row) return null;
    const id = String(row.job_id);
    await sql.query("UPDATE daily_drafts SET status='needs_input',feedback='replaced_by_operator',updated_at=now() WHERE job_id=$1 AND status IN ('awaiting_approval','changes_requested','content_approved')", [id]);
    await sql.query("UPDATE publication_requests SET status='rejected',feedback='replaced_by_operator',decided_at=now(),updated_at=now() WHERE job_id=$1 AND status IN ('preparing','pending','changes_requested') AND publish_attempted_at IS NULL", [id]);
    await sql.query("UPDATE content_jobs SET status='needs_input',updated_at=now() WHERE id=$1", [id]);
    await sql.query("UPDATE content_approval_requests SET status='rejected',feedback='replaced_by_operator',decided_at=now() WHERE job_id=$1 AND status='pending'", [id]);
    await sql.query("DELETE FROM product_selection_locks WHERE job_id=$1 AND key LIKE 'family:%'", [id]);
    return { jobId: id, name: String(row.name || "") };
  });
}

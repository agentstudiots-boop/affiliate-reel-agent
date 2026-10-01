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

// Stops the open draft the operator is replacing. Only drafts still waiting for the
// content approval qualify; anything further along keeps its own approval gates.
export async function supersedeOpenDraft(db: Database, replyToMessageId: string | null) {
  return db.transaction(async sql => {
    const open = await sql.query(`SELECT d.job_id,j.snapshot->'opportunity'->'product'->>'name' AS name
      FROM daily_drafts d JOIN content_jobs j ON j.id=d.job_id
      WHERE d.status IN ('awaiting_approval','changes_requested') AND d.whatsapp_message_id IS NOT NULL
        AND d.created_at>now()-interval '36 hours' AND j.status='awaiting_approval'
        AND ($1::text IS NULL OR d.whatsapp_message_id=$1)
      ORDER BY d.created_at DESC LIMIT 1 FOR UPDATE OF d`, [replyToMessageId]);
    const row = open.rows[0];
    if (!row) return null;
    const jobId = String(row.job_id);
    await sql.query("UPDATE daily_drafts SET status='needs_input',feedback='replaced_by_operator',updated_at=now() WHERE job_id=$1", [jobId]);
    await sql.query("UPDATE content_jobs SET status='needs_input',updated_at=now() WHERE id=$1", [jobId]);
    await sql.query("UPDATE content_approval_requests SET status='rejected',feedback='replaced_by_operator',decided_at=now() WHERE job_id=$1 AND status='pending'", [jobId]);
    await sql.query("DELETE FROM product_selection_locks WHERE job_id=$1", [jobId]);
    return { jobId, name: String(row.name || "") };
  });
}

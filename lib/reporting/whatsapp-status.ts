import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";

export async function latestImagePostsStatus(db: Database) {
  await ensureAutomationSchema(db);
  const result = await db.query(`SELECT d.day::text AS day, d.slot, d.status,
      d.scout_report->>'reason' AS reason,
      j.snapshot->'opportunity'->'product'->>'name' AS product,
      j.snapshot->'review'->>'passed' AS review_passed,
      j.snapshot->'review'->'issues'->>0 AS review_issue,
      j.snapshot->>'error' AS job_error,
      p.status AS publication_status, p.permalink
    FROM daily_drafts d LEFT JOIN content_jobs j ON j.id=d.job_id
    LEFT JOIN LATERAL (SELECT status,permalink FROM publication_requests
      WHERE job_id=d.job_id AND platform='facebook' ORDER BY revision DESC LIMIT 1) p ON true
    ORDER BY d.created_at DESC LIMIT 5`);
  if (!result.rows.length) return "Noch kein Bildpost-Auftrag gespeichert.";
  return result.rows.map(row => {
    const slot = row.slot === "morning" ? "Vormittag" : row.slot === "afternoon" ? "Nachmittag" : "auf Anfrage";
    const state = row.publication_status || row.status;
    const knownReason = ({
      amazon_verification_blocked: "Amazon hat die Produktprüfung blockiert",
      product_unresolved: "keine verifizierte Produktseite gefunden",
      product_repeat_blocked: "Produkt in den letzten sieben Tagen verwendet",
    } as Record<string, string>)[String(row.reason || "")];
    const reviewIssue = String(row.review_issue || "").replace(/\s+/g, " ").slice(0, 160);
    const reason = state === "needs_input" ? knownReason
      || (row.review_passed === "false" ? `redaktionelle Prüfung: ${reviewIssue || "nicht bestanden"}` : undefined)
      || (row.job_error ? "Content-Planung abgebrochen" : undefined) : undefined;
    return `${row.day} ${slot} · ${String(row.product || "Produktsuche").slice(0, 70)}: ${state}${reason ? ` (${reason})` : ""}${row.permalink ? ` · ${row.permalink}` : ""}`;
  }).join("\n");
}

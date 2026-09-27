import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";

export async function latestImagePostsStatus(db: Database) {
  await ensureAutomationSchema(db);
  const result = await db.query(`SELECT d.day::text AS day, d.slot, d.status,
      j.snapshot->'opportunity'->'product'->>'name' AS product,
      p.status AS publication_status, p.permalink
    FROM daily_drafts d LEFT JOIN content_jobs j ON j.id=d.job_id
    LEFT JOIN LATERAL (SELECT status,permalink FROM publication_requests
      WHERE job_id=d.job_id AND platform='facebook' ORDER BY revision DESC LIMIT 1) p ON true
    ORDER BY d.created_at DESC LIMIT 5`);
  if (!result.rows.length) return "Noch kein Bildpost-Auftrag gespeichert.";
  return result.rows.map(row => {
    const slot = row.slot === "morning" ? "Vormittag" : row.slot === "afternoon" ? "Nachmittag" : "auf Anfrage";
    const state = row.publication_status || row.status;
    return `${row.day} ${slot} · ${String(row.product || "Produktsuche").slice(0, 70)}: ${state}${row.permalink ? ` · ${row.permalink}` : ""}`;
  }).join("\n");
}

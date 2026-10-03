import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { berlinClock, SLOT_WINDOWS, type DailySlot } from "../daily/slots";

export async function latestImagePostsStatus(db: Database) {
  await ensureAutomationSchema(db);
  const result = await db.query(`SELECT d.day::text AS day, d.slot, d.status,
      d.scout_report->>'reason' AS reason, d.scout_report->>'detail' AS detail,
      d.whatsapp_message_id IS NOT NULL OR d.notification_message_id IS NOT NULL AS delivered,
      COALESCE(d.scout_report->'report'->'trend'->>'outcome', d.scout_report->'report'->'trend'->>'source') AS trend_outcome,
      d.scout_report->'report'->'trend'->>'failure' AS trend_failure,
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
  const today = berlinClock(new Date());
  const missing = (Object.keys(SLOT_WINDOWS) as DailySlot[]).filter(name => today.hour >= SLOT_WINDOWS[name].from
    && !result.rows.some(row => String(row.day) === today.day && row.slot === name))
    .map(name => `Heute ${name === "morning" ? "Vormittag" : "Nachmittag"}: kein Lauf registriert (Cron nicht angekommen oder noch nicht gelaufen).`);
  const lines = result.rows.map(row => {
    const slot = row.slot === "morning" ? "Vormittag" : row.slot === "afternoon" ? "Nachmittag" : "auf Anfrage";
    const state = row.publication_status || row.status;
    const knownReason = ({
      amazon_verification_blocked: "Amazon hat die Produktprüfung blockiert",
      amazon_identity_missing: "Amazon-Seite ohne eindeutigen ASIN-Nachweis",
      product_unresolved: "keine verifizierte Produktseite gefunden",
      product_repeat_blocked: "Produkt in den letzten sieben Tagen verwendet",
      publication_gate_failed: `Entwurf nicht freigabefähig: ${String(row.detail || "Prüfung fehlgeschlagen").replace(/\s+/g, " ").slice(0, 120)}`,
      missing_caption: "Beitragstext fehlt",
      editorial_rate_limited: "Redaktionsmodell ausgelastet",
      editorial_model_failed: "Redaktionsmodell nicht erreichbar",
      content_review_failed: `redaktionelle Prüfung: ${String(row.detail || "nicht bestanden").replace(/\s+/g, " ").slice(0, 120)}`,
      product_data_uncertain: `Produktdaten reichen für sichere Aussagen nicht aus: ${String(row.detail || "").replace(/\s+/g, " ").slice(0, 140)}`,
      marketing_format_mismatch: "Marketingformat passte nicht zum Inhalt",
      no_quality_candidate: "kein Kandidat mit ausreichender Content-Chance; bewusst kein Vorschlag",
      strategic_gate_rejected: `strategisch verworfen (Reichweite/Vertrauen): ${String(row.detail || "").replace(/\s+/g, " ").slice(0, 140)}`,
      planning_failed: "Content-Planung nicht abgeschlossen",
    } as Record<string, string>)[String(row.reason || "")];
    const reviewIssue = String(row.review_issue || "").replace(/\s+/g, " ").slice(0, 160);
    const reason = state === "needs_input" ? knownReason
      || (row.review_passed === "false" ? `redaktionelle Prüfung: ${reviewIssue || "nicht bestanden"}` : undefined)
      || (row.job_error ? "Content-Planung abgebrochen" : undefined) : undefined;
    const undelivered = row.status === "awaiting_approval" && row.delivered === false && !row.publication_status
      ? " (Entwurf gespeichert, aber noch nicht zugestellt: WhatsApp erlaubt Freitext nur 24 h nach deiner letzten Nachricht – schreib mir kurz, dann sende ich ihn)" : "";
    const trend = row.slot !== "morning" && row.slot !== "afternoon" ? "" : row.trend_outcome
      ? ` · Trend-Agent: ${["success", "trend_agent"].includes(String(row.trend_outcome)) ? "ok" : row.trend_outcome === "no_candidate" ? "keine geeignete Chance" : `Fallback auf Standardideen (${String(row.trend_failure || row.trend_outcome)})`}` : "";
    return `${row.day} ${slot} · ${String(row.product || "Produktsuche").slice(0, 70)}: ${state}${reason ? ` (${reason})` : ""}${undelivered}${trend}${row.permalink ? ` · ${row.permalink}` : ""}`;
  });
  return [...missing, ...lines].join("\n");
}

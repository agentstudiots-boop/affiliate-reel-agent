import { capabilityLines } from "../capabilities";
import type { Database } from "../memory/db";
import type { MasterContent } from "../distribution/master-content";
import type { PlatformVariant } from "../distribution/platforms/adapters";
import { liveTopicPublishingEnabled, storedOutcomes } from "../distribution/publish";
import { PLATFORM_LABEL, type Platform } from "../formats/catalog";
import { reliablePostUrl } from "../publishing/report";
import { latestTopicRun } from "../topics/repository";
import type { SourceHealth } from "../topics/schema";
import { providerAvailability } from "../visual/availability";
import type { RenderContext } from "../visual/renderers";

// Human-readable health summary for the WhatsApp "Status" command. No raw logs, no secrets, no IDs beyond what helps.

const SOURCE_LABEL: Record<string, string> = { tavily_news: "Tavily News", google_news_rss: "Google News", google_trends_rss: "Google Trends", wikipedia_pageviews: "Wikipedia",
  calendar: "Kalender", evergreen: "Evergreen" };
const ERROR_LABEL: Record<string, string> = { timeout: "Zeitüberschreitung", rate_limited: "Limit erreicht", auth: "Zugang abgelehnt", unavailable: "nicht erreichbar",
  invalid_response: "unerwartete Antwort", not_configured: "nicht eingerichtet", unknown: "Fehler" };
const time = (value: unknown) => value ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value))) : "–";

export async function topicPipelineStatus(db: Database, render: RenderContext): Promise<string> {
  const lines: string[] = [];
  const enabled = process.env.TOPIC_PIPELINE_ENABLED === "true";
  lines.push(`Themen-Pipeline: ${enabled ? "aktiv" : "ausgeschaltet"} · Live-Veröffentlichung: ${liveTopicPublishingEnabled() ? "an" : "aus (nur Probelauf)"}`);
  try {
    const run = await latestTopicRun(db);
    if (!run) lines.push("Themen-Scout: noch kein Lauf.");
    else {
      const health = (run.source_health as SourceHealth[] | null) ?? [];
      const ok = health.filter(item => item.status === "ok" || item.status === "empty").map(item => SOURCE_LABEL[item.source] ?? item.source);
      const failed = health.filter(item => item.status === "failed" || item.status === "skipped").map(item => `${SOURCE_LABEL[item.source] ?? item.source} (${ERROR_LABEL[item.errorKind ?? "unknown"]})`);
      const healthy = ["success", "degraded", "offline_fallback"].includes(String(run.outcome));
      lines.push(`Themen-Scout: ${healthy ? "gesund" : "ohne Ergebnis"}${run.outcome === "degraded" ? " (eingeschränkt)" : run.outcome === "offline_fallback" ? " (nur Offline-Quellen)" : ""} · letzter Lauf ${time(run.created_at)}, letzter erfolgreicher ${time(run.last_success)}`);
      lines.push(`Trendquellen ok: ${ok.join(", ") || "keine"}${failed.length ? ` · gestört: ${failed.join(", ")}` : ""}`);
      if (run.selected_title) lines.push(`Zuletzt gewähltes Thema: „${String(run.selected_title).slice(0, 80)}“`);
    }
  } catch { lines.push("Themen-Scout: Status nicht lesbar."); }
  try {
    const availability = await providerAvailability(render);
    lines.push(`Bilder (Replicate): ${availability.image.available ? "verfügbar" : `nicht verfügbar (${availability.image.reason ?? "–"})`}`);
    lines.push(`Avatar-Video: ${availability.avatarVideo.available ? `verfügbar über ${render.avatarProvider?.name}${availability.avatarVideo.quotaRemaining !== null ? `, Kontingent übrig: ${availability.avatarVideo.quotaRemaining}` : ""}` : `nicht verfügbar (${availability.avatarVideo.reason ?? "–"})`}`);
    lines.push(`Standard-Video: ${availability.standardVideo.available ? `verfügbar über ${render.standardVideoProvider?.name}` : `nicht verfügbar (${availability.standardVideo.reason ?? "–"})`}`);
  } catch { lines.push("Provider-Status nicht lesbar."); }
  try {
    const jobs = await db.query(`SELECT DISTINCT ON (grp) grp, status, error_category, updated_at FROM (
        SELECT CASE WHEN kind<>'image' THEN 'video' WHEN role LIKE 'slide-%' THEN 'carousel' ELSE 'image' END AS grp, status, error_category, updated_at FROM visual_jobs) jobs
      ORDER BY grp, updated_at DESC`);
    const label: Record<string, string> = { image: "Letzter Bildjob", carousel: "Letzter Karussell-Job", video: "Letzter Videojob" };
    for (const key of ["image", "carousel", "video"]) {
      const job = jobs.rows.find(row => row.grp === key);
      lines.push(`${label[key]}: ${job ? `${job.status === "succeeded" ? "erfolgreich" : job.status === "running" ? "läuft" : `fehlgeschlagen (${job.error_category ?? "–"})`} · ${time(job.updated_at)}` : "noch keiner"}`);
    }
  } catch { /* table may not exist yet */ }
  // Central capability check: per platform/provider ready, dry run only, blocked (missing variable names) or not activated.
  lines.push("Plattformen und Anbieter:", ...capabilityLines().map(line => `• ${line}`));
  try {
    const open = await db.query("SELECT count(*) FILTER (WHERE stage='proposed')::int AS proposals, count(*) FILTER (WHERE stage='awaiting_publish_approval')::int AS approvals, count(*) FILTER (WHERE stage='in_production')::int AS producing FROM topic_contents");
    const row = open.rows[0] ?? {};
    lines.push(`Offen: ${row.proposals ?? 0} Themenvorschlag/-vorschläge, ${row.approvals ?? 0} Veröffentlichungsfreigabe(n), ${row.producing ?? 0} in Produktion`);
    const error = (await db.query("SELECT last_error, updated_at FROM topic_contents WHERE last_error IS NOT NULL AND last_error<>'dry_run' ORDER BY updated_at DESC LIMIT 1")).rows[0];
    if (error) lines.push(`Letzter Fehler (${time(error.updated_at)}): ${String(error.last_error).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 160)}`);
  } catch { /* table may not exist yet */ }
  // Last published topic posts with the links the platforms returned (stored per platform, never constructed).
  try {
    const rows = (await db.query(`SELECT candidate->'candidate'->>'title' AS title, stage, master FROM topic_contents
      WHERE stage IN ('published','partially_published','publishing') AND master IS NOT NULL ORDER BY updated_at DESC LIMIT 3`)).rows;
    for (const row of rows) {
      const stored = row.master as { master: MasterContent; variants: PlatformVariant[] };
      const live = (await storedOutcomes(db, stored.master, stored.variants)).filter(item => item.status === "published");
      if (!live.length) continue;
      lines.push(`Veröffentlicht: „${String(row.title ?? "").slice(0, 70)}“ – ${live.map(item => `${PLATFORM_LABEL[item.platform as Platform] ?? item.platform} ${reliablePostUrl(item.platform, item.url) ?? "(Link nicht verfügbar)"}`).join(" · ")}`);
    }
  } catch { /* table may not exist yet */ }
  return lines.join("\n");
}

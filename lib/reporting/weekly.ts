import { getDatabase, type Database } from "../memory/db";
import { cachedMetaConnection, metaConfig } from "../meta/connection";
import { sendWhatsAppText, sendWeeklyNotificationTemplate, weeklyNotificationTemplateConfigured } from "../whatsapp/client";

export type WeeklyReportMetrics = {
  publishedTotal: number;
  publishedFacebook: number;
  publishedInstagram: number;
  measuredPublications: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  knownCostCents: number;
  unknownCostPublications: number;
  facelessPaidStarts: number;
  facelessCredits: number;
  facebookFollowers: number | null;
  instagramFollowers: number | null;
  facebookFollowerDelta: number | null;
  instagramFollowerDelta: number | null;
};

export function previousWeek(reference = new Date()) {
  const day = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  const end = day;
  const start = new Date(end.getTime() - 7 * 86400000);
  return { start, end, weekStart: start.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) };
}

async function readMetaFollowers(transport: typeof fetch = fetch) {
  try {
    const report = await cachedMetaConnection();
    const config = metaConfig();
    if (!report.resolved || !config.token) return { facebookFollowers: null, instagramFollowers: null };
    const read = async (id: string) => {
      const url = new URL(`https://graph.facebook.com/${config.version || "v25.0"}/${id}`);
      url.searchParams.set("fields", "followers_count");
      const response = await transport(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.token}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.json() as { followers_count?: unknown; error?: unknown };
      if (!response.ok || body.error || !Number.isFinite(Number(body.followers_count))) return null;
      return Math.max(0, Number(body.followers_count));
    };
    const [facebookFollowers, instagramFollowers] = await Promise.all([
      read(report.resolved.pageId),
      read(report.resolved.instagramId),
    ]);
    return { facebookFollowers, instagramFollowers };
  } catch {
    return { facebookFollowers: null, instagramFollowers: null };
  }
}

export async function buildWeeklyReportData(
  db: Database,
  start: Date,
  end: Date,
  followers: { facebookFollowers: number | null; instagramFollowers: number | null },
): Promise<WeeklyReportMetrics> {
  const [published, measured, production, previous] = await Promise.all([
    db.query(`SELECT count(*)::int AS total,
      COALESCE(sum(CASE WHEN platform='facebook' THEN 1 ELSE 0 END),0)::int AS facebook,
      COALESCE(sum(CASE WHEN platform='instagram' THEN 1 ELSE 0 END),0)::int AS instagram
      FROM publications WHERE status='published' AND published_at >= $1 AND published_at < $2`,
      [start.toISOString(), end.toISOString()]),
    db.query(`WITH ranked AS (
        SELECT o.*, row_number() OVER (PARTITION BY publication_id ORDER BY observed_at DESC,revision DESC) AS rn
        FROM performance_observations o WHERE observed_at >= $1 AND observed_at < $2
      )
      SELECT count(*)::int AS measured,
        COALESCE(sum(clicks),0)::bigint AS clicks,
        COALESCE(sum(conversions),0)::bigint AS conversions,
        COALESCE(sum(affiliate_revenue_cents),0)::bigint AS revenue,
        COALESCE(sum(CASE WHEN production_cost_cents IS NOT NULL THEN production_cost_cents ELSE 0 END),0)::bigint AS costs,
        COALESCE(sum(CASE WHEN production_cost_cents IS NULL THEN 1 ELSE 0 END),0)::int AS unknown_costs
      FROM ranked WHERE rn=1`, [start.toISOString(), end.toISOString()]),
    db.query(`SELECT count(*)::int AS starts,
        COALESCE(sum(estimated_provider_credits),0)::numeric AS credits
      FROM production_runs
      WHERE provider='faceless_video' AND provider_request_attempted_at >= $1 AND provider_request_attempted_at < $2`,
      [start.toISOString(), end.toISOString()]),
    db.query("SELECT metrics FROM weekly_reports WHERE week_start < $1 ORDER BY week_start DESC LIMIT 1", [start.toISOString().slice(0, 10)]),
  ]);
  const prev = previous.rows[0]?.metrics as Partial<WeeklyReportMetrics> | undefined;
  const facebookFollowers = followers.facebookFollowers;
  const instagramFollowers = followers.instagramFollowers;
  return {
    publishedTotal: Number(published.rows[0]?.total || 0),
    publishedFacebook: Number(published.rows[0]?.facebook || 0),
    publishedInstagram: Number(published.rows[0]?.instagram || 0),
    measuredPublications: Number(measured.rows[0]?.measured || 0),
    clicks: Number(measured.rows[0]?.clicks || 0),
    conversions: Number(measured.rows[0]?.conversions || 0),
    revenueCents: Number(measured.rows[0]?.revenue || 0),
    knownCostCents: Number(measured.rows[0]?.costs || 0),
    unknownCostPublications: Number(measured.rows[0]?.unknown_costs || 0),
    facelessPaidStarts: Number(production.rows[0]?.starts || 0),
    facelessCredits: Number(production.rows[0]?.credits || 0),
    facebookFollowers,
    instagramFollowers,
    facebookFollowerDelta: facebookFollowers !== null && typeof prev?.facebookFollowers === "number" ? facebookFollowers - prev.facebookFollowers : null,
    instagramFollowerDelta: instagramFollowers !== null && typeof prev?.instagramFollowers === "number" ? instagramFollowers - prev.instagramFollowers : null,
  };
}

function followerLine(label: string, value: number | null, delta: number | null) {
  if (value === null) return `${label}: nicht verfügbar`;
  const change = delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${delta})`;
  return `${label}: ${value}${change}`;
}

export function formatWeeklyReport(start: Date, end: Date, metrics: WeeklyReportMetrics) {
  const date = (value: Date) => value.toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
  const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const profit = metrics.revenueCents - metrics.knownCostCents;
  const costs = metrics.unknownCostPublications
    ? `${euro(metrics.knownCostCents)} + ${metrics.unknownCostPublications} Beitrag/Beiträge mit unbekannten Kosten`
    : euro(metrics.knownCostCents);
  return [
    `Wochenbilanz · ${date(start)}–${date(new Date(end.getTime() - 1))}`,
    "",
    `Veröffentlicht: ${metrics.publishedTotal} · Facebook ${metrics.publishedFacebook} · Instagram ${metrics.publishedInstagram}`,
    metrics.measuredPublications ? `Neu erfasste Messstände: ${metrics.measuredPublications} · Klicks ${metrics.clicks} · Verkäufe/Conversions ${metrics.conversions}` : "Klicks/Verkäufe: keine Messwerte erfasst (nicht als null bestätigt)",
    metrics.measuredPublications ? `Affiliate-Erlös laut Messständen: ${euro(metrics.revenueCents)}` : "Affiliate-Erlös: unbekannt – kein Messwert erfasst",
    metrics.measuredPublications ? `Erfasste Produktionskosten: ${costs}` : "Produktionskosten für Beiträge: keine Messwerte erfasst",
    metrics.measuredPublications ? `Teilwert aus erfassten Erlösen und bekannten Kosten: ${euro(profit)}${metrics.unknownCostPublications ? " (weitere Kosten unbekannt)" : ""}` : "Ergebnis: ohne Messwerte nicht berechenbar",
    `Faceless: ${metrics.facelessPaidStarts} kostenpflichtige Starts · ${metrics.facelessCredits} Credits laut gespeicherter Quote`,
    followerLine("Facebook-Follower", metrics.facebookFollowers, metrics.facebookFollowerDelta),
    followerLine("Instagram-Follower", metrics.instagramFollowers, metrics.instagramFollowerDelta),
    "",
    "Hinweis: Klicks, Conversions, Erlöse und Kosten stammen ausschließlich aus den in Postgres neu erfassten Messständen dieser Woche. Ein Messstand kann kumulative Werte seit Veröffentlichung enthalten; daraus wird kein Wochenzuwachs abgeleitet. Fehlende Quellen werden nicht geschätzt.",
  ].join("\n");
}

export async function deliverWeeklyReport(weekStart: string, db: Database = getDatabase()) {
  const current = await db.query("SELECT * FROM weekly_reports WHERE week_start=$1", [weekStart]);
  if (!current.rows[0]) throw new Error("Wochenbericht fehlt.");
  if (current.rows[0].status === "sent" || current.rows[0].whatsapp_message_id) return { status: "sent" as const };
  if (current.rows[0].status === "delivery_unknown") return { status: "delivery_unknown" as const };

  const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!approver) return { status: "not_configured" as const };
  const recent = await db.query(
    "SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1",
    [approver],
  );

  if (recent.rows.length) {
    const claimed = await db.query(
      `UPDATE weekly_reports SET whatsapp_send_attempted_at=now(),updated_at=now()
       WHERE week_start=$1 AND whatsapp_message_id IS NULL AND whatsapp_send_attempted_at IS NULL
         AND status IN ('ready','notification_sent') RETURNING report_text`,
      [weekStart],
    );
    if (!claimed.rows[0]) return { status: String(current.rows[0].status) };
    try {
      const messageId = await sendWhatsAppText(String(claimed.rows[0].report_text));
      await db.query("UPDATE weekly_reports SET status='sent',whatsapp_message_id=$2,updated_at=now() WHERE week_start=$1", [weekStart, messageId]);
      return { status: "sent" as const };
    } catch (error) {
      await db.query("UPDATE weekly_reports SET status='delivery_unknown',updated_at=now() WHERE week_start=$1", [weekStart]);
      throw error;
    }
  }

  if (!weeklyNotificationTemplateConfigured()) return { status: "template_required" as const };
  const claimed = await db.query(
    `UPDATE weekly_reports SET notification_send_attempted_at=now(),updated_at=now()
     WHERE week_start=$1 AND notification_message_id IS NULL AND notification_send_attempted_at IS NULL
       AND status='ready' RETURNING week_start`, [weekStart],
  );
  if (!claimed.rows[0]) return { status: String(current.rows[0].status) };
  try {
    const messageId = await sendWeeklyNotificationTemplate();
    await db.query("UPDATE weekly_reports SET status='notification_sent',notification_message_id=$2,updated_at=now() WHERE week_start=$1", [weekStart, messageId]);
    return { status: "notification_sent" as const };
  } catch (error) {
    await db.query("UPDATE weekly_reports SET status='delivery_unknown',updated_at=now() WHERE week_start=$1", [weekStart]);
    throw error;
  }
}

export async function createWeeklyReport(reference = new Date(), db: Database = getDatabase()) {
  const { start, end, weekStart, weekEnd } = previousWeek(reference);
  const claimed = await db.query(
    "INSERT INTO weekly_reports(week_start,week_end,status) VALUES($1,$2,'claimed') ON CONFLICT(week_start) DO NOTHING RETURNING week_start",
    [weekStart, weekEnd],
  );
  if (claimed.rows.length) {
    try {
      const followers = await readMetaFollowers();
      const metrics = await buildWeeklyReportData(db, start, end, followers);
      const text = formatWeeklyReport(start, end, metrics);
      await db.query("UPDATE weekly_reports SET status='ready',report_text=$2,metrics=$3,updated_at=now() WHERE week_start=$1 AND status='claimed'",
        [weekStart, text, JSON.stringify(metrics)]);
    } catch (error) {
      await db.query("UPDATE weekly_reports SET status='failed',updated_at=now() WHERE week_start=$1 AND status='claimed'", [weekStart]);
      throw error;
    }
  }
  return { weekStart, ...(await deliverWeeklyReport(weekStart, db)) };
}

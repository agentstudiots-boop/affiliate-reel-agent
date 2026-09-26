import { getDatabase, type Database } from "../memory/db";
import { imageProviderStatus } from "../content/image-provider";
import { dailyNotificationTemplateConfigured, weeklyNotificationTemplateConfigured, whatsappApprovalReady } from "../whatsapp/client";

export async function getOperationsSnapshot(db: Database = getDatabase(), requestOidcAvailable=false) {
  const [days, posts, reports] = await Promise.all([
    db.query(`SELECT d.day::text AS day, d.job_id::text AS job_id, d.status,
        j.snapshot->'opportunity'->'product'->>'name' AS product,
        j.content_type AS format,
        d.notification_message_id IS NOT NULL AS notification_sent,
        d.whatsapp_message_id IS NOT NULL AS content_approval_sent,
        p.status AS publication_status, p.whatsapp_message_id IS NOT NULL AS publishing_approval_sent,
        p.permalink
      FROM daily_drafts d
      LEFT JOIN content_jobs j ON j.id=d.job_id
      LEFT JOIN LATERAL (
        SELECT status,whatsapp_message_id,permalink FROM publication_requests
        WHERE job_id=d.job_id AND platform='facebook' ORDER BY revision DESC LIMIT 1
      ) p ON true
      ORDER BY d.day DESC LIMIT 14`),
    db.query(`SELECT p.job_id::text AS job_id, p.platform, p.url, p.published_at,
        j.snapshot->'opportunity'->'product'->>'name' AS product,
        m.observed_at, m.clicks, m.conversions, m.affiliate_revenue_cents,
        m.production_cost_cents, m.source
      FROM publications p JOIN content_jobs j ON j.id=p.job_id
      LEFT JOIN LATERAL (
        SELECT observed_at,clicks,conversions,affiliate_revenue_cents,production_cost_cents,source
        FROM performance_observations WHERE publication_id=p.id
        ORDER BY revision DESC LIMIT 1
      ) m ON true
      WHERE p.status='published' ORDER BY p.published_at DESC LIMIT 20`),
    db.query("SELECT week_start::text AS week_start,status,report_text,metrics FROM weekly_reports ORDER BY week_start DESC LIMIT 1"),
  ]);
  const instructions=await db.query(`SELECT i.job_id,i.status,i.error_code,COALESCE(i.interpretation->'instruction'->>'intent',i.interpretation->>'intent') AS intent,
    COALESCE(i.interpretation->'instruction'->>'confidence',i.interpretation->>'confidence') AS confidence,e.reply_to_message_id IS NOT NULL AS replied,
    length(e.body) AS message_length,i.created_at FROM whatsapp_instructions i
    JOIN whatsapp_events e ON e.message_id=i.message_id ORDER BY i.created_at DESC LIMIT 6`);
  const pending=await db.query(`SELECT
    (SELECT count(*)::int FROM approval_requests WHERE status='pending' AND whatsapp_message_id IS NOT NULL) AS production,
    (SELECT count(*)::int FROM publication_requests WHERE status IN ('pending','changes_requested') AND whatsapp_message_id IS NOT NULL) AS publications`);
  // Read-only, bounded operational diagnostics; never log tokens or message text.
  console.info(JSON.stringify({event:'whatsapp_instruction_diagnostics',gatewayAuthConfigured:requestOidcAvailable||!!(process.env.AI_GATEWAY_API_KEY?.trim()||process.env.VERCEL_OIDC_TOKEN?.trim()),instructions:instructions.rows,pending:pending.rows[0]}));
  const provider = imageProviderStatus();
  return {
    environment: process.env.VERCEL_ENV === "production" ? "production" : "preview_or_local",
    readiness: {
      cronSecretConfigured: !!process.env.CRON_SECRET,
      tavilyConfigured: !!process.env.TAVILY_API_KEY,
      whatsappConfigured: whatsappApprovalReady(),
      dailyTemplateConfigured: dailyNotificationTemplateConfigured(),
      weeklyTemplateConfigured: weeklyNotificationTemplateConfigured(),
      blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
      imageProviderConfigured: provider.configured,
      imageProviderReason: provider.reason,
    },
    days: days.rows.map(row => ({
      day: String(row.day), jobId: String(row.job_id), status: String(row.status),
      product: String(row.product || "Unbekannt"), format: row.format ? String(row.format) : null,
      notificationSent: row.notification_sent === true, contentApprovalSent: row.content_approval_sent === true,
      publicationStatus: row.publication_status ? String(row.publication_status) : null,
      publishingApprovalSent: row.publishing_approval_sent === true,
      permalink: row.permalink ? String(row.permalink) : null,
    })),
    posts: posts.rows.map(row => ({
      jobId: String(row.job_id), platform: String(row.platform), product: String(row.product || "Unbekannt"),
      url: String(row.url), publishedAt: String(row.published_at),
      measurement: row.observed_at ? {
        observedAt: String(row.observed_at), clicks: Number(row.clicks), conversions: Number(row.conversions),
        revenueCents: Number(row.affiliate_revenue_cents),
        costCents: row.production_cost_cents == null ? null : Number(row.production_cost_cents),
        source: String(row.source),
      } : null,
    })),
    latestReport: reports.rows[0] ? {
      weekStart: String(reports.rows[0].week_start), status: String(reports.rows[0].status),
      text: String(reports.rows[0].report_text || ""),
    } : null,
  };
}

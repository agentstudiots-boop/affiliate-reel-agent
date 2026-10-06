import { applyMigrations } from "./migrations";
import type { Database } from "./db";

// Deployed webhooks and scheduled calls can arrive before an operator opens the
// studio migration route. The SQL upgrade is transactional and advisory locked.
export async function ensureAutomationSchema(db: Database) {
  const ready = await db.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='daily_drafts' AND column_name='slot') AS slots,
    EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.oid=to_regclass('public.daily_drafts') AND c.contype='p'
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)
           FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
           JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)
          = ARRAY['day','slot']::name[]) AS slot_key,
    to_regclass('public.story_handoffs') IS NOT NULL AS stories,
    to_regclass('public.approved_editorial_feedback') IS NOT NULL AS feedback,
    to_regclass('public.product_selection_locks') IS NOT NULL AS product_locks,
    to_regclass('public.whatsapp_chat_turns') IS NOT NULL AS chat_turns,
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='daily_drafts' AND column_name='attempts') AS slot_retry,
    to_regclass('public.instagram_image_posts') IS NOT NULL AS instagram_images,
    to_regclass('public.whatsapp_routes') IS NOT NULL AS routes,
    to_regclass('public.landing_clicks') IS NOT NULL AS clicks,
    to_regclass('public.content_categories') IS NOT NULL AS categories,
    to_regclass('public.whatsapp_voice_messages') IS NOT NULL AS voice,
    to_regclass('public.topic_history') IS NOT NULL AS topics,
    to_regclass('public.publish_attempts') IS NOT NULL AS publish_gate,
    to_regclass('public.provider_usage') IS NOT NULL AS visual_jobs,
    to_regclass('public.topic_contents') IS NOT NULL AS topic_contents,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_attempts' AND column_name='remote_ids') AS publish_results,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='topic_contents' AND column_name='previous_message_ids') AS topic_previous`);
  if (ready.rows[0]?.slots === true && ready.rows[0]?.slot_key === true && ready.rows[0]?.stories === true && ready.rows[0]?.feedback === true && ready.rows[0]?.product_locks === true && ready.rows[0]?.chat_turns === true && ready.rows[0]?.slot_retry === true && ready.rows[0]?.instagram_images === true && ready.rows[0]?.routes === true && ready.rows[0]?.clicks === true && ready.rows[0]?.categories === true && ready.rows[0]?.voice === true && ready.rows[0]?.topics === true && ready.rows[0]?.publish_gate === true && ready.rows[0]?.visual_jobs === true && ready.rows[0]?.topic_contents === true && ready.rows[0]?.publish_results === true && ready.rows[0]?.topic_previous === true) return;
  await applyMigrations(db);
}

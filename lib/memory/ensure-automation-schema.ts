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
      WHERE table_schema='public' AND table_name='daily_drafts' AND column_name='attempts') AS slot_retry`);
  if (ready.rows[0]?.slots === true && ready.rows[0]?.slot_key === true && ready.rows[0]?.stories === true && ready.rows[0]?.feedback === true && ready.rows[0]?.product_locks === true && ready.rows[0]?.chat_turns === true && ready.rows[0]?.slot_retry === true) return;
  await applyMigrations(db);
}

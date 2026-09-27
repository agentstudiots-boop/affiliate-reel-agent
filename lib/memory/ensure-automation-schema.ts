import { applyMigrations } from "./migrations";
import type { Database } from "./db";

// Deployed webhooks and scheduled calls can arrive before an operator opens the
// studio migration route. The SQL upgrade is transactional and advisory locked.
export async function ensureAutomationSchema(db: Database) {
  const ready = await db.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='daily_drafts' AND column_name='slot') AS slots,
    to_regclass('public.story_handoffs') IS NOT NULL AS stories`);
  if (ready.rows[0]?.slots === true && ready.rows[0]?.stories === true) return;
  await applyMigrations(db);
}

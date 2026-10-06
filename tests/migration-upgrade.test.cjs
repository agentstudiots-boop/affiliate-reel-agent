const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { applyMigrations } = require('../.test-build/lib/memory/migrations');
const { ensureAutomationSchema } = require('../.test-build/lib/memory/ensure-automation-schema');

test('006–017 upgrade populated 001–005 once without replaying or changing prior migrations', async () => {
  const pg = new PGlite();
  const db = {
    query: (query, values) => pg.query(query, values),
    exec: query => pg.exec(query),
    transaction: fn => pg.transaction(tx => fn({
      query: (query, values) => tx.query(query, values),
      exec: query => tx.exec(query),
    })),
  };
  const previous = ['001_memory.sql', '002_production_gates.sql', '003_faceless_so.sql', '004_daily_drafts.sql', '005_publication_gate.sql'];
  const load = name => fs.readFileSync(`db/migrations/${name}`, 'utf8');
  try {
    // Isolated fixture for the existing Preview schema; no remote database access.
    await pg.exec('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of previous) {
      await pg.exec(load(name));
      await pg.query("INSERT INTO schema_migrations(name,applied_at) VALUES($1,'2026-09-23T00:00:00Z')", [name]);
    }
    await pg.query("INSERT INTO daily_drafts(day,job_id,status,whatsapp_message_id) VALUES('2026-09-23',$1,'content_approved','test.draft')", [crypto.randomUUID()]);
    await pg.exec("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('test.approval','test-approver','approve','{}')");
    const before = (await pg.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    const draft = (await pg.query('SELECT * FROM daily_drafts')).rows[0];
    const event = (await pg.query('SELECT * FROM whatsapp_events')).rows[0];
    const loaded = [];
    const trackedLoader = name => { loaded.push(name); return load(name); };

    const upgrades = ['006_daily_notification.sql', '007_publication_revisions.sql', '008_weekly_reports.sql', '009_original_visual_attempts.sql', '010_replicate_visual_provider.sql', '011_instagram_reel_publications.sql', '012_whatsapp_instructions.sql', '013_operator_language_examples.sql', '014_content_approval_requests.sql', '015_runway_story.sql', '016_multiple_drafts.sql', '017_story_handoffs.sql', '018_approved_editorial_feedback.sql', '019_daily_slot_key.sql', '020_product_selection_locks.sql', '021_whatsapp_chat.sql', '022_daily_slot_retry.sql', '023_instagram_image_posts.sql', '024_whatsapp_routes.sql', '025_landing_clicks.sql', '026_content_categories.sql', '027_whatsapp_voice_messages.sql', '028_topic_pipeline.sql', '029_publish_approvals.sql', '030_visual_jobs.sql', '031_topic_contents.sql', '032_publish_results.sql'];
    assert.deepEqual(await applyMigrations(db, trackedLoader), {
      applied: upgrades, alreadyApplied: previous,
    });
    assert.deepEqual(await applyMigrations(db, trackedLoader), {
      applied: [], alreadyApplied: [...previous, ...upgrades],
    });
    assert.deepEqual(loaded, upgrades, 'existing migration SQL must never be replayed');
    assert.deepEqual((await pg.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0, 5), before);
    assert.deepEqual((await pg.query('SELECT * FROM daily_drafts')).rows[0], {
      ...draft, notification_send_attempted_at: null, notification_message_id: null, slot: 'morning', attempts: 1,
    });
    assert.deepEqual((await pg.query('SELECT * FROM whatsapp_events')).rows[0], event);
    await pg.exec("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('test.notification','test-approver','notification_reply','{}')");
    await pg.exec("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('test.weekly','test-approver','weekly_report_reply','{}')");
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='weekly_reports'")).rows[0].n, 1);
    await assert.rejects(pg.exec("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('test.invalid','test-approver','unsupported','{}')"));
  } finally {
    await pg.close();
  }
});

test('first scheduled draft can upgrade an older schema once before it makes a claim', async () => {
  const pg = new PGlite();
  const db = { query:(query,values)=>pg.query(query,values), exec:query=>pg.exec(query),
    transaction:fn=>pg.transaction(tx=>fn({query:(query,values)=>tx.query(query,values),exec:query=>tx.exec(query)})) };
  try {
    await pg.exec('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of ['001_memory.sql','002_production_gates.sql','003_faceless_so.sql','004_daily_drafts.sql','005_publication_gate.sql']) {
      await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
      await pg.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
    }
    await ensureAutomationSchema(db);
    await ensureAutomationSchema(db);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name IN ('016_multiple_drafts.sql','017_story_handoffs.sql')")).rows[0].n,2);
    assert.equal((await pg.query("SELECT to_regclass('public.story_handoffs') IS NOT NULL AS ready")).rows[0].ready,true);
    await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status) VALUES('2026-09-27','morning',$1,'claimed')",[crypto.randomUUID()]);
    await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status) VALUES('2026-09-27','afternoon',$1,'claimed')",[crypto.randomUUID()]);
  } finally { await pg.close(); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { applyMigrations } = require('../.test-build/lib/memory/migrations');

test('006–012 upgrade populated 001–005 once without replaying or changing prior migrations', async () => {
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

    assert.deepEqual(await applyMigrations(db, trackedLoader), {
      applied: ['006_daily_notification.sql', '007_publication_revisions.sql', '008_weekly_reports.sql', '009_original_visual_attempts.sql', '010_replicate_visual_provider.sql', '011_instagram_reel_publications.sql', '012_whatsapp_instructions.sql'], alreadyApplied: previous,
    });
    assert.deepEqual(await applyMigrations(db, trackedLoader), {
      applied: [], alreadyApplied: [...previous, '006_daily_notification.sql', '007_publication_revisions.sql', '008_weekly_reports.sql', '009_original_visual_attempts.sql', '010_replicate_visual_provider.sql', '011_instagram_reel_publications.sql', '012_whatsapp_instructions.sql'],
    });
    assert.deepEqual(loaded, ['006_daily_notification.sql', '007_publication_revisions.sql', '008_weekly_reports.sql', '009_original_visual_attempts.sql', '010_replicate_visual_provider.sql', '011_instagram_reel_publications.sql', '012_whatsapp_instructions.sql'], 'existing migration SQL must never be replayed');
    assert.deepEqual((await pg.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0, 5), before);
    assert.deepEqual((await pg.query('SELECT * FROM daily_drafts')).rows[0], {
      ...draft, notification_send_attempted_at: null, notification_message_id: null,
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

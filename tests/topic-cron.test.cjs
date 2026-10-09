const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { runTopicCron, berlinSlotKey } = require(`${L}/topic-pipeline/cron`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { setEventSink, recentEvents, clearRecentEvents } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { withEnv } = require('./helpers/live-env.cjs');

setEventSink(() => {});
const NOW = new Date('2026-10-05T07:10:00Z');
function deps(db, sent = []) {
  let n = 0;
  return { db, trustedWaId: '491701234567', now: () => NOW, send: async text => { sent.push(text); return `wamid.cron.${++n}`; },
    render: { ledger: memoryLedger(), imageProvider: null }, scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} }, publishers: [],
    interpret: async () => { throw new Error('no model'); } };
}

test('disabled: no database access, no WhatsApp, exit state "disabled"', async () => {
  const result = await runTopicCron({ enabled: false, now: NOW, deps: () => { throw new Error('must not load deps'); } });
  assert.equal(result.status, 'disabled');
});

test('one proposal per hourly slot: a repeated cron call is "already_ran"; the lease is released afterwards', async () => {
  const db = await pgliteDatabase();
  try {
    clearRecentEvents();
    const sent = [];
    const first = await runTopicCron({ enabled: true, now: NOW, deps: () => deps(db, sent) });
    assert.equal(first.status, 'proposed');
    assert.equal(first.slotKey, '2026-10-05:09');
    assert.equal(sent.length, 1);
    const second = await runTopicCron({ enabled: true, now: NOW, deps: () => deps(db, sent) });
    assert.equal(second.status, 'already_ran');
    assert.equal(sent.length, 1);
    assert.equal((await db.query("SELECT expires_at < now() AS free FROM topic_cron_lease")).rows[0].free, true);
    assert.ok(recentEvents('topic_cron_completed').length >= 1);
    assert.ok(recentEvents('topic_cron_skipped').some(event => event.fields.status === 'already_ran'));
    const next = await runTopicCron({ enabled: true, now: new Date(NOW.getTime() + 3600e3), deps: () => deps(db, sent) });
    assert.notEqual(next.status, 'already_ran');
  } finally { await db.close(); }
});

test('overlapping invocations: exactly one run; the other exits "locked" without sending anything', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const results = await Promise.all([runTopicCron({ enabled: true, now: NOW, deps: () => deps(db, sent) }), runTopicCron({ enabled: true, now: NOW, deps: () => deps(db, sent) })]);
    assert.ok(results.some(result => result.status === 'proposed'));
    assert.ok(results.some(result => ['locked', 'already_ran'].includes(result.status)));
    assert.equal(sent.length, 1);
    // A lease held by a crashed run blocks only until it expires.
    await db.query("UPDATE topic_cron_lease SET holder='crashed', expires_at=now()+interval '1 minute'");
    assert.equal((await runTopicCron({ enabled: true, now: new Date(NOW.getTime() + 7200e3), deps: () => deps(db, sent) })).status, 'locked');
    await db.query("UPDATE topic_cron_lease SET expires_at=now()-interval '1 second'");
    assert.notEqual((await runTopicCron({ enabled: true, now: new Date(NOW.getTime() + 7200e3), deps: () => deps(db, sent) })).status, 'locked');
  } finally { await db.close(); }
});

test('a failing step is isolated: the others still run and the exit state is "failed"', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const broken = { ...db, query: (sql, values) => /stage='in_production'/.test(sql) ? Promise.reject(new Error('db down for this query')) : db.query(sql, values) };
    const result = await runTopicCron({ enabled: true, now: NOW, deps: () => ({ ...deps(db, sent), db: broken }) });
    assert.equal(result.status, 'failed');
    assert.match(result.steps.resume, /^failed:/);
    assert.equal(result.steps.scout, 'proposed');
    assert.equal(sent.length, 1);
  } finally { await db.close(); }
});

test('route: unauthorized without the cron secret; disabled without loading the runtime wiring', async () => {
  const loadRoute = require('./helpers/load-route.cjs');
  const restore = withEnv({ CRON_SECRET: 'cron-secret-123', TOPIC_PIPELINE_ENABLED: undefined });
  try {
    const route = loadRoute('app/api/cron/topic-scout/route.ts', { '@/lib/agents/topic-runtime': new Proxy({}, { get() { throw new Error('runtime must not load'); } }) });
    assert.equal((await route.GET(new Request('https://local.test/api/cron/topic-scout'))).status, 401);
    assert.equal((await route.GET(new Request('https://local.test/api/cron/topic-scout', { headers: { authorization: 'Bearer wrong-secret-12' } }))).status, 401);
    const ok = await route.GET(new Request('https://local.test/api/cron/topic-scout', { headers: { authorization: 'Bearer cron-secret-123' } }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, 'disabled');
  } finally { restore(); }
  assert.equal(berlinSlotKey(new Date('2026-12-31T23:30:00Z')), '2027-01-01:00');
});

test('vercel.json does not schedule the topic cron (activation is a separate approved step)', () => {
  const config = JSON.parse(require('node:fs').readFileSync('vercel.json', 'utf8'));
  assert.ok(!config.crons.some(cron => cron.path.includes('topic-scout')));
});

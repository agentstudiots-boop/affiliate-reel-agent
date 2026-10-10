const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { runTopicCron } = require(`${L}/topic-pipeline/cron`);
const { dailyTopicLimit } = require(`${L}/topic-pipeline/orchestrator`);
const { topicPipelineStatus } = require(`${L}/topic-pipeline/status`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { withEnv } = require('./helpers/live-env.cjs');

setEventSink(() => {});
const HOUR = 3600e3;
const START = new Date('2026-10-05T05:10:00Z'); // 07:10 Berlin
let n = 0;
function deps(db, sent) {
  return { db, trustedWaId: '491701234567', now: () => START, send: async text => { sent.push(text); return `wamid.limit.${++n}`; },
    render: { ledger: memoryLedger(), imageProvider: null }, scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} }, publishers: [],
    interpret: async () => { throw new Error('no model'); } };
}

test('daily limit defaults to one topic proposal per Berlin day and is clamped to 1..4', () => {
  assert.equal(dailyTopicLimit({}), 1);
  assert.equal(dailyTopicLimit({ TOPIC_POSTS_PER_DAY: '2' }), 2);
  assert.equal(dailyTopicLimit({ TOPIC_POSTS_PER_DAY: '99' }), 4);
  assert.equal(dailyTopicLimit({ TOPIC_POSTS_PER_DAY: '0' }), 1);
  assert.equal(dailyTopicLimit({ TOPIC_POSTS_PER_DAY: 'abc' }), 1);
});

test('an hourly cron proposes exactly one topic per day by default; the next day starts again', async () => {
  const restore = withEnv({ TOPIC_POSTS_PER_DAY: undefined });
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const first = await runTopicCron({ enabled: true, now: START, deps: () => deps(db, sent) });
    assert.equal(first.status, 'proposed');
    for (let hour = 1; hour <= 6; hour++) {
      const later = await runTopicCron({ enabled: true, now: new Date(START.getTime() + hour * HOUR), deps: () => deps(db, sent) });
      assert.equal(later.status, 'daily_limit', `hour +${hour}`);
    }
    assert.equal(sent.length, 1, 'no further WhatsApp message on the same day');
    const claimed = Number((await db.query("SELECT count(*)::int AS n FROM topic_runs WHERE slot_key LIKE '2026-10-05:%'")).rows[0].n);
    assert.equal(claimed, 1, 'a limited call claims no slot');
    const tomorrow = await runTopicCron({ enabled: true, now: new Date(START.getTime() + 24 * HOUR), deps: () => deps(db, sent) });
    assert.notEqual(tomorrow.status, 'daily_limit');
  } finally { restore(); await db.close(); }
});

test('TOPIC_POSTS_PER_DAY=2 allows a second proposal the same day, but not a third', async () => {
  const restore = withEnv({ TOPIC_POSTS_PER_DAY: '2' });
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const statuses = [];
    for (let hour = 0; hour < 4; hour++) statuses.push((await runTopicCron({ enabled: true, now: new Date(START.getTime() + hour * HOUR), deps: () => deps(db, sent) })).status);
    assert.equal(statuses.filter(status => status === 'proposed').length, 2, statuses.join(','));
    assert.equal(statuses[3], 'daily_limit');
  } finally { restore(); await db.close(); }
});

test('the WhatsApp status lists published topic posts with the platform-returned links only', async () => {
  const db = await pgliteDatabase();
  try {
    const master = { master: { content_id: 'tc_status1' }, variants: [{ platform: 'facebook', publishable: true }, { platform: 'instagram', publishable: true }, { platform: 'x', publishable: true }] };
    await db.query(`INSERT INTO topic_contents(content_id,topic_id,stage,format,candidate,decision,copy,master) VALUES('tc_status1','t1','partially_published','CAROUSEL',$1,'{}','{}',$2)`,
      [JSON.stringify({ candidate: { title: 'Tipp gegen beschlagene Spiegel' } }), JSON.stringify(master)]);
    await db.query("INSERT INTO content_versions(content_id,version,fingerprint,platforms) VALUES('tc_status1',1,$1,'{facebook,instagram,x}')", ['a'.repeat(64)]);
    const attempt = (id, platform, status, url) => db.query("INSERT INTO publish_attempts(id,content_id,version,platform,origin,status,url) VALUES($1,'tc_status1',1,$2,'whatsapp_approval',$3,$4)", [id, platform, status, url]);
    await attempt('00000000-0000-4000-8000-000000000001', 'facebook', 'published', 'https://www.facebook.com/page/posts/123');
    await attempt('00000000-0000-4000-8000-000000000002', 'instagram', 'published', 'https://evil.example.com/p/abc');
    await attempt('00000000-0000-4000-8000-000000000003', 'x', 'failed', null);
    const text = await topicPipelineStatus(db, { ledger: memoryLedger(), imageProvider: null });
    const line = text.split('\n').find(item => item.startsWith('Veröffentlicht:'));
    assert.ok(line, text);
    assert.match(line, /Facebook https:\/\/www\.facebook\.com\/page\/posts\/123/);
    assert.match(line, /Instagram \(Link nicht verfügbar\)/, 'a link outside the platform domain is never shown');
    assert.ok(!/X /.test(line.replace('Themen', '')) && !/evil\.example/.test(line), 'failed platforms and foreign links do not appear');
  } finally { await db.close(); }
});

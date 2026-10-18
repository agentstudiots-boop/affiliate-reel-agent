const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = '../.test-build/lib';
const { runTopicCron, berlinSlotKey, insideWindow, TOPIC_PROPOSAL_WINDOW } = require(`${L}/topic-pipeline/cron`);
const { deliverHeldProposals, handleTopicReply } = require(`${L}/topic-pipeline/orchestrator`);
const { WhatsAppRejectedError } = require(`${L}/whatsapp/client`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');

setEventSink(() => {});
const OPERATOR = '491701234567';
function deps(db, sent, over = {}) {
  let n = 0;
  return { db, trustedWaId: OPERATOR, now: over.now ?? (() => new Date('2026-10-19T07:05:00Z')), send: async text => { sent.push(text); return `wamid.topic.${++n}.${sent.length}`; },
    render: { ledger: memoryLedger(), imageProvider: null }, scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} }, publishers: [],
    interpret: async () => { throw new Error('no model'); }, ...over };
}

test('topic cron schedule: every scheduled call lies in the Berlin proposal window in summer AND winter time', () => {
  const hours = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.filter(cron => cron.path === '/api/cron/topic-scout').map(cron => Number(cron.schedule.split(' ')[1]));
  assert.deepEqual(hours, [7, 8]);
  for (const day of ['2026-10-19', '2026-10-26', '2026-03-30']) { // summer, winter (after 25.10.), summer again
    for (const hour of hours) for (const minute of ['00', '59']) {
      const key = berlinSlotKey(new Date(`${day}T${String(hour).padStart(2, '0')}:${minute}:00Z`));
      assert.ok(insideWindow(key, TOPIC_PROPOSAL_WINDOW), `${day} ${hour}:${minute} UTC → ${key} must be inside 08–11 Berlin`);
    }
  }
  // Monday 19.10.2026 (summer time): 07:00 UTC = 09:00 Berlin, i.e. the proposal is ready well before 11:00.
  assert.equal(berlinSlotKey(new Date('2026-10-19T07:00:00Z')), '2026-10-19:09');
  assert.equal(berlinSlotKey(new Date('2026-10-26T07:00:00Z')), '2026-10-26:08');
});

test('outside the proposal window the cron continues running jobs but proposes nothing', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const result = await runTopicCron({ enabled: true, now: new Date('2026-10-19T14:00:00Z'), deps: () => deps(db, sent), proposalWindow: TOPIC_PROPOSAL_WINDOW });
    assert.equal(result.status, 'outside_window');
    assert.match(result.steps.resume, /fortgesetzt/);
    assert.equal(sent.length, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM topic_runs')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('both scheduled calls of one day yield exactly one proposal (daily limit), in summer and winter time', async () => {
  for (const [first, second] of [['2026-10-19T07:20:00Z', '2026-10-19T08:40:00Z'], ['2026-10-26T07:20:00Z', '2026-10-26T08:40:00Z']]) {
    const db = await pgliteDatabase();
    try {
      const sent = [];
      const a = await runTopicCron({ enabled: true, now: new Date(first), deps: () => deps(db, sent, { now: () => new Date(first) }), proposalWindow: TOPIC_PROPOSAL_WINDOW });
      const b = await runTopicCron({ enabled: true, now: new Date(second), deps: () => deps(db, sent, { now: () => new Date(second) }), proposalWindow: TOPIC_PROPOSAL_WINDOW });
      assert.equal(a.status, 'proposed');
      assert.equal(b.status, 'daily_limit');
      assert.equal(sent.length, 1);
      assert.match(sent[0], /Themenvorschlag/);
    } finally { await db.close(); }
  }
});

test('closed WhatsApp window: the proposal is held (nothing sent), counts for the day, and is delivered once with the next operator message', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    let open = false;
    let notified = 0;
    const d = deps(db, sent, { serviceWindowOpen: async () => open, notify: async () => { notified++; return 'wamid.template.1'; } });
    const result = await runTopicCron({ enabled: true, now: new Date('2026-10-19T07:05:00Z'), deps: () => d, proposalWindow: TOPIC_PROPOSAL_WINDOW });
    assert.equal(result.status, 'proposed');
    assert.equal(sent.length, 0, 'no free-form text outside the 24 h window');
    assert.equal(notified, 1, 'optional approved template only notifies');
    const row = (await db.query('SELECT content_id, stage, delivery, proposal_message_id, notification_message_id FROM topic_contents')).rows[0];
    assert.deepEqual([row.stage, row.delivery, row.proposal_message_id, row.notification_message_id], ['proposed', 'awaiting_window', null, 'wamid.template.1']);
    // The second scheduled call of the day does not create another proposal.
    assert.equal((await runTopicCron({ enabled: true, now: new Date('2026-10-19T08:05:00Z'), deps: () => d, proposalWindow: TOPIC_PROPOSAL_WINDOW })).status, 'daily_limit');
    // The operator writes → window open → delivered exactly once, with a note; a replay sends nothing.
    open = true;
    assert.equal(await deliverHeldProposals(d), 1);
    assert.equal(await deliverHeldProposals(d), 0);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Nachgeliefert/);
    assert.match(sent[0], /Freigeben/);
    const after = (await db.query('SELECT delivery, proposal_message_id FROM topic_contents')).rows[0];
    assert.equal(after.delivery, null);
    assert.ok(after.proposal_message_id);
    // The delivered proposal is bound like any other: „Ablehnen“ as a reply to it is processed.
    const handled = await handleTopicReply(d, { id: 'wamid.op.1', from: OPERATOR, body: 'Ablehnen', replyToMessageId: after.proposal_message_id });
    assert.equal(handled, true);
    assert.equal((await db.query('SELECT stage FROM topic_contents')).rows[0].stage, 'rejected');
  } finally { await db.close(); }
});

test('held proposal: a definite Meta rejection releases the claim; an unknown result is never resent automatically', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    let open = false;
    let mode = 'reject';
    const d = deps(db, sent, { serviceWindowOpen: async () => open });
    await runTopicCron({ enabled: true, now: new Date('2026-10-19T07:05:00Z'), deps: () => d, proposalWindow: TOPIC_PROPOSAL_WINDOW });
    open = true;
    const failing = { ...d, send: async () => { if (mode === 'reject') throw new WhatsAppRejectedError(131047, 0, 400, 're-engagement'); throw new Error('network'); } };
    assert.equal(await deliverHeldProposals(failing), 0);
    assert.equal((await db.query('SELECT delivery FROM topic_contents')).rows[0].delivery, 'awaiting_window');
    mode = 'unknown';
    assert.equal(await deliverHeldProposals(failing), 0);
    assert.equal((await db.query('SELECT delivery FROM topic_contents')).rows[0].delivery, 'unknown');
    assert.equal(await deliverHeldProposals(d), 0, 'unknown delivery is not retried automatically');
    assert.equal(sent.length, 0);
  } finally { await db.close(); }
});

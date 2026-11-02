// A weekly report created while the 24 h window was closed (status 'ready', never sent) is delivered with the operator's next
// message: only the newest of the last 7 days, sent once, never without an operator message in the last 24 h.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const loadRoute = require('./helpers/load-route.cjs');

const APPROVER = '4915100000000';
async function harness() {
  const db = await pgliteDatabase();
  const sent = [];
  const weekly = loadRoute('lib/reporting/weekly.ts', {
    '../memory/db': { getDatabase: () => db },
    '../meta/connection': { cachedMetaConnection: async () => ({ resolved: false }), metaConfig: () => ({}) },
    '../whatsapp/client': { sendWhatsAppText: async body => { sent.push(body); return `wamid.weekly.${sent.length}`; },
      sendWeeklyNotificationTemplate: async () => { throw new Error('no template'); }, weeklyNotificationTemplateConfigured: () => false },
  });
  const report = (weekStart, weekEnd, createdAgo = '1 hour') => db.query(`INSERT INTO weekly_reports(week_start,week_end,status,report_text,created_at)
    VALUES($1,$2,'ready',$3,now()-$4::interval)`, [weekStart, weekEnd, `Bericht ${weekStart}`, createdAgo]);
  const inbound = (id, ago = '1 minute') => db.query("INSERT INTO whatsapp_events(message_id,wa_id,payload,received_at) VALUES($1,$2,'{}',now()-$3::interval)", [id, APPROVER, ago]);
  return { db, sent, weekly, report, inbound };
}

test('newest undelivered report of the last 7 days is sent once after an operator message', async () => {
  const env = process.env.WHATSAPP_APPROVER_WA_ID; process.env.WHATSAPP_APPROVER_WA_ID = APPROVER;
  const h = await harness();
  try {
    await h.report('2026-10-19', '2026-10-25', '8 days');
    await h.report('2026-10-26', '2026-11-01');
    await h.inbound('in.1');
    const first = await h.weekly.deliverPendingWeeklyReport(h.db);
    assert.deepEqual(first, { weekStart: '2026-10-26', status: 'sent' });
    assert.deepEqual(h.sent, ['Bericht 2026-10-26']);
    const row = (await h.db.query("SELECT status, whatsapp_message_id FROM weekly_reports WHERE week_start='2026-10-26'")).rows[0];
    assert.deepEqual(row, { status: 'sent', whatsapp_message_id: 'wamid.weekly.1' });
    // A webhook retry or the next message sends nothing again; the report older than 7 days is never sent.
    assert.deepEqual(await h.weekly.deliverPendingWeeklyReport(h.db), { status: 'none' });
    assert.equal(h.sent.length, 1);
  } finally { process.env.WHATSAPP_APPROVER_WA_ID = env; await h.db.close(); }
});

test('without an operator message in the last 24 h nothing is sent and the report stays ready', async () => {
  const env = process.env.WHATSAPP_APPROVER_WA_ID; process.env.WHATSAPP_APPROVER_WA_ID = APPROVER;
  const h = await harness();
  try {
    await h.report('2026-10-26', '2026-11-01');
    await h.inbound('in.old', '25 hours');
    const result = await h.weekly.deliverPendingWeeklyReport(h.db);
    assert.equal(result.status, 'template_required');
    assert.equal(h.sent.length, 0);
    assert.equal((await h.db.query("SELECT status FROM weekly_reports")).rows[0].status, 'ready');
  } finally { process.env.WHATSAPP_APPROVER_WA_ID = env; await h.db.close(); }
});

test('concurrent deliveries send the report exactly once (claim on whatsapp_send_attempted_at)', async () => {
  const env = process.env.WHATSAPP_APPROVER_WA_ID; process.env.WHATSAPP_APPROVER_WA_ID = APPROVER;
  const h = await harness();
  try {
    await h.report('2026-10-26', '2026-11-01');
    await h.inbound('in.1');
    await Promise.all([h.weekly.deliverPendingWeeklyReport(h.db), h.weekly.deliverPendingWeeklyReport(h.db)]);
    assert.equal(h.sent.length, 1);
  } finally { process.env.WHATSAPP_APPROVER_WA_ID = env; await h.db.close(); }
});

test('webhook: flush only for the operator, after the existing daily/topic flushes, never blocking the response', () => {
  const src = fs.readFileSync('app/api/whatsapp/webhook/route.ts', 'utf8');
  const daily = src.indexOf('await sendPendingDailyApprovals(getDatabase())');
  const topic = src.indexOf('await deliverHeldProposals(topicPipelineDeps())');
  const flush = src.indexOf('await deliverPendingWeeklyReport(getDatabase())');
  const response = src.lastIndexOf('return new Response("EVENT_RECEIVED"');
  assert.ok(daily > 0 && topic > daily && flush > topic && response > flush, 'appended after the existing flushes, before the response');
  const block = src.slice(src.lastIndexOf('if (', flush), src.indexOf('weekly_report_flush_unavailable', flush));
  assert.match(block, /!failed && approverId/);
  assert.match(block, /message\.from\.replace\(\/\\D\/g, ""\) === approverId/);
  assert.match(block, /try \{/);
});

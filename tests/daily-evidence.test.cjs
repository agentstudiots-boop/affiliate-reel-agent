const { test } = require('node:test');
const assert = require('node:assert/strict');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const loadRoute = require('./helpers/load-route.cjs');
const { ensureAutomationSchema } = require('../.test-build/lib/memory/ensure-automation-schema');
const E = require('../.test-build/lib/daily/evidence');
const { extractWhatsAppDeliveryStatuses } = require('../.test-build/lib/whatsapp/security');

const PHONE = '123456789';
const statusPayload = (statuses, phone = PHONE) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phone }, statuses } }] }] });

test('delivery statuses: sent/delivered/read/failed are extracted with provider error codes; other numbers and junk are ignored', () => {
  const payload = statusPayload([
    { id: 'wamid.A1', status: 'sent', timestamp: '1791900000', recipient_id: '4917000000' },
    { id: 'wamid.A1', status: 'delivered', timestamp: '1791900005' },
    { id: 'wamid.B2', status: 'failed', timestamp: '1791900010', errors: [{ code: 131047, title: 'Re-engagement message https://x.y/z' }] },
    { id: 'wamid.C3', status: 'deleted' }, { status: 'sent' }, null,
  ]);
  const result = extractWhatsAppDeliveryStatuses(payload, PHONE);
  assert.deepEqual(result.map(item => [item.messageId, item.status, item.errorCode]), [['wamid.A1', 'sent', null], ['wamid.A1', 'delivered', null], ['wamid.B2', 'failed', 131047]]);
  assert.equal(result[2].errorTitle, 'Re-engagement message [URL]');
  assert.ok(!JSON.stringify(result).includes('4917000000'), 'the recipient number is not kept');
  assert.deepEqual(extractWhatsAppDeliveryStatuses(statusPayload([{ id: 'wamid.X1', status: 'sent' }], '999'), PHONE), []);
});

test('evidence: slot runs and delivery statuses are stored idempotently and shown with the furthest status per approval', async () => {
  const db = await pgliteDatabase();
  try {
    await ensureAutomationSchema(db);
    const jobId = '22222222-2222-4222-8222-222222222222';
    await db.query("INSERT INTO daily_drafts(day,slot,job_id,status,whatsapp_message_id) VALUES('2026-10-13','afternoon',$1,'awaiting_approval','wamid.A1')", [jobId]);
    await E.recordSlotRun(db, { day: '2026-10-13', slot: 'afternoon', outcome: 'awaiting_approval', whatsapp: 'approval_sent', jobId });
    await E.recordSlotRun(db, { day: '2026-10-13', slot: null, outcome: 'outside_berlin_slot' });
    await E.recordSlotRun(db, { day: '2026-10-12', slot: 'morning', outcome: 'awaiting_approval', whatsapp: 'template_required', reason: 'see https://secret.example/x' });
    const statuses = extractWhatsAppDeliveryStatuses(statusPayload([{ id: 'wamid.A1', status: 'sent', timestamp: '1791900000' }, { id: 'wamid.A1', status: 'delivered', timestamp: '1791900005' }]), PHONE);
    await E.recordDeliveryStatuses(db, statuses);
    await E.recordDeliveryStatuses(db, statuses); // Meta redelivers: no duplicates
    assert.equal((await db.query('SELECT count(*)::int AS n FROM whatsapp_delivery_statuses')).rows[0].n, 2);
    assert.equal((await E.deliveryStatusOf(db, ['wamid.A1'])).get('wamid.A1').status, 'delivered');
    const lines = await E.slotEvidenceLines(db, '', new Date());
    const text = lines.join('\n');
    assert.match(text, /WhatsApp-Fenster geschlossen/);
    assert.match(text, /Cron Abend: awaiting_approval · Freigabe gesendet · Zustellung: zugestellt/);
    assert.match(text, /Cron Vormittag: awaiting_approval · wartet: dein 24-h-WhatsApp-Fenster war geschlossen/);
    assert.match(text, /Cron außerhalb der Slots: outside_berlin_slot/);
    assert.ok(!text.includes('secret.example'));
  } finally { await db.close(); }
});

test('evidence: the operator service window closes 24 h after the last operator message', async () => {
  const db = await pgliteDatabase();
  try {
    await ensureAutomationSchema(db);
    const now = new Date('2026-10-13T12:00:00Z');
    assert.equal(await E.serviceWindowClosesAt(db, '4917', now), null);
    await db.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload,received_at) VALUES('wamid.in','4917','approve','{}','2026-10-13T08:30:00Z')");
    assert.equal((await E.serviceWindowClosesAt(db, '+49 17', now)).toISOString(), '2026-10-14T08:30:00.000Z');
    assert.equal(await E.serviceWindowClosesAt(db, '4917', new Date('2026-10-14T09:00:00Z')), null);
  } finally { await db.close(); }
});

test('cron route: every scheduled invocation leaves durable evidence (result, outside window, error) without changing the response', async () => {
  const db = await pgliteDatabase();
  const env = { ...process.env };
  process.env.CRON_SECRET = 'cron-secret-test';
  try {
    await ensureAutomationSchema(db);
    let next = { status: 'awaiting_approval', jobId: '33333333-3333-4333-8333-333333333333', whatsapp: 'template_required' };
    const route = loadRoute('app/api/cron/daily-draft/route.ts', {
      '@/lib/daily/draft': { createDailyDraft: async () => { if (next instanceof Error) throw next; return next; } },
      '@/lib/memory/db': { getDatabase: () => db },
    });
    const call = () => route.GET(new Request('https://x/api/cron/daily-draft', { headers: { authorization: 'Bearer cron-secret-test' } }));
    const realNow = Date.now;
    const at = iso => { Date.now = () => Date.parse(iso); global.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [Date.parse(iso)])); } static now() { return Date.parse(iso); } }; };
    const OriginalDate = Date;
    try {
      at('2026-10-13T16:05:00Z');
      assert.equal((await (await call()).json()).whatsapp, 'template_required');
      next = new Error('Postgres weg');
      assert.equal((await call()).status, 503);
      at('2026-10-13T14:05:00Z');
      assert.equal((await (await call()).json()).status, 'outside_berlin_slot');
    } finally { global.Date = OriginalDate; Date.now = realNow; }
    const rows = (await db.query('SELECT slot, outcome, whatsapp, reason FROM daily_slot_runs')).rows;
    const key = row => JSON.stringify([row.slot, row.outcome, row.whatsapp]);
    assert.deepEqual(rows.map(key).sort(), [['afternoon', 'awaiting_approval', 'template_required'], ['afternoon', 'error', null], [null, 'outside_berlin_slot', null]].map(item => JSON.stringify(item)).sort());
    assert.equal(rows.find(row => row.outcome === 'error').reason, 'Postgres weg');
    // Unauthorized calls leave nothing behind.
    await route.GET(new Request('https://x/api/cron/daily-draft'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM daily_slot_runs')).rows[0].n, 3);
  } finally { process.env = env; await db.close(); }
});

test('webhook: a status-only Meta callback is stored as delivery proof and always answered 200, even when storage fails', async () => {
  const { createHmac } = require('node:crypto');
  const env = { ...process.env };
  Object.assign(process.env, { META_APP_SECRET: 'app-secret', WHATSAPP_PHONE_NUMBER_ID: PHONE });
  const db = await pgliteDatabase();
  try {
    await ensureAutomationSchema(db);
    let broken = false;
    const route = loadRoute('app/api/whatsapp/webhook/route.ts', {
      'next/server': { after: () => {} },
      '@/lib/memory/db': { getDatabase: () => { if (broken) throw new Error('db down'); return db; } },
      '@/lib/production/repository': { productionRepository: () => { throw new Error('must not be needed for statuses'); } },
      '@/lib/daily/draft': { sendDailyApproval: async () => true, sendPendingDailyApprovals: async () => 0, createDailyDraft: async () => ({}) },
    });
    const post = payload => { const raw = JSON.stringify(payload); return route.POST(new Request('https://local.test/api/whatsapp/webhook', { method: 'POST',
      headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}` }, body: raw })); };
    const response = await post(statusPayload([{ id: 'wamid.APPROVAL', status: 'delivered', timestamp: '1791900005' }]));
    assert.equal(response.status, 200);
    assert.deepEqual((await db.query('SELECT message_id, status FROM whatsapp_delivery_statuses')).rows, [{ message_id: 'wamid.APPROVAL', status: 'delivered' }]);
    broken = true;
    assert.equal((await post(statusPayload([{ id: 'wamid.APPROVAL', status: 'read', timestamp: '1791900009' }]))).status, 200, 'storage failure never triggers Meta redelivery');
    // Unsigned callbacks are still refused before anything is stored.
    const raw = JSON.stringify(statusPayload([{ id: 'wamid.FAKE', status: 'delivered' }]));
    assert.equal((await route.POST(new Request('https://local.test/x', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=00' }, body: raw }))).status, 401);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM whatsapp_delivery_statuses WHERE message_id='wamid.FAKE'")).rows[0].n, 0);
  } finally { process.env = env; await db.close(); }
});

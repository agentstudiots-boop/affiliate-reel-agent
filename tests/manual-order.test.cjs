const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadRoute = require('./helpers/load-route.cjs');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { approveContent } = require('./helpers/approve-content.cjs');
const L = '../.test-build/lib';
const { manualOrderCommand, handleManualOrder } = require(`${L}/whatsapp/manual-order`);
const { loadActiveOrder, startActiveOrder, settleActiveOrder } = require(`${L}/whatsapp/active-context`);
const { routeOperatorMessage } = require(`${L}/whatsapp/router`);
const { loadRouteContext } = require(`${L}/whatsapp/route-context`);
const { productionRepository } = require(`${L}/production/repository`);
const { memoryRepository } = require(`${L}/memory/repository`);
const { publicationRepository, IDENTICAL_CONTENT_PUBLISHED } = require(`${L}/meta/publication-gate`);
const { runContentJob } = require(`${L}/content/orchestrator`);
const whatsappClient = require(`${L}/whatsapp/client`);

const OPERATOR = '491234';
const verified = (name, asin) => ({ name, productVerifiedName: name, productVerifiedAt: new Date().toISOString(), asin,
  sourceUrl: `https://www.amazon.de/dp/${asin}`, affiliateUrl: `https://www.amazon.de/dp/${asin}?tag=alltaeglichle-21`,
  price: '', targetGroup: 'Haushalte', benefits: 'Eignung vor dem Kauf prüfen', notes: '' });
const ROBOROCK = verified('Roborock Qrevo Edge 2 Saugroboter mit Wischfunktion', 'B0DROBO002');
const OTHER_VACUUM = verified('Saugroboter Modell R', 'B0ABCD1234');
const BLANKET = verified('Kuscheldecke', 'B000000001');
const CATALOG = { 'roborock qrevo edge 2': ROBOROCK, roborock: ROBOROCK, saugroboter: OTHER_VACUUM, kuscheldecke: BLANKET };

// Real draft planner + real TrendScout cooldown logic; only the web/Amazon lookups and WhatsApp transport are faked.
async function fixture(t, over = {}) {
  const db = await pgliteDatabase(); t.after(() => db.close());
  const old = process.env.WHATSAPP_APPROVER_WA_ID; process.env.WHATSAPP_APPROVER_WA_ID = OPERATOR;
  t.after(() => { if (old === undefined) delete process.env.WHATSAPP_APPROVER_WA_ID; else process.env.WHATSAPP_APPROVER_WA_ID = old; });
  t.mock.method(global, 'fetch', async () => { throw new Error('no network in tests'); });
  const sent = [], searches = [], drafts = [];
  const lookup = async name => {
    if (over.resolverError) throw new Error(over.resolverError);
    const product = CATALOG[String(name).toLocaleLowerCase('de-DE')];
    if (!product) throw new Error('product_unresolved');
    return product;
  };
  const scout = loadRoute('lib/orchestrator.ts', {
    '@/lib/agents/product-scout': { seedIdeas: () => [], scoutProducts: async search => { searches.push(search ?? null);
      const names = search ? [search] : ['Roborock Qrevo Edge 2'];
      return { output: { summary: '', researchedAt: new Date().toISOString(), candidates: names.map(name => ({ name, kind: 'Dauerläufer', searchQuery: name,
        category: 'Haushalt', targetGroup: 'Haushalte', reelIdea: '', whyNow: 'Gezielte Suche' })) }, sources: [] }; } },
    '@/lib/product-resolver': { findAmazonProduct: lookup, resolveAmazonProduct: async product => product },
    '@/lib/memory/db': { getDatabase: () => db }, '@/lib/agents/product-reviewer': {}, '@/lib/agents/script-writer': {}, '@/lib/content/orchestrator': {},
  });
  const daily = loadRoute('lib/daily/draft.ts', {
    '@/lib/orchestrator': { runProductScout: scout.runProductScout, runContentJob },
    '@/lib/memory/db': { getDatabase: () => db },
    '@/lib/product-resolver': { ...require(`${L}/product-resolver`), findAmazonProductByAsin: async asin => {
      if (over.resolverError) throw new Error(over.resolverError);
      return Object.values(CATALOG).find(product => product.asin === asin); } },
    '@/lib/whatsapp/client': { ...whatsappClient, sendWhatsAppText: async body => { sent.push(body); return `wamid.approval.${sent.length}`; },
      dailyNotificationTemplateConfigured: () => false, sendDailyNotificationTemplate: async () => { throw new Error('unexpected template'); } },
  });
  const start = async (...args) => { drafts.push(args); return daily.createDailyDraft(...args); };
  const send = async body => { sent.push(body); return `wamid.out.${sent.length}`; };
  const message = (id, body, replyToMessageId = null) => ({ id, from: OPERATOR, body, replyToMessageId, payload: {} });
  const order = (id, body, replyTo = null) => handleManualOrder(message(id, body, replyTo), { database: () => db, start, send });
  const jobs = async () => (await db.query("SELECT id,status,opportunity->'product'->>'asin' AS asin FROM content_jobs ORDER BY created_at")).rows;
  const approvalOf = async jobId => String((await db.query('SELECT whatsapp_message_id FROM daily_drafts WHERE job_id=$1', [jobId])).rows[0].whatsapp_message_id);
  // An earlier robot vacuum within the last 7 days: the whole family "robot_vacuum" is on the TrendScout cooldown.
  async function earlierVacuum() {
    await db.query("INSERT INTO whatsapp_events(message_id,wa_id,body,payload) VALUES('window','491234','Hallo','{}')");
    const result = await daily.createDailyDraft('2026-10-08', 'manual:earlier', undefined, 'Saugroboter');
    assert.equal(result.status, 'awaiting_approval', JSON.stringify(result));
    return result.jobId;
  }
  return { db, daily, scout, start, send, sent, searches, drafts, message, order, jobs, approvalOf, earlierVacuum };
}

test('recognises explicit product orders and follow-ups deterministically; questions and approval words stay untouched', () => {
  assert.deepEqual(manualOrderCommand('Erstelle einen Beitrag zum Roborock Qrevo Edge 2.'), { kind: 'named', product: 'Roborock Qrevo Edge 2', formatWish: 'image', anyway: false });
  assert.deepEqual(manualOrderCommand('Bewirb bitte trotzdem den Roborock'), { kind: 'named', product: 'Roborock', formatWish: null, anyway: true });
  assert.deepEqual(manualOrderCommand('Nimm genau dieses Produkt.'), { kind: 'referential', formatWish: null });
  assert.deepEqual(manualOrderCommand('Mach daraus einen Reel-Entwurf.'), { kind: 'referential', formatWish: 'reel' });
  assert.deepEqual(manualOrderCommand('Ich möchte dieses Produkt bewerben.'), { kind: 'referential', formatWish: null });
  assert.deepEqual(manualOrderCommand('Mach es trotzdem.'), { kind: 'referential', formatWish: null });
  assert.deepEqual(manualOrderCommand('Ich möchte den Roborock Qrevo Edge 2 bewerben'), { kind: 'named', product: 'Roborock Qrevo Edge 2', formatWish: null, anyway: false });
  for (const other of ['Freigeben', 'Ablehnen', 'Warum dieses Produkt?', 'Erstelle einen Beitrag zum Thema Herbst', 'Mach das Bild heller', 'Nimm lieber ein anderes Bild', 'Status', 'Artikelsuche Backmatte'])
    assert.equal(manualOrderCommand(other), null, other);
});

test('A: the automatic TrendScout keeps the 7-day cooldown for a product family used recently', async t => {
  const f = await fixture(t);
  await f.earlierVacuum();
  const report = await f.scout.runProductScout(undefined, '2026-10-09:manual:open');
  assert.equal(report.candidates.length, 0);
  assert.equal(report.cooldownBlocked, 1);
  const open = await f.daily.createDailyDraft('2026-10-09', 'manual:open-search');
  assert.equal(open.status, 'needs_input'); assert.equal(open.reason, 'product_repeat_blocked');
  // Without an operator mandate the named search stays under the cooldown as well (unchanged automatic semantics).
  const unmandated = await f.daily.createDailyDraft('2026-10-09', 'manual:no-mandate', undefined, 'Roborock Qrevo Edge 2');
  assert.equal(unmandated.reason, 'product_repeat_blocked');
  assert.equal((await f.jobs()).length, 1);
});

test('B: an explicit WhatsApp order overrides the TrendScout cooldown and runs through the normal content pipeline', async t => {
  const f = await fixture(t);
  await f.earlierVacuum();
  assert.equal(await f.order('wamid.roborock', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2.'), true);
  // Honest progress message first: taken over, being created – never "created" before it exists.
  assert.match(f.sent[f.sent.length - 2], /Ich habe den Auftrag „Roborock Qrevo Edge 2“ übernommen und erstelle jetzt den Entwurf/);
  assert.doesNotMatch(f.sent.join('\n'), /habe den Beitrag erstellt|wurde veröffentlicht|ist veröffentlicht/);
  const jobs = await f.jobs();
  assert.equal(jobs.length, 2); assert.equal(jobs[1].asin, 'B0DROBO002'); assert.equal(jobs[1].status, 'awaiting_approval');
  assert.deepEqual(f.drafts[0].slice(2), [undefined, 'Roborock Qrevo Edge 2', { mandate: true }]);
  const scoutReport = (await f.db.query('SELECT scout_report FROM daily_drafts WHERE job_id=$1', [jobs[1].id])).rows[0].scout_report;
  assert.equal(scoutReport.operatorMandate, true);
  const active = await loadActiveOrder(f.db, OPERATOR);
  assert.equal(active.status, 'awaiting_approval'); assert.equal(active.jobId, jobs[1].id); assert.equal(active.asin, 'B0DROBO002');
  // The draft's own content approval message is the confirmation that it exists.
  assert.match(f.sent.at(-1), /Roborock/);
});

test('C: a previously rejected product can be ordered again by an explicit operator wish', async t => {
  const f = await fixture(t);
  await f.order('wamid.first', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2');
  const [first] = await f.jobs();
  const inbound = productionRepository(f.db);
  await inbound.applyIncomingWhatsApp({ id: 'wamid.reject', from: OPERATOR, body: 'Ablehnen', replyToMessageId: await f.approvalOf(first.id), payload: {} });
  assert.equal((await f.db.query('SELECT status FROM daily_drafts WHERE job_id=$1', [first.id])).rows[0].status, 'rejected');
  // Automatic selection still avoids it …
  assert.equal((await f.daily.createDailyDraft('2026-10-09', 'manual:auto-after-reject')).reason, 'product_repeat_blocked');
  // … the operator's explicit wish does not.
  assert.equal(await f.order('wamid.again', 'Bewirb bitte trotzdem den Roborock'), true);
  const jobs = await f.jobs();
  assert.equal(jobs.filter(job => job.asin === 'B0DROBO002').length, 2);
  assert.equal(jobs.at(-1).status, 'awaiting_approval');
  assert.match(f.sent.find(text => /Ich setze den Auftrag/.test(text)), /Roborock/);
});

test('D + E: „Mach es trotzdem“ continues the Roborock order; an older open draft never takes over the context', async t => {
  const f = await fixture(t);
  // Older open draft (another product) …
  await f.db.query("INSERT INTO whatsapp_events(message_id,wa_id,body,payload) VALUES('window','491234','Hallo','{}')");
  const older = await f.daily.createDailyDraft('2026-10-09', 'manual:older', undefined, 'Kuscheldecke');
  assert.equal(older.status, 'awaiting_approval');
  // … then the Roborock order that the previous deployment had stopped with the 7-day block.
  await new Promise(resolve => setTimeout(resolve, 5));
  await startActiveOrder(f.db, { waId: OPERATOR, messageId: 'wamid.blocked', productLabel: 'Roborock Qrevo Edge 2', searchTerm: 'Roborock Qrevo Edge 2' });
  await settleActiveOrder(f.db, { waId: OPERATOR, messageId: 'wamid.blocked', status: 'blocked', reason: 'product_repeat_blocked' });
  // E (router): a short change wish while the Roborock order has no draft is not applied to the older draft, even if the
  // model guesses that draft.
  const routed = await routeOperatorMessage(f.message('wamid.bild', 'Nimm lieber ein anderes Bild'), { database: f.db, send: f.send,
    interpret: async () => ({ intent: 'revise_image', draft_id: older.jobId, search_query: null, reject_current: false, operator_note: null, answer: null,
      image_instruction: 'Ein anderes Motiv verwenden, Grundkonzept beibehalten', category_name: null, category_create: false, category_force_new: false,
      clarification_question: null, confidence: 0.95, ambiguity: 'none' }),
    searchProduct: async () => { throw new Error('unexpected search'); }, converse: async () => { throw new Error('unexpected chat'); } });
  assert.deepEqual(routed, { handled: true });
  assert.match(f.sent.at(-1), /aktueller Auftrag ist „Roborock Qrevo Edge 2“.*An älteren Entwürfen ändere ich deshalb nichts/s);
  const context = await loadRouteContext(f.db, OPERATOR, 'wamid.ctx', null);
  assert.equal(context.focus, null); assert.equal(context.active_order.product, 'Roborock Qrevo Edge 2');
  // D: the follow-up resumes exactly the Roborock order.
  assert.equal(await f.order('wamid.anyway', 'Mach es trotzdem'), true);
  assert.equal(f.drafts.at(-1)[3], 'Roborock Qrevo Edge 2');
  assert.ok(!f.searches.includes('Kuscheldecke') || f.searches.lastIndexOf('Kuscheldecke') < f.searches.lastIndexOf('Roborock Qrevo Edge 2'));
  const roborock = (await f.jobs()).find(job => job.asin === 'B0DROBO002');
  assert.equal(roborock.status, 'awaiting_approval');
  assert.match(f.sent.find(text => /Ich setze den Auftrag/.test(text)), /„Roborock Qrevo Edge 2“.*7-Tage-Sperre gilt nur für automatische Vorschläge/s);
  // E: with the Roborock draft open, the same change wish now targets the Roborock draft (not the older one).
  const next = await routeOperatorMessage(f.message('wamid.bild2', 'Nimm lieber ein anderes Bild'), { database: f.db, send: f.send,
    interpret: async () => ({ intent: 'revise_image', draft_id: null, search_query: null, reject_current: false, operator_note: null, answer: null,
      image_instruction: 'Ein anderes Motiv verwenden, Grundkonzept beibehalten', category_name: null, category_create: false, category_force_new: false,
      clarification_question: null, confidence: 0.95, ambiguity: 'none' }),
    searchProduct: async () => { throw new Error('unexpected search'); }, converse: async () => { throw new Error('unexpected chat'); } });
  assert.equal(next.handled, false);
  assert.equal(next.message.replyToMessageId, await f.approvalOf(roborock.id));
});

test('F: a genuinely ambiguous follow-up asks instead of picking a product', async t => {
  const f = await fixture(t);
  await f.db.query("INSERT INTO whatsapp_events(message_id,wa_id,body,payload) VALUES('window','491234','Hallo','{}')");
  assert.equal((await f.daily.createDailyDraft('2026-10-09', 'manual:a', undefined, 'Kuscheldecke')).status, 'awaiting_approval');
  assert.equal((await f.daily.createDailyDraft('2026-10-09', 'manual:b', undefined, 'Saugroboter')).status, 'awaiting_approval');
  await f.db.query('DELETE FROM whatsapp_active_context'); // no explicit active order: two drafts are equally likely
  const before = f.drafts.length;
  assert.equal(await f.order('wamid.which', 'Nimm genau dieses Produkt'), true);
  assert.match(f.sent.at(-1), /^Welches Produkt meinst du\?.*Es wurde nichts gestartet\./s);
  assert.equal(f.drafts.length, before);
  // Without any open draft and order the existing chain keeps handling it (no guess).
  await f.db.query("UPDATE content_jobs SET status='rejected'");
  assert.equal(await f.order('wamid.none', 'Nimm genau dieses Produkt'), false);
});

test('G: duplicate and concurrent webhook deliveries create exactly one order', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.order('wamid.dup', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2'), f.order('wamid.dup', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2')]);
  assert.deepEqual(results, [true, true]);
  assert.equal(await f.order('wamid.dup', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2'), true);
  assert.equal(f.drafts.length, 1);
  assert.equal((await f.jobs()).length, 1);
  assert.equal(f.sent.filter(text => /übernommen und erstelle jetzt den Entwurf/.test(text)).length, 1);
  const log = (await f.db.query("SELECT action FROM whatsapp_context_log WHERE message_id='wamid.dup' ORDER BY created_at")).rows.map(row => row.action);
  assert.deepEqual(log, ['order', 'outcome:awaiting_approval']);
});

test('H: an order is never an approval; existing content and publication approvals stay in force; no duplicates', async t => {
  const f = await fixture(t);
  await f.order('wamid.order', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2');
  const [job] = await f.jobs();
  assert.equal(job.status, 'awaiting_approval');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n, 0);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM content_approval_requests WHERE status=$1', ['approved'])).rows[0].n, 0);
  // Asking again while the draft waits: no second draft, the operator is pointed to the approval.
  await f.order('wamid.again', 'Mach es trotzdem');
  assert.match(f.sent.at(-1), /wartet bereits auf deine Inhaltsfreigabe/);
  assert.equal((await f.jobs()).length, 1);
  // A second explicit order for the same product while its draft is still open is refused by the duplicate protection.
  await f.db.query('DELETE FROM whatsapp_active_context');
  await f.order('wamid.parallel', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2');
  assert.match(f.sent.at(-1), /läuft bereits ein Entwurf oder eine Veröffentlichung/);
  assert.equal((await f.jobs()).length, 1);
});

test('H: an identical post that is already live is never published a second time', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  const memory = memoryRepository(db), publication = publicationRepository(db), inbound = productionRepository(db);
  const old = process.env.WHATSAPP_APPROVER_WA_ID; process.env.WHATSAPP_APPROVER_WA_ID = OPERATOR;
  t.after(() => { if (old === undefined) delete process.env.WHATSAPP_APPROVER_WA_ID; else process.env.WHATSAPP_APPROVER_WA_ID = old; });
  const { opportunitySchema } = require(`${L}/content/schema`);
  const opportunity = opportunitySchema.parse({ product: { ...BLANKET, affiliateUrl: 'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21' },
    useCase: 'Ein kühler Herbstabend auf dem Sofa mit einer Decke.', targetPlatform: 'facebook', budget: 'low' });
  const draft = async () => {
    const id = crypto.randomUUID();
    await memory.claim(id, opportunity, 'reference');
    await runContentJob(opportunity, { id, onUpdate: memory.save, loadLearning: memory.learn });
    await approveContent(db, memory, id);
    return id;
  };
  const first = await draft();
  const pending = await publication.prepare(first, OPERATOR);
  await publication.claimImage(pending.id);
  await publication.bindImage(pending.id, `https://x.public.blob.vercel-storage.com/generated/facebook/${first}/${'a'.repeat(64)}.png`);
  await publication.claimWhatsAppSend(pending.id); await publication.bindMessage(pending.id, 'wamid.pub1');
  await inbound.applyIncomingWhatsApp({ id: 'wamid.ok1', from: OPERATOR, body: 'Freigeben', replyToMessageId: 'wamid.pub1', payload: {} });
  const claimed = await publication.claimPublish(pending.id);
  await publication.published(claimed.id, 'fb1', 'https://www.facebook.com/x/posts/1');
  const second = await draft();
  await assert.rejects(publication.prepare(second, OPERATOR), new RegExp(IDENTICAL_CONTENT_PUBLISHED.slice(0, 40)));
});

test('I: a manual order never bypasses the safety checks (verified Amazon page, content review)', async t => {
  const f = await fixture(t, { resolverError: 'amazon_verification_blocked' });
  await f.order('wamid.unsafe', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2');
  assert.equal((await f.jobs()).length, 0);
  assert.match(f.sent.at(-1), /Amazon hat die automatische Prüfung der Produktseite blockiert.*nichts veröffentlicht/s);
  const active = await loadActiveOrder(f.db, OPERATOR);
  assert.equal(active.status, 'blocked'); assert.equal(active.reason, 'amazon_verification_blocked');
  // The planner's own checks run for mandated drafts too: the job goes through the content orchestrator and its review.
  const g = await fixture(t);
  await g.order('wamid.safe', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2');
  const [job] = await g.jobs();
  const snapshot = (await g.db.query('SELECT snapshot FROM content_jobs WHERE id=$1', [job.id])).rows[0].snapshot;
  assert.equal(snapshot.status, 'awaiting_approval');
  assert.ok(snapshot.events.length > 0, 'content orchestrator ran its normal steps');
  assert.match(snapshot.content.caption, /^Werbung/);
});

test('Reel wish: recognised and noted on the active order, honestly not started', async t => {
  const f = await fixture(t);
  await f.order('wamid.order', 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2');
  const drafts = f.drafts.length;
  await f.order('wamid.reel', 'Mach daraus einen Reel-Entwurf');
  assert.match(f.sent.at(-1), /Reel-Wunsch für „Roborock Qrevo Edge 2/);
  assert.match(f.sent.at(-1), /Es wurde nichts gestartet/);
  assert.equal(f.drafts.length, drafts);
  assert.equal((await loadActiveOrder(f.db, OPERATOR)).formatWish, 'reel');
});

test('G (webhook): a redelivered signed order message starts exactly one order through the real webhook route', async t => {
  const f = await fixture(t);
  const { createHmac } = require('node:crypto');
  const env = { WHATSAPP_PHONE_NUMBER_ID: '123456', META_APP_SECRET: 'local-webhook-test' };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } });
  const route = loadRoute('app/api/whatsapp/webhook/route.ts', {
    'next/server': { after: () => {} },
    '@/lib/memory/db': { getDatabase: () => f.db },
    '@/lib/production/repository': { productionRepository: () => productionRepository(f.db) },
    '@/lib/whatsapp/client': { ...whatsappClient, sendWhatsAppText: f.send },
    '@/lib/daily/draft': { createDailyDraft: f.start, sendDailyApproval: async () => { throw new Error('unexpected'); }, sendPendingDailyApprovals: async () => 0 },
    '@/lib/automation/continue': { continuePendingReels: async () => ({ considered: 0, advanced: 0, blocked: 0 }), recoverRunwayPreflightIncident: async () => 0,
      latestInstagramReelStatus: async () => '' },
  });
  const request = () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID },
      messages: [{ id: 'wamid.webhook.order', from: OPERATOR, type: 'text', text: { body: 'Erstelle einen Beitrag zum Roborock Qrevo Edge 2' } }] } }] }] });
    return new Request('https://local.test/api/whatsapp/webhook', { method: 'POST',
      headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex')}` }, body });
  };
  const responses = await Promise.all([route.POST(request()), route.POST(request())]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(f.drafts.length, 1);
  assert.equal((await f.jobs()).length, 1);
  assert.equal((await loadActiveOrder(f.db, OPERATOR)).status, 'awaiting_approval');
});

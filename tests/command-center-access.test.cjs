const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../.test-build/lib/architecture/model');
const R = require('../.test-build/lib/architecture/runtime');
const S = require('../.test-build/lib/architecture/snapshot');
const { checkCapabilities } = require('../.test-build/lib/capabilities');
const { classifyPath } = require('../.test-build/lib/security/access-policy');
const { ensureAutomationSchema } = require('../.test-build/lib/memory/ensure-automation-schema');
const pgliteDatabase = require('./helpers/pglite-db.cjs');

// Command Center reachable and understandable (Auftrag 15.10.): own protected page, link from the studio, and for every
// component: what it does, inputs, outputs, AI model, status and last success – only from configuration or database evidence.
const read = file => fs.readFileSync(file, 'utf8');
const NOW = new Date('2026-10-15T12:00:00Z');
const PROD = { VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'postgres://x', REPLICATE_API_TOKEN: 'r8_x', TAVILY_API_KEY: 't', WHATSAPP_ACCESS_TOKEN: 'x',
  WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_VERIFY_TOKEN: 'x', META_APP_SECRET: 'x', WHATSAPP_APPROVER_WA_ID: '49', CONTENT_STUDIO_PASSWORD: 'x', CRON_SECRET: 'x' };
const snapshot = (extra = {}) => ({ available: true, reason: null, generatedAt: NOW.toISOString(), topic: null, affiliate: null, publications: null, chances: null, vision: null, visualJobs: null, activity: null, ...extra });
const runtime = (snap, env = PROD) => R.computeRuntime({ capabilities: checkCapabilities(env), snapshot: snap, env, now: NOW });
const hoursAgo = h => new Date(NOW.getTime() - h * 3_600_000).toISOString();

test('the Command Center has its own page /architecture, protected like the studio; the studio links to it prominently', () => {
  assert.ok(fs.existsSync('app/architecture/page.tsx'));
  assert.match(read('app/architecture/page.tsx'), /<CommandCenter standalone \/>/);
  assert.equal(classifyPath('/architecture'), 'internal_page', 'login required (proxy.ts)');
  assert.equal(classifyPath('/api/architecture'), 'internal_api');
  assert.match(read('app/api/architecture/route.ts'), /if \(!authorized\(request\)\) return unauthorizedResponse\(\)/);
  assert.match(read('app/page.tsx'), /href="\/architecture"[^>]*>Command Center öffnen/);
  assert.match(read('app/architecture/command-center.tsx'), /href="\/architecture"/, 'the old dialog launcher links to the page too');
  assert.match(read('app/architecture/command-center.tsx'), /Steckbriefe/);
});

test('the four research components are distinct, explained in plain words and connected as documented (no redundancy)', () => {
  const byId = Object.fromEntries(M.NODES.map(node => [node.id, node]));
  for (const id of ['trend-agent', 'topic-scout', 'trendsetter', 'jarvis']) assert.ok(byId[id]?.plain.length > 30, id);
  assert.match(byId['trend-agent'].plain, /Produkt- oder Themenchance/);
  assert.match(byId['trendsetter'].summary, /Recherchiert nicht selbst/);
  assert.match(byId['topic-scout'].aiModel, /Kein KI-Modell/);
  const edge = (from, to) => M.EDGES.some(item => item.from === from && item.to === to);
  assert.ok(edge('trend-agent', 'trendsetter') && edge('topic-scout', 'trendsetter') && edge('trendsetter', 'jarvis'));
  assert.ok(edge('jarvis', 'product-scout') && edge('jarvis', 'topic-orchestrator'));
});

test('AI model per component comes from the code constants, not from guesses', () => {
  const contentModel = read('lib/content/model.ts').match(/const MODEL ?= ?"([^"]+)"/)[1];
  const routerModel = read('lib/whatsapp/route-llm.ts').match(/ROUTER_MODEL = "([^"]+)"/)[1];
  const byId = Object.fromEntries(M.NODES.map(node => [node.id, node]));
  assert.ok(byId['trend-agent'].aiModel.includes(contentModel), `trend agent uses ${contentModel}`);
  assert.ok(byId['creative-agent'].aiModel.includes(contentModel));
  assert.ok(byId['whatsapp'].aiModel.includes(routerModel));
  assert.ok(byId['vision-gate'].aiModel.includes(routerModel));
  for (const node of M.NODES.filter(item => item.kind === 'agent' && item.since !== 'none')) assert.ok(node.aiModel, `${node.id} names its model`);
  // An override in the environment is shown as such.
  assert.match(runtime(snapshot(), { ...PROD, IMAGE_QUALITY_MODEL: 'some/vision-model' }).nodes['vision-gate'].aiModel, /some\/vision-model.*IMAGE_QUALITY_MODEL/);
});

test('last success only from database evidence; a recent failure after the last success shows an error; no evidence says so', () => {
  const none = runtime(snapshot());
  assert.equal(none.nodes['trend-agent'].lastRun, undefined, 'no evidence → no invented date');
  assert.equal(none.nodes['trend-agent'].status, 'ready');
  const activity = { models: { content_trend: { lastOkAt: hoursAgo(5), lastAt: hoursAgo(1), lastOk: false, lastError: 'http_429' },
      whatsapp_router: { lastOkAt: hoursAgo(2), lastAt: hoursAgo(2), lastOk: true, lastError: null } },
    cron: { lastOkAt: hoursAgo(3), lastAt: hoursAgo(3), lastOk: true, lastError: null, lastOutcome: 'awaiting_approval' },
    whatsappInboundAt: hoursAgo(1.5), drafts: { lastAt: hoursAgo(3), lastMode: 'reference' }, productVerifiedAt: hoursAgo(3), contentApprovedAt: null,
    chancesSeenAt: null, topicRun: null, affiliatePublished: { facebook: hoursAgo(30), instagram: null } };
  const state = runtime(snapshot({ activity }));
  assert.equal(state.nodes['trend-agent'].status, 'error');
  assert.match(state.nodes['trend-agent'].reason, /fehlgeschlagen.*http_429/);
  assert.equal(state.nodes['trend-agent'].lastRun.okAt, hoursAgo(5));
  assert.equal(state.nodes.whatsapp.lastRun.okAt, hoursAgo(1.5), 'newest evidence wins');
  assert.equal(state.nodes.jarvis.lastRun.label, 'Letzter Entwurf zur Freigabe übergeben (Referenzmodus)');
  assert.equal(state.nodes.cron.lastRun.okAt, hoursAgo(3));
  assert.equal(state.nodes['product-scout'].lastRun.okAt, hoursAgo(3));
  assert.equal(state.nodes.facebook.lastRun.okAt, hoursAgo(30));
  assert.equal(state.nodes.instagram.lastRun, undefined);
  assert.equal(state.nodes['content-approval'].lastRun, undefined);
  // An old failure (> 24 h) does not paint the component red.
  const old = runtime(snapshot({ activity: { ...activity, models: { content_trend: { lastOkAt: hoursAgo(80), lastAt: hoursAgo(50), lastOk: false, lastError: 'x' } } } }));
  assert.equal(old.nodes['trend-agent'].status, 'ready');
  // A switched-off component stays switched off even with old evidence.
  assert.equal(runtime(snapshot({ activity })).nodes['topic-orchestrator'].status, 'disabled');
});

test('snapshot reads the activity evidence from a migrated database with SELECT only', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  await ensureAutomationSchema(db);
  await db.query("INSERT INTO model_calls(agent,model,ok,latency_ms,created_at) VALUES('content_trend','openai/gpt-4.1',true,900,now()-interval '2 hours'),('content_trend','openai/gpt-4.1',false,100,now()-interval '1 hour')");
  await db.query("UPDATE model_calls SET error_class='router_http_503' WHERE ok=false");
  await db.query("INSERT INTO daily_slot_runs(id,day,slot,outcome) VALUES(gen_random_uuid(),'2026-10-15','morning','awaiting_approval')");
  await db.query("INSERT INTO whatsapp_events(message_id,wa_id,body,payload) VALUES('wamid.1','49','Status','{}')");
  const snap = await S.readSnapshot(new Date(), () => db);
  assert.ok(snap.activity);
  assert.equal(snap.activity.models.content_trend.lastOk, false);
  assert.equal(snap.activity.models.content_trend.lastError, 'router_http_503');
  assert.ok(snap.activity.models.content_trend.lastOkAt);
  assert.equal(snap.activity.cron.lastOutcome, 'awaiting_approval');
  assert.ok(snap.activity.whatsappInboundAt);
  assert.equal(snap.activity.affiliatePublished.facebook, null);
});

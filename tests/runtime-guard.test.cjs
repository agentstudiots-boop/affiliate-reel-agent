const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../.test-build/lib/security/runtime-guard');
const G = require('../.test-build/lib/publishing/approval-gate');
const { livePublishCapability } = require('../.test-build/lib/capabilities');
const { setEventSink } = require('../.test-build/lib/observability/events');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { liveEnv } = require('./helpers/live-env.cjs');
const loadRoute = require('./helpers/load-route.cjs');

setEventSink(() => {});
const KINDS = ['database', 'migrate', 'publish', 'message', 'storage_write', 'scheduled_job', 'paid_provider'];
const quiet = t => t.mock.method(console, 'warn', () => {});
const withVercelEnv = (t, value, extra = {}) => {
  const env = { VERCEL_ENV: value, ...extra };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, v] of Object.entries(env)) { if (v === undefined) delete process.env[key]; else process.env[key] = v; }
  t.after(() => { for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
};

test('production and local (no VERCEL_ENV) keep every effect allowed: production behaviour and unit tests are unchanged', () => {
  for (const kind of KINDS) {
    assert.deepEqual(R.effectDecision(kind, { VERCEL_ENV: 'production' }), { ok: true });
    assert.deepEqual(R.effectDecision(kind, {}), { ok: true });
  }
  assert.equal(R.runtimeEnvironment({}), 'local');
  assert.equal(R.runtimeEnvironment({ VERCEL_ENV: 'garbage' }), 'local');
});

test('preview and development block every effect by default; a bare flag value other than "true" does not open anything', () => {
  for (const environment of ['preview', 'development']) for (const kind of KINDS) {
    assert.equal(R.effectDecision(kind, { VERCEL_ENV: environment }).ok, false, `${environment}/${kind}`);
    assert.equal(R.effectDecision(kind, { VERCEL_ENV: environment, NON_PRODUCTION_SANDBOX: '1' }).ok, false);
    assert.equal(R.effectDecision(kind, { VERCEL_ENV: environment, NON_PRODUCTION_SANDBOX: 'yes' }).ok, false);
  }
});

test('sandbox declaration opens everything; the paid-call flag opens only paid providers', () => {
  for (const kind of KINDS) assert.equal(R.effectDecision(kind, { VERCEL_ENV: 'preview', NON_PRODUCTION_SANDBOX: 'true' }).ok, true);
  for (const kind of KINDS) assert.equal(R.effectDecision(kind, { VERCEL_ENV: 'preview', ALLOW_NON_PRODUCTION_PAID_CALLS: 'true' }).ok, kind === 'paid_provider');
});

test('assertEffectAllowed throws a typed error and logs only kind and environment', t => {
  const logs = []; t.mock.method(console, 'warn', line => logs.push(String(line)));
  assert.throws(() => R.assertEffectAllowed('publish', { VERCEL_ENV: 'preview' }), error => error instanceof R.NonProductionEffectError && error.kind === 'publish');
  assert.doesNotThrow(() => R.assertEffectAllowed('publish', { VERCEL_ENV: 'production' }));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /non_production_effect_blocked/);
});

test('egress filter: writes to Meta, TikTok, X, Google, Blob and paid providers are refused in preview; reads and unrelated hosts pass', () => {
  const preview = { VERCEL_ENV: 'preview' };
  const blocked = [['https://graph.facebook.com/v25.0/123/media_publish', 'POST'], ['https://open.tiktokapis.com/v2/post/publish/video/init/', 'POST'],
    ['https://api.x.com/2/tweets', 'POST'], ['https://upload.twitter.com/1.1/media/upload.json', 'POST'], ['https://www.googleapis.com/upload/youtube/v3/videos', 'POST'],
    ['https://vercel.com/api/blob/?pathname=a', 'PUT'], ['https://api.replicate.com/v1/models/x/predictions', 'POST'], ['https://api.tavily.com/search', 'POST'],
    ['https://api.heygen.com/v2/video/generate', 'POST'], ['https://faceless.so/api/v1/videos', 'POST']];
  for (const [url, method] of blocked) assert.equal(R.egressDecision(new URL(url), method, preview).ok, false, url);
  for (const [url, method] of [['https://graph.facebook.com/v25.0/me?fields=id', 'GET'], ['https://api.replicate.com/v1/predictions/abc', 'GET'], ['https://example.org/hook', 'POST'], ['https://www.amazon.de/dp/B000000000', 'GET']])
    assert.equal(R.egressDecision(new URL(url), method, preview).ok, true, url);
  for (const [url, method] of blocked) assert.equal(R.egressDecision(new URL(url), method, { VERCEL_ENV: 'production' }).ok, true);
  assert.equal(R.egressDecision(new URL('https://graph.facebook.com/x'), 'POST', { ...preview, NON_PRODUCTION_SANDBOX: 'true' }).ok, true);
});

test('guarded fetch never calls the transport for a blocked write, and passes allowed calls through', async t => {
  quiet(t);
  const calls = [];
  const wrapped = R.guardedEgressFetch(async (input, init) => { calls.push([String(input), init?.method ?? 'GET']); return new Response('ok'); }, { VERCEL_ENV: 'preview' });
  await assert.rejects(wrapped('https://graph.facebook.com/v25.0/1/feed', { method: 'POST', body: 'x' }), R.NonProductionEffectError);
  await assert.rejects(wrapped(new Request('https://api.replicate.com/v1/predictions', { method: 'POST' })), R.NonProductionEffectError);
  assert.equal(calls.length, 0);
  assert.equal(await (await wrapped('https://graph.facebook.com/v25.0/me')).text(), 'ok');
  assert.equal(calls.length, 1);
});

test('installEgressGuard wraps fetch only in preview/development without sandbox, and only once', () => {
  const marker = async () => new Response('x');
  const prod = { fetch: marker }; assert.equal(R.installEgressGuard(prod, { VERCEL_ENV: 'production' }), false); assert.equal(prod.fetch, marker);
  const local = { fetch: marker }; assert.equal(R.installEgressGuard(local, {}), false); assert.equal(local.fetch, marker);
  const sandbox = { fetch: marker }; assert.equal(R.installEgressGuard(sandbox, { VERCEL_ENV: 'preview', NON_PRODUCTION_SANDBOX: 'true' }), false);
  const preview = { fetch: marker }; assert.equal(R.installEgressGuard(preview, { VERCEL_ENV: 'preview' }), true);
  assert.notEqual(preview.fetch, marker);
  assert.equal(R.installEgressGuard(preview, { VERCEL_ENV: 'preview' }), false);
});

test('live publish capability: preview never publishes, not even the product pipeline\'s Facebook/Instagram channels', () => {
  const env = { TOPIC_LIVE_PUBLISHING: 'true', META_SYSTEM_USER_TOKEN: 't', META_PAGE_ID: '1', META_INSTAGRAM_USER_ID: '2', BLOB_READ_WRITE_TOKEN: 'b' };
  assert.deepEqual(livePublishCapability('facebook', { ...env, VERCEL_ENV: 'production' }, 'product_pipeline'), { ok: true });
  assert.deepEqual(livePublishCapability('facebook', { ...env, VERCEL_ENV: 'production' }), { ok: true });
  for (const origin of ['product_pipeline', 'topic_pipeline']) for (const platform of ['facebook', 'instagram']) {
    const decision = livePublishCapability(platform, { ...env, VERCEL_ENV: 'preview' }, origin);
    assert.equal(decision.ok, false); assert.equal(decision.reason, 'non_production_environment');
  }
  assert.equal(livePublishCapability('facebook', { ...env, VERCEL_ENV: 'preview', NON_PRODUCTION_SANDBOX: 'true' }, 'product_pipeline').ok, true);
});

test('approval gate: a fully approved version still cannot get a permit in a preview deployment, and nothing is claimed', async t => {
  quiet(t);
  const restore = liveEnv(); t.after(restore);
  const db = await pgliteDatabase(); t.after(() => db.close());
  const item = { contentId: 'tc_preview', hook: 'Hook text hier', caption: 'Caption', body: 'Text', cta: 'Speichern', links: [], disclosures: [],
    assets: [{ role: 'slide-1', kind: 'image', url: 'https://x.public.blob.vercel-storage.com/a.png', sha256: 'a'.repeat(64) }],
    variants: [{ platform: 'instagram', title: null, text: 'IG', links: [], assetRefs: ['slide-1'], mediaFormat: 'SINGLE_IMAGE', disclosure: null }] };
  const version = await G.registerContentVersion(db, item);
  await G.bindApprovalRequest(db, item.contentId, version.version, 'wamid.req');
  await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: '491701234567',
    evidence: { channel: 'whatsapp', messageId: 'wamid.dec', replyToMessageId: 'wamid.req', senderWaId: '491701234567', body: 'Freigeben' } });
  withVercelEnv(t, 'preview');
  await assert.rejects(G.authorizePublish(db, { content: item, platform: 'instagram', origin: 'cron' }), e => e instanceof G.PublishBlockedError && e.reason === 'non_production_environment');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM publish_attempts WHERE status IN ('claimed','processing','published','unknown')")).rows[0].n, 0);
  // The same approval publishes normally in production: the guard adds a restriction, it does not change the gate.
  withVercelEnv(t, 'production');
  const permit = await G.authorizePublish(db, { content: item, platform: 'instagram', origin: 'cron' });
  assert.equal(permit.platform, 'instagram');
});

test('migrations, WhatsApp sends, database handle and scheduled jobs refuse to run in preview', async t => {
  quiet(t);
  withVercelEnv(t, 'preview', { DATABASE_URL: 'postgres://prod.invalid/db', CRON_SECRET: 'cron-secret-test', WHATSAPP_ACCESS_TOKEN: 'x', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_APPROVER_WA_ID: '49170', WHATSAPP_VERIFY_TOKEN: 'v', META_APP_SECRET: 's' });
  t.mock.method(global, 'fetch', async () => { throw new Error('network must not be reached'); });
  const { applyMigrations } = require('../.test-build/lib/memory/migrations');
  const { getDatabase } = require('../.test-build/lib/memory/db');
  const { sendWhatsAppText } = require('../.test-build/lib/whatsapp/client');
  const fake = { query: async () => { throw new Error('db must not be touched'); }, exec: async () => {}, transaction: async () => { throw new Error('db must not be touched'); } };
  await assert.rejects(applyMigrations(fake), R.NonProductionEffectError);
  assert.throws(() => getDatabase(), R.NonProductionEffectError);
  await assert.rejects(sendWhatsAppText('hallo'), R.NonProductionEffectError);
  const cron = loadRoute('app/api/cron/daily-draft/route.ts', { '@/lib/daily/draft': { createDailyDraft: async () => { throw new Error('must not run'); } } });
  const response = await cron.GET(new Request('https://x.test/api/cron/daily-draft', { headers: { authorization: 'Bearer cron-secret-test' } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'skipped_non_production_environment');
  assert.equal((await cron.GET(new Request('https://x.test/api/cron/daily-draft', { headers: { authorization: 'Bearer wrong-secret-test' } }))).status, 401);
});

test('Blob writes: the guarded put refuses in preview before touching the SDK; no application module imports @vercel/blob directly', t => {
  const fs = require('node:fs'); const path = require('node:path');
  // @vercel/blob uses undici's own fetch, so the global egress filter cannot protect it: every write must use the guarded wrapper.
  const offenders = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', '.next'].includes(entry.name)) walk(full); }
    else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith(path.join('security', 'guarded-blob.ts')) && /from ["']@vercel\/blob["']/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full); } };
  walk('lib'); walk('app');
  assert.deepEqual(offenders, []);
  quiet(t);
  withVercelEnv(t, 'preview');
  const { put } = require('../.test-build/lib/security/guarded-blob');
  assert.throws(() => put('a.png', Buffer.from('x'), { access: 'public' }), R.NonProductionEffectError);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadRoute = require('./helpers/load-route.cjs');

// P-01: operator-only routes must reject anonymous and wrong access codes before ANY cost-bearing or privileged action.
const CODE = 'api-access-test-code';
function withEnv(t, extra = {}) {
  const env = { CONTENT_STUDIO_PASSWORD: CODE, ...extra };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  t.mock.method(global, 'fetch', async () => { throw new Error('Unexpected external network call'); });
}
const req = (url, init = {}, code) => new Request(`https://studio.test${url}`, { ...init, headers: { 'Content-Type': 'application/json', ...(code === undefined ? {} : { 'x-content-password': code }), ...(init.headers || {}) } });
const counter = () => { const state = { calls: 0 }; state.fn = async (...args) => { state.calls++; return state.result ?? { ok: true, args }; }; return state; };

const candidate = { name: 'Testprodukt', category: 'Haushalt', kind: 'Dauerläufer', season: 'ganzjährig', whyNow: 'Test', targetGroup: 'Alle', reelIdea: 'Idee', benefitsToVerify: ['a', 'b'], searchQuery: 'Testprodukt', confidence: 50 };

test('trends: no or wrong code never reaches the paid scout; valid code does; provider errors stay generic', async t => {
  withEnv(t);
  const scout = counter();
  const route = loadRoute('app/api/trends/route.ts', { '@/lib/orchestrator': { runProductScout: scout.fn } });
  for (const code of [undefined, '', 'wrong']) {
    const response = await route.POST(req('/api/trends', { method: 'POST' }, code));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Zugangscode erforderlich.' });
  }
  assert.equal(scout.calls, 0);
  assert.equal((await route.POST(req('/api/trends', { method: 'POST' }, CODE))).status, 200);
  assert.equal(scout.calls, 1);
  const failing = loadRoute('app/api/trends/route.ts', { '@/lib/orchestrator': { runProductScout: async () => { throw new Error('tavily key tvly-SECRET rejected at https://api.tavily.com'); } } });
  const failed = await failing.POST(req('/api/trends', { method: 'POST' }, CODE));
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /tvly|tavily|SECRET/i);
});

test('trends: access code is not configured -> nobody gets in', async t => {
  withEnv(t); delete process.env.CONTENT_STUDIO_PASSWORD;
  const scout = counter();
  const route = loadRoute('app/api/trends/route.ts', { '@/lib/orchestrator': { runProductScout: scout.fn } });
  assert.equal((await route.POST(req('/api/trends', { method: 'POST' }, ''))).status, 401);
  assert.equal((await route.POST(req('/api/trends', { method: 'POST' }, 'anything'))).status, 401);
  assert.equal(scout.calls, 0);
});

test('verify: auth first, then input validation, then generic provider errors', async t => {
  withEnv(t);
  const review = counter();
  const route = loadRoute('app/api/verify/route.ts', { '@/lib/orchestrator': { runProductReview: review.fn } });
  assert.equal((await route.POST(req('/api/verify', { method: 'POST', body: JSON.stringify(candidate) }))).status, 401);
  assert.equal((await route.POST(req('/api/verify', { method: 'POST', body: JSON.stringify(candidate) }, 'nope'))).status, 401);
  assert.equal(review.calls, 0);
  const bad = await route.POST(req('/api/verify', { method: 'POST', body: '{"name":' }, CODE));
  assert.equal(bad.status, 400);
  assert.equal(review.calls, 0);
  const invalid = await route.POST(req('/api/verify', { method: 'POST', body: JSON.stringify({ name: 1 }) }, CODE));
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(JSON.stringify(await invalid.json()), /zod|expected|invalid_type/i);
  const ok = await route.POST(req('/api/verify', { method: 'POST', body: JSON.stringify(candidate) }, CODE));
  assert.equal(ok.status, 200);
  assert.equal(review.calls, 1);
  const failing = loadRoute('app/api/verify/route.ts', { '@/lib/orchestrator': { runProductReview: async () => { throw new Error('internal stack at /var/task/secret.js'); } } });
  const failed = await failing.POST(req('/api/verify', { method: 'POST', body: JSON.stringify(candidate) }, CODE));
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /var\/task|stack/);
});

test('generate (legacy): operator only', async t => {
  withEnv(t);
  const writer = counter();
  const route = loadRoute('app/api/generate/route.ts', { '@/lib/orchestrator': { runScriptWriter: writer.fn } });
  assert.equal((await route.POST(req('/api/generate', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal(writer.calls, 0);
  assert.equal((await route.POST(req('/api/generate', { method: 'POST', body: '{}' }, CODE))).status, 400);
  assert.equal(writer.calls, 0);
});

test('video status: no provider call and no Blob write without the access code; failures are generic', async t => {
  withEnv(t, { RUNWAYML_API_SECRET: 'rw-test' });
  const retrieve = counter(); const puts = counter(); const heads = counter();
  retrieve.result = { status: 'SUCCEEDED', cost: { credits: 5 }, output: ['https://runway.example/out.mp4'] };
  const route = loadRoute('app/api/video/status/route.ts', {
    '@vercel/blob': { head: async () => { heads.calls++; throw new Error('missing'); }, put: puts.fn },
    '@/lib/runway': { getRunwayClient: () => ({ tasks: { retrieve: retrieve.fn } }) },
  });
  for (const code of [undefined, 'wrong']) {
    const response = await route.GET(req('/api/video/status?taskId=abcdefgh12', {}, code));
    assert.equal(response.status, 401);
  }
  assert.equal(retrieve.calls + puts.calls + heads.calls, 0);
  assert.equal((await route.GET(req('/api/video/status?taskId=bad!', {}, CODE))).status, 400);
  assert.equal(retrieve.calls, 0);
  const failed = await route.GET(req('/api/video/status?taskId=abcdefgh12', {}, CODE));
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /runway\.example|missing/);
  assert.equal(puts.calls, 0);
});

test('meta and whatsapp connection checks are operator only and do not call Graph without the code', async t => {
  withEnv(t);
  const meta = counter(); const wa = counter();
  const metaRoute = loadRoute('app/api/meta/connection/route.ts', { '@/lib/meta/connection': { cachedMetaConnection: meta.fn, metaConfig: () => ({}), pagePublishingToken: meta.fn, publicMetaReport: () => ({ status: 'connected' }) } });
  const waRoute = loadRoute('app/api/whatsapp/connection/route.ts', { '@/lib/whatsapp/connection': { checkWhatsAppConnection: wa.fn } });
  assert.equal((await metaRoute.GET(req('/api/meta/connection'))).status, 401);
  assert.equal((await metaRoute.GET(req('/api/meta/connection', {}, 'wrong'))).status, 401);
  assert.equal((await waRoute.GET(req('/api/whatsapp/connection'))).status, 401);
  assert.equal(meta.calls + wa.calls, 0);
  assert.equal((await waRoute.GET(req('/api/whatsapp/connection', {}, CODE))).status, 200);
  assert.equal(wa.calls, 1);
});

test('webhook and public landing click keep their own protections (not behind the access code)', () => {
  const fs = require('node:fs');
  assert.match(fs.readFileSync('app/api/whatsapp/webhook/route.ts', 'utf8'), /verifyMetaWebhookSignature/);
  assert.match(fs.readFileSync('app/api/landing/click/route.ts', 'utf8'), /origin/);
});

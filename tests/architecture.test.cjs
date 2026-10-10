const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../.test-build/lib/architecture/model');
const L = require('../.test-build/lib/architecture/layout');
const P = require('../.test-build/lib/architecture/process');
const R = require('../.test-build/lib/architecture/runtime');
const S = require('../.test-build/lib/architecture/snapshot');
const { checkCapabilities } = require('../.test-build/lib/capabilities');
const { ensureAutomationSchema } = require('../.test-build/lib/memory/ensure-automation-schema');
const { NonProductionEffectError } = require('../.test-build/lib/security/runtime-guard');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const loadRoute = require('./helpers/load-route.cjs');
const { withEnv } = require('./helpers/live-env.cjs');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const NOW = new Date('2026-10-10T12:00:00Z');
const emptySnapshot = (extra = {}) => ({ available: false, reason: 'test', generatedAt: NOW.toISOString(), topic: null, affiliate: null, publications: null, chances: null, vision: null, visualJobs: null, ...extra });

// ---------- model ----------
test('model is consistent: unique ids, no dangling edges, every component connected, short labels fit, process steps exist', () => {
  assert.deepEqual(M.validateModel(), []);
  const connected = new Set(M.EDGES.flatMap(edge => [edge.from, edge.to]));
  for (const node of M.NODES) assert.ok(connected.has(node.id), `${node.id} is isolated`);
});
test('every referenced code path, test file and documented proof exists in the repository (no invented components)', () => {
  for (const node of M.NODES) {
    for (const file of [...node.code, ...node.tests]) assert.ok(fs.existsSync(path.join(root, file)), `${node.id}: ${file} missing`);
    if (node.proof) assert.ok(fs.existsSync(path.join(root, node.proof.split(':')[0])), `${node.id}: proof source missing`);
  }
});
test('seven main areas around Jarvis; Jarvis is the only core component; Trendsetter feeds Jarvis and Jarvis feeds both pipelines', () => {
  assert.equal(Object.keys(M.CLUSTER_META).length, 7);
  assert.deepEqual(M.NODES.filter(node => node.cluster === 'core').map(node => node.id), ['jarvis']);
  const edge = (from, to) => M.EDGES.some(item => item.from === from && item.to === to);
  assert.ok(edge('trendsetter', 'jarvis'));
  assert.ok(edge('trend-agent', 'trendsetter') && edge('topic-scout', 'trendsetter'));
  assert.ok(edge('jarvis', 'product-scout') && edge('jarvis', 'topic-orchestrator'));
  assert.equal(M.NODES.filter(node => /trend/i.test(node.id) && node.kind === 'agent').length, 1, 'one research agent, no duplicate trend agents');
});
test('status dimensions are separate and evidence based: implementation from code/tests, deployment from the branch, no "live verified" status', () => {
  assert.equal(M.implementationOf(M.nodeById('executive-agent')), 'planned');
  assert.equal(M.implementationOf(M.nodeById('pinterest')), 'planned');
  assert.equal(M.implementationOf(M.nodeById('youtube')), 'tested');
  assert.equal(M.deploymentOf(M.nodeById('trendsetter')), 'preview');
  assert.equal(M.deploymentOf(M.nodeById('jarvis')), 'production');
  assert.equal(M.deploymentOf(M.nodeById('pinterest')), 'not_deployed');
  assert.ok(!('live_verified' in M.OPERATION_META));
  assert.ok(!/live_verified/.test(read('lib/architecture/model.ts')));
  assert.equal(M.nodeById('pinterest').operation.type, 'planned', 'Pinterest is not presented as finished');
  assert.equal(M.nodeById('faceless').operation.status, 'disabled', 'Faceless.so is not an active production provider');
});
test('env entries are variable names only, never values', () => {
  for (const node of M.NODES) for (const name of node.env ?? []) assert.match(name, /^[A-Z][A-Z0-9_]+$/);
});
test('process path: fan-in for the research step, chain otherwise, steps connected in order', () => {
  const segments = P.processSegments(M.PROCESS_STEPS);
  assert.ok(segments.some(([a, b]) => a === 'topic-scout' && b === 'trendsetter'));
  assert.ok(segments.some(([a, b]) => a === 'trend-agent' && b === 'trendsetter'));
  assert.ok(!segments.some(([a, b]) => a === 'topic-scout' && b === 'trend-agent'));
  assert.ok(segments.some(([a, b]) => a === 'trendsetter' && b === 'jarvis'));
  assert.ok(segments.some(([a, b]) => a === 'content-approval' && b === 'production-gate'));
  assert.ok(segments.some(([a, b]) => a === 'publisher' && b === 'whatsapp'));
});

// ---------- layout ----------
test('layout: deterministic, Jarvis in the centre, areas evenly on the ring, components of one area well separated', () => {
  const a = L.layoutNodes(), b = L.layoutNodes();
  assert.deepEqual(a, b);
  assert.deepEqual(a.jarvis, [0, 0, 0]);
  const hubs = L.CLUSTERS.map(L.hubPosition);
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const gaps = hubs.map((hub, index) => dist(hub, hubs[(index + 1) % hubs.length]));
  for (const gap of gaps) assert.ok(Math.abs(gap - gaps[0]) < 0.01, 'even spacing');
  for (const cluster of L.CLUSTERS) {
    const members = M.NODES.filter(node => node.cluster === cluster).map(node => a[node.id]);
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) assert.ok(dist(members[i], members[j]) >= 3, `${cluster}: members too close`);
    for (const point of members) assert.ok(point.every(Number.isFinite));
  }
});
test('camera goals: finite, portrait screens step back further, an area is viewed from outside', () => {
  const wide = L.overviewGoal(1.8), tall = L.overviewGoal(0.5);
  assert.ok(Math.hypot(...tall.position) > Math.hypot(...wide.position));
  const goal = L.clusterGoal('publishing', 7, 1.6);
  assert.deepEqual(goal.target, L.hubPosition('publishing'));
  assert.ok(Math.hypot(goal.position[0], goal.position[2]) > Math.hypot(goal.target[0], goal.target[2]));
  for (const item of [wide, tall, goal, L.nodeGoal([1, 2, 3], 'media', 0.6)]) assert.ok([...item.position, ...item.target].every(Number.isFinite));
});

// ---------- runtime status ----------
const PROD = { VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'postgres://SECRET-VALUE-123', REPLICATE_API_TOKEN: 'r8_SECRET-VALUE-123', WHATSAPP_ACCESS_TOKEN: 'SECRET-VALUE-123',
  WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_VERIFY_TOKEN: 'x', META_APP_SECRET: 'SECRET-VALUE-123', WHATSAPP_APPROVER_WA_ID: '49', CONTENT_STUDIO_PASSWORD: 'SECRET-VALUE-123', CRON_SECRET: 'SECRET-VALUE-123' };
const runtimeFor = (env, snapshot = emptySnapshot()) => R.computeRuntime({ capabilities: checkCapabilities(env), snapshot, env, now: NOW });

test('runtime: switches off = deactivated, missing names = not configured, planned = no operation, operator decisions labelled as such', () => {
  const state = runtimeFor(PROD);
  assert.equal(state.nodes['topic-orchestrator'].status, 'disabled');
  assert.match(state.nodes['topic-orchestrator'].reason, /TOPIC_PIPELINE_ENABLED/);
  assert.equal(state.nodes.trendsetter.status, 'disabled');
  assert.equal(state.nodes['executive-agent'].status, 'not_applicable');
  assert.equal(state.nodes.pinterest.status, 'not_applicable');
  assert.equal(state.nodes.faceless.source, 'Betreiberentscheidung');
  assert.equal(state.nodes.youtube.status, 'not_configured');
  assert.match(state.nodes.youtube.reason, /YOUTUBE_CLIENT_ID/);
  assert.equal(state.nodes.whatsapp.status, 'ready');
  assert.equal(state.nodes['vision-gate'].status, 'unknown', 'a configured but unproven vision model is not "ready"');
  for (const node of M.NODES) assert.ok(state.nodes[node.id] && state.nodes[node.id].reason && state.nodes[node.id].source, node.id);
});
test('runtime never ships a variable value to the browser', () => {
  const text = JSON.stringify(runtimeFor({ ...PROD, TOPIC_PIPELINE_ENABLED: 'true', YOUTUBE_CLIENT_ID: 'SECRET-VALUE-123', YOUTUBE_CLIENT_SECRET: 'SECRET-VALUE-123', YOUTUBE_REFRESH_TOKEN: 'SECRET-VALUE-123' }));
  assert.ok(!text.includes('SECRET-VALUE-123'));
});
test('runtime in a preview deployment: every component with external effects is shown as blocked by the preview guard', () => {
  const state = runtimeFor({ ...PROD, VERCEL_ENV: 'preview' });
  assert.equal(state.environment, 'preview');
  for (const id of ['publisher', 'whatsapp', 'replicate', 'postgres', 'jarvis']) {
    assert.equal(state.nodes[id].status, 'disabled', id);
    assert.equal(state.nodes[id].source, 'Preview-Sperre');
  }
  assert.equal(state.nodes['format-router'].status, 'ready', 'pure code is not affected');
});
test('runtime evidence: work in progress = active, a failed last run = error, a vision check in the database = ready; no evidence → no pending list', () => {
  const snapshot = emptySnapshot({ available: true, reason: null,
    topic: { byStage: { in_production: 1, proposed: 2 }, recent: [], lastRun: null },
    publications: [{ platform: 'facebook', status: 'failed', url: null, at: NOW.toISOString(), origin: 'whatsapp_approval' },
      { platform: 'facebook', status: 'published', url: 'https://www.facebook.com/p/1', at: NOW.toISOString(), origin: 'whatsapp_approval' }],
    vision: { checked: 3, lastStatus: 'passed', lastAt: NOW.toISOString() } });
  const state = runtimeFor({ ...PROD, TOPIC_PIPELINE_ENABLED: 'true', META_SYSTEM_USER_TOKEN: 't', META_PAGE_ID: 'p' }, snapshot);
  assert.equal(state.nodes['topic-orchestrator'].status, 'active');
  assert.equal(state.nodes.facebook.status, 'error');
  assert.ok(state.nodes.facebook.details.some(item => item.includes('https://www.facebook.com/p/1')));
  assert.equal(state.nodes['vision-gate'].status, 'ready');
  assert.equal(state.nodes['vision-gate'].source, 'Datenbank');
  assert.equal(state.nodes['content-approval'].status, 'active');
  assert.ok(state.pending.find(item => item.label.startsWith('Themenvorschläge')).count === 2);
  assert.deepEqual(runtimeFor(PROD).pending, []);
  assert.equal(state.steps.length, M.PROCESS_STEPS.length);
});

// ---------- snapshot (read-only evidence) ----------
test('snapshot: in preview the runtime guard blocks the database and the snapshot says so instead of guessing', async () => {
  const snapshot = await S.readSnapshot(NOW, () => { throw new NonProductionEffectError('database'); });
  assert.equal(snapshot.available, false);
  assert.match(snapshot.reason, /Runtime-Guard/);
});
test('snapshot: reads every section from a migrated database with SELECT statements only', async () => {
  const db = await pgliteDatabase();
  try {
    await ensureAutomationSchema(db);
    const snapshot = await S.readSnapshot(NOW, () => db);
    assert.equal(snapshot.available, true);
    for (const key of ['topic', 'affiliate', 'publications', 'chances', 'vision', 'visualJobs']) assert.notEqual(snapshot[key], null, key);
  } finally { await db.close(); }
  const src = read('lib/architecture/snapshot.ts');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/.test(src), 'snapshot must not write');
  assert.ok(!/applyMigrations|ensureAutomationSchema/.test(src));
});

// ---------- security ----------
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
test('Command Center code imports no publishing, messaging, provider, blob or migration modules; only the snapshot reads the database', () => {
  const forbidden = /from\s+["'][^"']*(memory\/repository|distribution\/publish|publishing\/approval-gate|whatsapp\/client|runway|visual\/providers|content\/providers|guarded-blob|@vercel\/blob|production\/|migrations|trendsetter\/repository)/;
  for (const file of [...walk('lib/architecture'), ...walk('app/architecture'), 'app/api/architecture/route.ts']) {
    const src = read(file);
    assert.ok(!forbidden.test(src), `${file} imports a forbidden module`);
    if (!file.endsWith('snapshot.ts')) assert.ok(!/from\s+["'][^"']*memory\/db["']/.test(src), `${file} must not open the database`);
  }
});
test('the API route is operator-protected, GET only, uncached and reads no variable values itself', () => {
  const src = read('app/api/architecture/route.ts');
  assert.match(src, /if \(!authorized\(request\)\) return unauthorizedResponse\(\)/);
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(src));
  assert.match(src, /no-store/);
  assert.ok(!/process\.env/.test(src));
});
test('the API cannot be reached around the UI: no or wrong access code → 401; with the code → data without any secret value', async () => {
  const restore = withEnv({ CONTENT_STUDIO_PASSWORD: 'right-code-123', REPLICATE_API_TOKEN: 'r8_SECRET-VALUE-123', VERCEL_ENV: undefined, VERCEL: undefined });
  try {
    const route = loadRoute('app/api/architecture/route.ts', { '@/lib/architecture/snapshot': { readSnapshot: async () => emptySnapshot() } });
    for (const headers of [{}, { 'x-content-password': 'wrong' }, { 'x-content-password': '' }]) {
      const response = await route.GET(new Request('http://localhost/api/architecture', { headers }));
      assert.equal(response.status, 401);
    }
    const ok = await route.GET(new Request('http://localhost/api/architecture', { headers: { 'x-content-password': 'right-code-123' } }));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const text = await ok.text();
    assert.ok(!text.includes('SECRET-VALUE-123') && !text.includes('right-code-123'));
    const body = JSON.parse(text);
    assert.equal(body.nodes.length, M.NODES.length);
    assert.ok(body.nodes.every(node => !('operation' in node)), 'internal rules stay on the server');
  } finally { restore(); }
});
test('the 3D scene is loaded on demand, client side only, with a WebGL check, error fallback, reduced motion and keyboard control', () => {
  const center = read('app/architecture/command-center.tsx');
  assert.match(center, /ssr: false/);
  assert.match(center, /getContext\("webgl2"\)/);
  assert.match(center, /getDerivedStateFromError/);
  assert.match(center, /prefers-reduced-motion/);
  assert.match(center, /onKeyDown=\{showScene \? onStageKey/);
  assert.match(center, /aria-live="polite"/);
  assert.equal((center.match(/(?<!function )webglAvailable\(\)/g) || []).length, 1, 'WebGL is probed once per load, never during render');
  assert.match(center, /webglSupported \? "" : "WebGL wird von diesem Browser nicht unterst/);
  const scene = read('app/architecture/scene.tsx');
  assert.ok(!/fetch\(/.test(scene), 'scene must not make network calls');
  assert.match(scene, /frameloop=\{!props\.active \? "never"/);
  const scenePos = scene.search(/^(function|const|export)\s/m);
  assert.ok(scene.lastIndexOf('\nimport ') < scenePos, 'imports precede declarations');
});

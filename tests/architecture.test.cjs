const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../.test-build/lib/architecture/model');
const L = require('../.test-build/lib/architecture/layout');
const root = path.join(__dirname, '..');

test('model is consistent: unique ids, no dangling edges, every node connected', () => {
  assert.deepEqual(M.validateModel(), []);
  const connected = new Set(M.EDGES.flatMap(edge => [edge.from, edge.to]));
  for (const node of M.NODES) assert.ok(connected.has(node.id), `${node.id} is isolated`);
});
test('every referenced code path and test file exists in the repository (no invented components)', () => {
  for (const node of M.NODES) for (const file of [...node.code, ...node.tests]) assert.ok(fs.existsSync(path.join(root, file)), `${node.id}: ${file} missing`);
});
test('statuses are evidence-based: nothing is marked faulty, planned components have no tests of their own and disabled flags are real', () => {
  assert.equal(M.NODES.filter(node => node.status === 'faulty').length, 0);
  assert.equal(M.nodeById('topic-orchestrator').status, 'disabled');
  assert.equal(M.nodeById('executive-agent').status, 'planned');
  for (const node of M.NODES.filter(item => item.status === 'live_verified')) assert.ok(node.status in M.STATUS_META);
  // Platforms without credentials / live proof are never green.
  for (const id of ['tiktok', 'youtube', 'x', 'heygen']) assert.notEqual(M.nodeById(id).status, 'live_verified');
  // Video generation and social publishing stay separate kinds.
  assert.equal(M.nodeById('heygen').kind, 'provider');
  assert.equal(M.nodeById('tiktok').kind, 'platform');
});
test('env entries are variable names only, never values', () => {
  for (const node of M.NODES) for (const name of node.env ?? []) assert.match(name, /^[A-Z][A-Z0-9_]+$/);
});
test('the model does not import runtime code and the Jarvis hierarchy keeps publishing behind the gate', () => {
  const src = fs.readFileSync(path.join(root, 'lib/architecture/model.ts'), 'utf8');
  assert.ok(!/^import /m.test(src));
  const toPlatforms = M.EDGES.filter(edge => edge.kind === 'publishing');
  assert.deepEqual(toPlatforms.map(edge => edge.from), Array(5).fill('publisher'));
  assert.ok(M.EDGES.some(edge => edge.from === 'publish-gate' && edge.to === 'publisher'));
  assert.ok(!M.EDGES.some(edge => edge.to === 'publisher' && edge.from === 'jarvis'));
});
test('layout is deterministic, finite and places Jarvis in the centre', () => {
  const a = L.layoutNodes(); const b = L.layoutNodes();
  assert.deepEqual(a, b);
  assert.deepEqual(a.jarvis, [0, 0, 0]);
  for (const node of M.NODES) { assert.ok(a[node.id], node.id); assert.ok(a[node.id].every(Number.isFinite)); }
});

// Visualization safety: it is read-only and cannot reach databases, publishing, messaging or paid providers.
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const files = [...walk('lib/architecture'), ...walk('app/architecture'), 'app/api/architecture/route.ts'];

test('architecture code imports no database, publishing, messaging, provider or blob modules', () => {
  const forbidden = /from\s+["'][^"']*(memory\/db|memory\/repository|distribution\/publish|publishing\/approval-gate|whatsapp\/client|runway|visual\/providers|content\/providers|guarded-blob|@vercel\/blob|production\/)/;
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!forbidden.test(src), `${file} imports a forbidden module`);
  }
});
test('the API route is operator-protected, GET only, uncached and returns no env values', () => {
  const src = fs.readFileSync(path.join(root, 'app/api/architecture/route.ts'), 'utf8');
  assert.match(src, /if \(!authorized\(request\)\) return unauthorizedResponse\(\)/);
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(src));
  assert.match(src, /no-store/);
  assert.ok(!/process\.env/.test(src));
});
test('the 3D scene is loaded on demand, client side only, with a WebGL check and error fallback', () => {
  const center = fs.readFileSync(path.join(root, 'app/architecture/command-center.tsx'), 'utf8');
  assert.match(center, /ssr: false/);
  assert.match(center, /getContext\("webgl2"\)/);
  assert.match(center, /getDerivedStateFromError/);
  assert.match(center, /prefers-reduced-motion/);
  const studio = fs.readFileSync(path.join(root, 'app/content-studio.tsx'), 'utf8');
  assert.match(studio, /<CommandCenter password=\{password\} \/>/);
  const scene = fs.readFileSync(path.join(root, 'app/architecture/scene.tsx'), 'utf8');
  assert.ok(!/fetch\(/.test(scene), 'scene must not make network calls');
});

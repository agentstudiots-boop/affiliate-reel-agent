const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The prepared vision smoke test must keep working in its free offline mode (no token → no network, no cost).
// Regression: its offline fixture was 40x50 px and failed the technical check (min. 512 px), so the provider/schema
// failure paths it claims to verify were never reached.
test('vision smoke test, offline mode: every self-check passes without any token or network access', () => {
  const env = { ...process.env };
  for (const name of ['REPLICATE_API_TOKEN', 'VISION_SMOKE_APPROVED', 'IMAGE_QUALITY_MODEL']) delete env[name];
  const run = spawnSync(process.execPath, [path.join('scripts', 'vision-smoke-test.cjs')], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /Modus: offline/);
  assert.match(run.stdout, /Alle ausgeführten Prüfungen bestanden/);
  assert.ok(!/FAIL/.test(run.stdout), run.stdout);
  assert.ok(!/kostenpflichtig/.test(run.stdout.replace(/Hinweis:.*$/m, '')), 'no paid call in offline mode');
});

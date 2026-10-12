const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('../scripts/check-preview-isolation.cjs');
const R = require('../.test-build/lib/security/runtime-guard');

const SECRET = 'prod-secret-value-XYZ';
const production = { DATABASE_URL: `postgres://u:${SECRET}@ep-prod-1.eu.neon.tech/db`, BLOB_READ_WRITE_TOKEN: SECRET, WHATSAPP_ACCESS_TOKEN: 'w1', WHATSAPP_APPROVER_WA_ID: '4917',
  META_SYSTEM_USER_TOKEN: 'm1', REPLICATE_API_TOKEN: 'r1', CONTENT_STUDIO_PASSWORD: 'pw' };

test('isolation check: shared values, same database host and absent preview values are classified correctly', () => {
  const preview = { DATABASE_URL: 'postgres://u:other@ep-prod-1.eu.neon.tech/db', BLOB_READ_WRITE_TOKEN: SECRET, WHATSAPP_ACCESS_TOKEN: 'w2', WHATSAPP_APPROVER_WA_ID: '4999',
    REPLICATE_API_TOKEN: 'r2', CONTENT_STUDIO_PASSWORD: 'pw' };
  const result = C.compare(production, preview);
  const state = name => result.rows.find(row => row.name === name)?.state;
  assert.equal(state('DATABASE_URL'), 'GLEICHER HOST', 'a different password on the same Neon endpoint is not a separate database');
  assert.equal(state('BLOB_READ_WRITE_TOKEN'), 'GLEICH');
  assert.equal(state('WHATSAPP_ACCESS_TOKEN'), 'getrennt');
  assert.equal(state('META_SYSTEM_USER_TOKEN'), 'fehlt in Preview');
  assert.deepEqual(result.resources, { database: false, blob: false, whatsapp: true, publishing: true, paid_providers: true });
  assert.equal(result.accessShared, true);
});
test('isolation check: the CLI never prints a value and its suggested resource list only contains separate resources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-'));
  const write = (name, env) => { const file = path.join(dir, name); fs.writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}="${v}"`).join('\n')); return file; };
  const prod = write('prod.env', production);
  const prev = write('prev.env', { ...production, DATABASE_URL: 'postgres://u:x@ep-branch-9.eu.neon.tech/db', BLOB_READ_WRITE_TOKEN: 'other' });
  let output = '';
  try { execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-preview-isolation.cjs'), prod, prev], { encoding: 'utf8' }); }
  catch (error) { output = error.stdout; assert.equal(error.status, 2); }
  assert.ok(!output.includes(SECRET) && !output.includes('ep-prod-1') && !output.includes('ep-branch-9'), 'no values or hosts in the output');
  assert.match(output, /GEMEINSAM MIT PRODUCTION: whatsapp, publishing, paid_providers/);
  assert.match(output, /NON_PRODUCTION_SANDBOX_RESOURCES=database,blob\n/);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('isolation check: its resource names are exactly the ones the runtime guard understands', () => {
  assert.deepEqual(Object.keys(C.RESOURCES).sort(), [...R.ISOLATED_RESOURCES].sort());
});
test('env file parser: quotes, export prefix and comments', () => {
  assert.deepEqual(C.parseEnvFile('# c\nexport A="1"\nB=\'2\'\nC=3\n\nbad line'), { A: '1', B: '2', C: '3' });
});

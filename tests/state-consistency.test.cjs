const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Code and database must agree on every state a row can take. A state the code writes but the CHECK constraint does not
// allow would only surface in production, as a failed transition halfway through a pipeline step.
const read = file => fs.readFileSync(file, 'utf8');
const union = (src, pattern) => { const match = src.match(pattern); assert.ok(match, `type not found: ${pattern}`); return [...match[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]).sort(); };
const check = (sql, column) => {
  const all = [...sql.matchAll(new RegExp(`${column}[^;]*?CHECK \\(${column} IN \\(([^)]*)\\)`, 'g'))];
  assert.ok(all.length, `CHECK for ${column} not found`);
  return [...all.at(-1)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();   // the latest definition wins (e.g. 032 replaces 029)
};
const migrations = fs.readdirSync('db/migrations').filter(name => name.endsWith('.sql')).sort().map(name => read(`db/migrations/${name}`)).join('\n;\n');

test('topic_contents.stage: the orchestrator\'s Stage type equals the database CHECK constraint (migration 031)', () => {
  const stages = union(read('lib/topic-pipeline/orchestrator.ts'), /type Stage = ([^;]+);/);
  assert.deepEqual(stages, check(read('db/migrations/031_topic_contents.sql'), 'stage'));
});
test('topic_contents rows are only ever saved with a stage from the Stage type', () => {
  const src = read('lib/topic-pipeline/orchestrator.ts');
  const stages = union(src, /type Stage = ([^;]+);/);
  const written = [...src.matchAll(/save\(deps\.db, \{[^}]*?stage: "([a-z_]+)"/g)].map(m => m[1]);
  assert.ok(written.length >= 6, 'save calls found');
  for (const stage of written) assert.ok(stages.includes(stage), stage);
});
test('publish_attempts.status: every status the gate and the publishers write is allowed by the final CHECK (migration 032)', () => {
  const definitions = [...migrations.matchAll(/publish_attempts_status_check CHECK \(status IN \(([^)]*)\)\)/g)];
  assert.ok(definitions.length, 'final publish_attempts status constraint found');
  const allowed = definitions.at(-1)[1].match(/'([a-z_]+)'/g).map(item => item.slice(1, -1)).sort();
  const gate = read('lib/publishing/approval-gate.ts');
  const written = new Set([...gate.matchAll(/publish_attempts[^"]*?status[^"]*?'([a-z_]+)'/g)].map(m => m[1]));
  for (const status of union(gate, /completePublishAttempt\(db: Sql, permit: PublishPermit, status: ([^,]+),/)) written.add(status);
  for (const status of union(read('lib/distribution/publish.ts'), /export type RemoteStatus = \{ state: ([^;]+?);/)) written.add(status);
  for (const status of written) assert.ok(allowed.includes(status), `${status} not allowed by publish_attempts CHECK (${allowed})`);
  assert.ok(written.has('claimed') && written.has('blocked') && written.has('processing'));
});
test('publish_approvals.status: all decisions the gate records are allowed (migration 029)', () => {
  const sql = read('db/migrations/029_publish_approvals.sql');
  const block = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS publish_approvals'), sql.indexOf('CREATE TABLE IF NOT EXISTS publish_attempts'));
  assert.ok(block.length > 50, 'publish_approvals block found');
  const allowed = check(block, 'status');
  const gate = read('lib/publishing/approval-gate.ts');
  for (const status of union(gate, /export type DecisionKind = ([^;]+);/)) assert.ok(allowed.includes(status), status);
  for (const status of ['pending', 'invalidated']) { assert.ok(allowed.includes(status)); assert.match(gate, new RegExp(`'${status}'`)); }
});
test('visual_jobs.status: the media ledger states equal the database CHECK (migration 030)', () => {
  const ledger = union(read('lib/visual/ledger.ts'), /status: ([^;]+?);/);
  assert.deepEqual(ledger, ['failed', 'running', 'succeeded']);
  const sql = read('db/migrations/030_visual_jobs.sql');
  assert.deepEqual([...sql.match(/status text NOT NULL CHECK \(status IN \(([^)]*)\)\)/)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort(), ledger);
});

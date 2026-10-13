const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { applyMigrations } = require('../.test-build/lib/memory/migrations');

// Static and behavioural proof for migration 034 (image quality) before it is verified in production:
// additive only, no change to existing rows, atomic on failure, documented rollback restores the 033 schema.
const load = name => fs.readFileSync(`db/migrations/${name}`, 'utf8');
const SQL_034 = load('034_image_quality.sql');
const TABLES_034 = ['image_generation_attempts', 'image_quality_notices', 'image_generation_grants', 'image_quality_experiences'];
const ALL = fs.readdirSync('db/migrations').filter(name => name.endsWith('.sql')).sort();
const BEFORE_034 = ALL.slice(0, ALL.indexOf('034_image_quality.sql'));
// Later migrations (e.g. 035) are recorded as no-ops so that each test isolates exactly 034, whatever comes after it.
const AFTER_034 = new Set(ALL.slice(ALL.indexOf('034_image_quality.sql') + 1));
const only034 = name => AFTER_034.has(name) ? 'SELECT 1;' : load(name);

function database() {
  const pg = new PGlite();
  const db = { query: (q, v) => pg.query(q, v), exec: q => pg.exec(q),
    transaction: fn => pg.transaction(tx => fn({ query: (q, v) => tx.query(q, v), exec: q => tx.exec(q) })) };
  return { pg, db };
}
async function upTo033(pg) {
  await pg.exec('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of BEFORE_034) { await pg.exec(load(name)); await pg.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]); }
  // Representative existing production data.
  const jobId = '11111111-1111-4111-8111-111111111111';
  await pg.query("INSERT INTO products(id,name,source_url) VALUES('p1','Vakuumierer','https://example.org/p')");
  await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
    VALUES($1,'p1','kitchen','sous-vide','conversion','instagram','','{}','approved','{}',now(),now())`, [jobId]);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('wamid.1','4917','approve','{}')");
  return jobId;
}
async function snapshot(pg) {
  const tables = (await pg.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(row => row.table_name);
  const out = {};
  for (const table of tables) out[table] = (await pg.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
  const columns = (await pg.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name")).rows;
  return { tables, rows: out, columns };
}

test('034 is additive: only CREATE TABLE / CREATE INDEX IF NOT EXISTS, no statement that changes or removes existing data', () => {
  const statements = SQL_034.replace(/--.*$/gm, '').split(';').map(item => item.trim()).filter(Boolean);
  assert.equal(statements.length, 6);
  for (const statement of statements) assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  assert.ok(!/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|INSERT|RENAME)\b/i.test(SQL_034.replace(/--.*$/gm, '').replace(/ON DELETE CASCADE/g, '')));
  // Only references to existing tables are foreign keys to content_jobs.
  const references = [...SQL_034.matchAll(/REFERENCES\s+(\w+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(references)], ['content_jobs']);
});

test('upgrading a populated 033 database applies only 034 and leaves every existing table, column and row unchanged; re-run is a no-op', async () => {
  const { pg, db } = database();
  try {
    await upTo033(pg);
    const before = await snapshot(pg);
    const first = await applyMigrations(db, only034);
    assert.deepEqual(first.alreadyApplied, BEFORE_034);
    assert.equal(first.applied[0], '034_image_quality.sql');
    assert.deepEqual(first.applied.slice(1), [...AFTER_034]);
    const after = await snapshot(pg);
    assert.deepEqual(after.tables.filter(name => !TABLES_034.includes(name)), before.tables);
    for (const table of before.tables) if (table !== 'schema_migrations') assert.deepEqual(after.rows[table], before.rows[table], table);
    assert.deepEqual(after.columns.filter(column => !TABLES_034.includes(column.table_name)), before.columns);
    for (const table of TABLES_034) assert.deepEqual(after.rows[table], [], `${table} starts empty`);
    assert.deepEqual((await applyMigrations(db, only034)).applied, []);
  } finally { await pg.close(); }
});

test('a failure while applying 034 rolls back completely: no new table, no migration record, existing data intact', async () => {
  const { pg, db } = database();
  try {
    await upTo033(pg);
    const before = await snapshot(pg);
    await assert.rejects(applyMigrations(db, name => name === '034_image_quality.sql' ? `${SQL_034}\nSELECT 1/0;` : only034(name)));
    assert.deepEqual(await snapshot(pg), before);
  } finally { await pg.close(); }
});

test('the documented rollback (docs/IMAGE_QUALITY_VERIFICATION.md) restores the exact 033 schema without touching other data', async () => {
  const { pg, db } = database();
  try {
    const jobId = await upTo033(pg);
    const before = await snapshot(pg);
    await applyMigrations(db, only034);
    await pg.exec(`DELETE FROM schema_migrations WHERE name IN (${[...AFTER_034].map(name => `'${name}'`).join(',') || "''"})`); // the no-op records of later migrations
    await pg.query(`INSERT INTO image_generation_attempts(job_id,attempt_no,content_hash,provider,model,prompt_sha256,status) VALUES($1,1,'h','replicate','m','s','generated')`, [jobId]);
    const doc = fs.readFileSync('docs/IMAGE_QUALITY_VERIFICATION.md', 'utf8');
    const rollback = doc.slice(doc.indexOf('### Rollback')).match(/```sql\r?\n([\s\S]*?)```/)[1];
    await pg.exec(rollback);
    assert.deepEqual(await snapshot(pg), before);
  } finally { await pg.close(); }
});

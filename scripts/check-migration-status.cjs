// READ-ONLY migration status check. Never creates, alters or writes anything.
//   DATABASE_URL=<read-capable connection> node scripts/check-migration-status.cjs
// Prints which of the repository's migrations are recorded in schema_migrations and whether the tables of migration 034
// (image quality) exist. The connection string is never printed. Exit code 0 = everything applied, 2 = something missing, 1 = check failed.
const { Pool } = require('pg');
const fs = require('node:fs');

const TABLES_034 = ['image_generation_attempts', 'image_quality_notices', 'image_generation_grants', 'image_quality_experiences'];
(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt.');
  const expected = fs.readdirSync('db/migrations').filter(n => n.endsWith('.sql')).sort();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');                       // the database itself rejects any write in this transaction
    const hasTable = (await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok")).rows[0].ok;
    const applied = hasTable ? new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name)) : new Set();
    const missing = expected.filter(name => !applied.has(name));
    const tables = (await client.query("SELECT t AS name, to_regclass('public.'||t) IS NOT NULL AS exists FROM unnest($1::text[]) AS t", [TABLES_034])).rows;
    const unknownApplied = [...applied].filter(name => !expected.includes(name));
    await client.query('ROLLBACK');
    console.log(`schema_migrations vorhanden: ${hasTable ? 'ja' : 'NEIN'}`);
    console.log(`Migrationen im Repository: ${expected.length}, in der Datenbank verzeichnet: ${expected.length - missing.length}`);
    console.log(missing.length ? `FEHLEND: ${missing.join(', ')}` : 'Alle Repository-Migrationen sind verzeichnet.');
    if (unknownApplied.length) console.log(`Verzeichnet, aber nicht im Repository: ${unknownApplied.join(', ')}`);
    console.log('Tabellen aus 034_image_quality.sql:');
    for (const table of tables) console.log(`  ${table.exists ? 'vorhanden' : 'FEHLT    '} ${table.name}`);
    const m034 = applied.has('034_image_quality.sql');
    const tablesOk = tables.every(t => t.exists);
    console.log(`Befund 034: ${m034 && tablesOk ? 'angewendet und Tabellen vorhanden' : m034 ? 'verzeichnet, aber Tabellen fehlen (inkonsistent!)' : tablesOk ? 'Tabellen vorhanden, aber nicht verzeichnet (inkonsistent!)' : 'NICHT angewendet'}`);
    process.exitCode = missing.length || !tablesOk ? 2 : 0;
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* connection already unusable */ }
    throw new Error('Prüfung fehlgeschlagen');
  } finally { client.release(); await pool.end(); }
})().catch(() => { console.error('Statusprüfung nicht möglich. DATABASE_URL, Netzwerk und Leserechte prüfen (kein Zugangsdatum wurde ausgegeben).'); process.exitCode = 1; });

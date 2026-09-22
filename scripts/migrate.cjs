// Run explicitly; never migrate on page requests or at build time.
const { loadEnvConfig } = require('@next/env');
const { Pool } = require('pg');
const fs = require('node:fs');
loadEnvConfig(process.cwd());
(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(83624001)");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of fs.readdirSync('db/migrations').filter(n => n.endsWith('.sql')).sort()) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (exists.rowCount) continue;
      await client.query(fs.readFileSync(`db/migrations/${name}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      console.log(`Migration angewendet: ${name}`);
    }
    await client.query('COMMIT');
  } catch { await client.query('ROLLBACK'); throw new Error('Migration fehlgeschlagen. Verbindung/Berechtigungen und Schema prüfen; keine Zugangsdaten protokolliert.'); }
  finally { client.release(); await pool.end(); }
})().catch(() => { console.error('Migration fehlgeschlagen. DATABASE_URL, Verbindung, Berechtigungen und Schema prüfen.'); process.exitCode = 1; });

// READ-ONLY before/after check for a preview run (task J-05): did the preview write anything into PRODUCTION?
// Never creates, alters or writes anything; the transaction is READ ONLY, so the database itself rejects any write.
// Prints only table names, row counts and migration file names – never a connection string or row content.
//
//   DATABASE_URL=<production, read-capable> node scripts/check-production-untouched.cjs snapshot before.json
//   … preview run (docs/ai-business/J05_PREVIEW_LAUF.md) …
//   DATABASE_URL=<production, read-capable> node scripts/check-production-untouched.cjs compare before.json
//
// Production writes on its own (cron, webhook), so tables are split into two groups:
//   QUIET  – production does not write them today (executive kernel, ledgers, opportunity scout; migrations 039–042): any change is a
//            finding. A new migration recorded in schema_migrations is a finding too, unless production was deployed
//            in between (then the operator judges).
//   ACTIVE – production writes them itself: changes are only listed for the operator's judgement (run in a quiet window,
//            e.g. outside 07–09 and 16–18 UTC, and compare with the production activity in that time).
// Exit code: 0 = no QUIET change, 2 = at least one QUIET change, 1 = usage or connection error.
const fs = require('node:fs');

const QUIET = ['enterprise_tasks', 'enterprise_task_events', 'enterprise_decisions', 'budget_reservations', 'budgets', 'price_catalog',
  'cost_entries', 'revenue_entries', 'opportunities', 'opportunity_assessments'];
const ACTIVE = ['whatsapp_events', 'whatsapp_delivery_statuses', 'whatsapp_context_log', 'model_calls', 'content_jobs', 'job_events', 'daily_drafts',
  'daily_slot_runs', 'content_approval_requests', 'approval_requests', 'publication_requests', 'publications', 'publish_approvals', 'publish_attempts',
  'weekly_reports', 'image_generation_attempts', 'image_quality_notices', 'topic_runs', 'topic_contents', 'visual_jobs', 'provider_usage', 'landing_clicks'];

// db: anything with query(sql, values) → { rows }. Missing tables are recorded as null, never created.
async function takeSnapshot(db) {
  const tables = {};
  for (const name of [...QUIET, ...ACTIVE]) {
    const exists = (await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`])).rows[0].ok;
    tables[name] = exists ? Number((await db.query(`SELECT count(*)::bigint AS n FROM public.${name}`)).rows[0].n) : null;
  }
  const hasMigrations = (await db.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok")).rows[0].ok;
  const migrations = hasMigrations ? (await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row => String(row.name)) : [];
  return { version: 1, tables, migrations };
}

function diffSnapshots(before, after) {
  const findings = [], activity = [];
  for (const name of QUIET) {
    if (before.tables[name] !== after.tables[name])
      findings.push(`${name}: ${before.tables[name] ?? 'fehlt'} → ${after.tables[name] ?? 'fehlt'}`);
  }
  for (const name of ACTIVE) {
    if (before.tables[name] !== after.tables[name]) activity.push(`${name}: ${before.tables[name] ?? 'fehlt'} → ${after.tables[name] ?? 'fehlt'}`);
  }
  const added = after.migrations.filter(name => !before.migrations.includes(name));
  if (added.length) findings.push(`neue Migrationen verzeichnet: ${added.join(', ')}`);
  return { findings, activity };
}

async function readOnly(url, fn) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } finally { client.release(); await pool.end(); }
}

async function main(argv) {
  const [command, file] = argv;
  if (!['snapshot', 'compare'].includes(command) || !file) {
    console.error('Aufruf: node scripts/check-production-untouched.cjs snapshot|compare <datei.json>');
    return 1;
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL fehlt (Production, lesend).'); return 1; }
  let snapshot;
  try { snapshot = await readOnly(process.env.DATABASE_URL, takeSnapshot); }
  catch { console.error('Datenbank nicht lesbar.'); return 1; }
  if (command === 'snapshot') {
    fs.writeFileSync(file, JSON.stringify({ ...snapshot, takenAt: new Date().toISOString() }, null, 2));
    console.log(`Stand gespeichert: ${Object.keys(snapshot.tables).length} Tabellen, ${snapshot.migrations.length} Migrationen.`);
    return 0;
  }
  let before;
  try { before = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { console.error('Vorher-Datei nicht lesbar.'); return 1; }
  const { findings, activity } = diffSnapshots(before, snapshot);
  console.log(findings.length ? `BEFUND – Production verändert:\n  ${findings.join('\n  ')}` : 'Ruhige Tabellen und Migrationen unverändert.');
  console.log(activity.length ? `Aktivität in aktiven Tabellen (mit Production-Betrieb im Zeitraum abgleichen):\n  ${activity.join('\n  ')}`
    : 'Aktive Tabellen unverändert.');
  return findings.length ? 2 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
module.exports = { takeSnapshot, diffSnapshots, QUIET, ACTIVE };

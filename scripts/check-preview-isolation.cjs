// OFFLINE preview/production isolation check. No network access, no writes, never prints a value.
//
//   vercel env pull .env.production.local --environment=production
//   vercel env pull .env.preview.local    --environment=preview
//   node scripts/check-preview-isolation.cjs .env.production.local .env.preview.local
//   (afterwards delete both files: they contain secrets)
//
// Compares the two files per resource group using SHA-256 digests in memory. Output per variable: "getrennt", "GLEICH"
// (shared with production), "fehlt in Preview" or "nur Preview". For connection strings the host is compared too (a Neon
// branch has its own endpoint host). Finally it prints the NON_PRODUCTION_SANDBOX_RESOURCES value that the evidence
// supports – only resources whose every variable is separate (or absent in preview) qualify.
// Exit code: 0 = every resource separate, 2 = at least one resource shared, 1 = usage/parse error.
const fs = require('node:fs');
const crypto = require('node:crypto');

// Resource → variables that must not share a value with production. Mirrors docs/PREVIEW_ISOLATION_CHECKLIST.md.
const RESOURCES = {
  database: ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL', 'DATABASE_POSTGRES_URL_NON_POOLING'],
  blob: ['BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID'],
  whatsapp: ['WHATSAPP_ACCESS_TOKEN', 'WHATTSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATTSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID',
    'WHATTSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_APPROVER_WA_ID', 'WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET'],
  // Tokens and the client secrets that can mint new tokens from a refresh token (J-05: Pinterest and client secrets added).
  publishing: ['META_SYSTEM_USER_TOKEN', 'META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID', 'META_INSTAGRAM_USER_ID', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_REFRESH_TOKEN',
    'TIKTOK_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_CLIENT_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET', 'X_API_KEY', 'X_API_SECRET',
    'PINTEREST_ACCESS_TOKEN', 'PINTEREST_CLIENT_SECRET', 'PINTEREST_BOARD_ID'],
  paid_providers: ['REPLICATE_API_TOKEN', 'OPENAI_API_KEY', 'RUNWAYML_API_SECRET', 'HEYGEN_API_KEY', 'FACELESS_API_KEY', 'TAVILY_API_KEY', 'AI_GATEWAY_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
};
// Not a resource, but a shared value lets a preview visitor use production credentials.
// ADMIN_SESSION_SECRET signs the admin session cookie (J-05).
const ACCESS = ['CONTENT_STUDIO_PASSWORD', 'ADMIN_SESSION_SECRET', 'CRON_SECRET'];
const CONNECTION = /^(DATABASE_URL|DATABASE_URL_UNPOOLED|POSTGRES_URL|POSTGRES_URL_NON_POOLING|DATABASE_POSTGRES_URL|DATABASE_POSTGRES_URL_NON_POOLING)$/;

function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value.replace(/\\n/g, '\n');
  }
  return values;
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function hostOf(value) { try { return new URL(value).hostname.toLowerCase(); } catch { return null; } }

function compare(production, preview) {
  const rows = [];
  const resources = {};
  const verdict = name => {
    const prod = production[name]?.trim(), prev = preview[name]?.trim();
    if (!prev && !prod) return null;                         // not used in either environment
    if (!prev) return 'fehlt in Preview';                     // preview cannot use it: separate by absence
    if (!prod) return 'nur Preview';
    if (digest(prod) === digest(prev)) return 'GLEICH';
    if (CONNECTION.test(name) && hostOf(prod) && hostOf(prod) === hostOf(prev)) return 'GLEICHER HOST';
    return 'getrennt';
  };
  for (const [resource, names] of Object.entries(RESOURCES)) {
    let shared = false;
    for (const name of names) {
      const state = verdict(name);
      if (!state) continue;
      rows.push({ resource, name, state });
      if (state === 'GLEICH' || state === 'GLEICHER HOST') shared = true;
    }
    resources[resource] = !shared;
  }
  const access = ACCESS.map(name => ({ resource: 'zugang', name, state: verdict(name) })).filter(row => row.state);
  return { rows: [...rows, ...access], resources, accessShared: access.some(row => row.state === 'GLEICH') };
}

function main(argv) {
  if (argv.length !== 2) { console.error('Aufruf: node scripts/check-preview-isolation.cjs <production.env> <preview.env>'); return 1; }
  let production, preview;
  try { production = parseEnvFile(fs.readFileSync(argv[0], 'utf8')); preview = parseEnvFile(fs.readFileSync(argv[1], 'utf8')); }
  catch { console.error('Dateien nicht lesbar.'); return 1; }
  const result = compare(production, preview);
  for (const row of result.rows) console.log(`${row.resource.padEnd(15)} ${row.name.padEnd(36)} ${row.state}`);
  const isolated = Object.entries(result.resources).filter(([, ok]) => ok).map(([name]) => name);
  const shared = Object.entries(result.resources).filter(([, ok]) => !ok).map(([name]) => name);
  console.log('');
  console.log(shared.length ? `GEMEINSAM MIT PRODUCTION: ${shared.join(', ')}` : 'Alle Ressourcen getrennt.');
  if (result.accessShared) console.log('WARNUNG: Zugangscode oder Cron-Secret ist in Preview identisch mit Production.');
  console.log(`Durch diese Dateien belegbar: NON_PRODUCTION_SANDBOX_RESOURCES=${isolated.join(',')}`);
  console.log('Hinweis: Belegt nur verschiedene Werte, nicht dass die Preview-Ressourcen Testressourcen sind. Dateien danach löschen.');
  return shared.length ? 2 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { parseEnvFile, compare, RESOURCES, ACCESS };

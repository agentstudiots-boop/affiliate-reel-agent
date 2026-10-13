// OFFLINE preflight for the first private live test of ONE platform. It publishes nothing and makes no network call.
//
//   npx tsc -p tsconfig.test.json                                   (compiles lib/ to .test-build)
//   node scripts/platform-smoke-preflight.cjs <platform> [env-file]   platform: instagram | facebook | tiktok | youtube | x
//
// Without env-file the current process environment is checked (e.g. after `vercel env pull` into a file, pass that file).
// The real smoke test is NOT a script: it runs through the normal pipeline and needs the operator's WhatsApp "Freigeben"
// for the exact version (hard invariant, AGENTS.md). This preflight only says whether that run would be private and
// correctly limited. It prints variable NAMES and the non-secret visibility switches, never a credential value.
// Exit code: 0 = no blocker, 2 = blocker(s), 1 = usage error.
const fs = require('node:fs');
const path = require('node:path');

const build = rel => require(path.resolve(__dirname, '..', '.test-build', rel));
const { capabilityOf, activePlatforms, liveSwitchOn } = build('lib/capabilities');
const { effectDecision, runtimeEnvironment } = build('lib/security/runtime-guard');
const { PLATFORMS } = build('lib/formats/catalog');

// Platforms without a private post mode: a smoke test there is public unless it targets a dedicated test page/account.
const NO_PRIVATE_MODE = { instagram: 'Instagram-Business-Testkonto', facebook: 'Facebook-Testseite', x: 'X-Testkonto (geschütztes Profil)' };

function preflight(platform, env) {
  const blockers = [], notes = [];
  if (!PLATFORMS.includes(platform)) return { blockers: [`Unbekannte Plattform: ${platform}`], notes };
  const active = activePlatforms(env);
  if (!env.TOPIC_PLATFORMS?.trim()) blockers.push('TOPIC_PLATFORMS ist leer = alle fünf Plattformen aktiv. Für den Test genau eine setzen.');
  else if (active.length !== 1 || active[0] !== platform) blockers.push(`TOPIC_PLATFORMS muss genau "${platform}" sein (aktuell: ${active.join(',') || 'keine gültige'}).`);
  const capability = capabilityOf(platform, env);
  if (capability.missing.length) blockers.push(`Zugangsdaten fehlen: ${capability.missing.join(', ')}`);
  if (platform === 'tiktok') {
    const level = env.TIKTOK_PRIVACY_LEVEL?.trim() || 'SELF_ONLY';
    if (level !== 'SELF_ONLY') blockers.push(`TIKTOK_PRIVACY_LEVEL=${level} ist öffentlich sichtbar. Für den Test SELF_ONLY (oder ungesetzt).`);
    else notes.push('TikTok: Sichtbarkeit SELF_ONLY (nur das eigene Konto).');
  }
  if (platform === 'youtube') {
    const status = env.YOUTUBE_PRIVACY_STATUS?.trim() || 'private';
    if (!['private', 'unlisted'].includes(status)) blockers.push(`YOUTUBE_PRIVACY_STATUS=${status} ist öffentlich. Für den Test private oder unlisted.`);
    else notes.push(`YouTube: Sichtbarkeit ${status}.`);
  }
  if (NO_PRIVATE_MODE[platform]) notes.push(`${platform}: Die API kennt keinen privaten Beitrag. Nur mit ${NO_PRIVATE_MODE[platform]} testen – nicht mit der Produktionsseite.`);
  const environment = runtimeEnvironment(env);
  if (!effectDecision('publish', env).ok) notes.push(`Umgebung "${environment}": Veröffentlichung durch den Runtime-Guard gesperrt (Preview ohne isolierte Ressource "publishing").`);
  notes.push(liveSwitchOn(env) ? 'TOPIC_LIVE_PUBLISHING=true: echte Veröffentlichung nach „Freigeben“ möglich.' : 'TOPIC_LIVE_PUBLISHING ist aus: nur Probelauf (für den eigentlichen Test erst danach einschalten).');
  if (env.TOPIC_PIPELINE_ENABLED !== 'true') notes.push('TOPIC_PIPELINE_ENABLED ist aus: Vorschläge entstehen erst nach dem Einschalten.');
  notes.push('Der Test selbst: Vorschlag per WhatsApp → „Freigeben“ → Produktion → Veröffentlichungsfreigabe der exakten Fassung → genau ein Beitrag.');
  return { blockers, notes };
}

function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function main(argv) {
  if (argv.length < 1 || argv.length > 2) { console.error('Aufruf: node scripts/platform-smoke-preflight.cjs <platform> [env-file]'); return 1; }
  let env = process.env;
  if (argv[1]) { try { env = parseEnvFile(fs.readFileSync(argv[1], 'utf8')); } catch { console.error('Env-Datei nicht lesbar.'); return 1; } }
  const { blockers, notes } = preflight(argv[0].toLowerCase(), env);
  for (const item of blockers) console.log(`BLOCKER ${item}`);
  for (const item of notes) console.log(`HINWEIS ${item}`);
  console.log(blockers.length ? 'Nicht bereit für den privaten Test.' : 'Keine Blocker. Nichts wurde veröffentlicht.');
  return blockers.length ? 2 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { preflight, parseEnvFile };

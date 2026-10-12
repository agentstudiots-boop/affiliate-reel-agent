const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preflight } = require('../scripts/platform-smoke-preflight.cjs');

const SECRET = 'tok-secret-123';
const youtube = { YOUTUBE_CLIENT_ID: SECRET, YOUTUBE_CLIENT_SECRET: SECRET, YOUTUBE_REFRESH_TOKEN: SECRET };
const tiktok = { TIKTOK_ACCESS_TOKEN: SECRET };

test('preflight: exactly one platform, complete credentials and private visibility → no blocker', () => {
  const result = preflight('youtube', { ...youtube, TOPIC_PLATFORMS: 'youtube' });
  assert.deepEqual(result.blockers, []);
  assert.ok(result.notes.some(note => /YouTube: Sichtbarkeit private/.test(note)));
  assert.deepEqual(preflight('tiktok', { ...tiktok, TOPIC_PLATFORMS: 'tiktok' }).blockers, []);
});
test('preflight: empty or multiple TOPIC_PLATFORMS, missing credentials and public visibility are blockers', () => {
  assert.match(preflight('youtube', youtube).blockers.join(), /TOPIC_PLATFORMS ist leer/);
  assert.match(preflight('youtube', { ...youtube, TOPIC_PLATFORMS: 'youtube,x' }).blockers.join(), /genau "youtube"/);
  assert.match(preflight('youtube', { TOPIC_PLATFORMS: 'youtube' }).blockers.join(), /YOUTUBE_REFRESH_TOKEN/);
  assert.match(preflight('youtube', { ...youtube, TOPIC_PLATFORMS: 'youtube', YOUTUBE_PRIVACY_STATUS: 'public' }).blockers.join(), /öffentlich/);
  assert.match(preflight('tiktok', { ...tiktok, TOPIC_PLATFORMS: 'tiktok', TIKTOK_PRIVACY_LEVEL: 'PUBLIC_TO_EVERYONE' }).blockers.join(), /SELF_ONLY/);
  assert.match(preflight('pinterest', {}).blockers.join(), /Unbekannte Plattform/);
});
test('preflight: platforms without a private mode require a test account; preview without isolated publishing is reported', () => {
  const ig = preflight('instagram', { TOPIC_PLATFORMS: 'instagram', META_SYSTEM_USER_TOKEN: SECRET, META_PAGE_ID: '1', META_INSTAGRAM_USER_ID: '2', BLOB_READ_WRITE_TOKEN: SECRET, VERCEL_ENV: 'preview' });
  assert.deepEqual(ig.blockers, []);
  assert.ok(ig.notes.some(note => /keinen privaten Beitrag/.test(note)));
  assert.ok(ig.notes.some(note => /Runtime-Guard gesperrt/.test(note)));
  assert.ok(!JSON.stringify(ig).includes(SECRET));
});
test('preflight script makes no network call and cannot publish', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'platform-smoke-preflight.cjs'), 'utf8');
  assert.ok(!/\bfetch\(|https?\.request|require\(['"](node:)?(http|https|net)['"]\)/.test(src));
  assert.ok(!/publishAll|authorizePublish|publishers|\.publish\(/.test(src));
});

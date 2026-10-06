const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../.test-build/lib/capabilities');

const SECRET = 'super-secret-value-123';
const env = over => ({ TOPIC_PLATFORMS: 'instagram,facebook,tiktok,youtube', META_SYSTEM_USER_TOKEN: SECRET, META_PAGE_ID: SECRET, META_INSTAGRAM_USER_ID: SECRET,
  BLOB_READ_WRITE_TOKEN: SECRET, YOUTUBE_CLIENT_ID: SECRET, YOUTUBE_CLIENT_SECRET: SECRET, REPLICATE_API_TOKEN: SECRET, ...over });

test('status lines: ready, dry run only, blocked with missing variable names, not activated — never values', () => {
  const lines = C.capabilityLines(env({ TOPIC_LIVE_PUBLISHING: 'true' }));
  assert.ok(lines.includes('Instagram: bereit'));
  assert.ok(lines.includes('Facebook: bereit'));
  assert.ok(lines.includes('TikTok: blockiert – TIKTOK_ACCESS_TOKEN oder TIKTOK_REFRESH_TOKEN + TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET fehlt'));
  assert.ok(lines.includes('YouTube Shorts: blockiert – YOUTUBE_REFRESH_TOKEN fehlt'));
  assert.ok(lines.includes('X: nicht aktiviert (nicht in TOPIC_PLATFORMS)'));
  assert.ok(lines.includes('HeyGen (Avatar-Video): blockiert – HEYGEN_API_KEY, HEYGEN_AVATAR_ID, HEYGEN_VOICE_ID, HEYGEN_MONTHLY_VIDEO_LIMIT fehlt'));
  assert.ok(lines.includes('Replicate (Bilder, Router, Texte): bereit'));
  assert.ok(!lines.join('\n').includes(SECRET));
  const off = C.capabilityLines(env({}));
  assert.ok(off.includes('Instagram: Zugang vorhanden, Live-Veröffentlichung aus (TOPIC_LIVE_PUBLISHING) – nur Dry-Run'));
});

test('capability detail: required, present, missing and what is possible', () => {
  const tiktok = C.capabilityOf('tiktok', env({ TIKTOK_REFRESH_TOKEN: 'x', TIKTOK_CLIENT_KEY: 'y' }));
  assert.equal(tiktok.state, 'blockiert');
  assert.deepEqual(tiktok.present, ['TIKTOK_REFRESH_TOKEN', 'TIKTOK_CLIENT_KEY']);
  assert.deepEqual(tiktok.can, { dryRun: true, produce: false, livePublish: false });
  const refreshed = C.capabilityOf('tiktok', env({ TIKTOK_REFRESH_TOKEN: 'x', TIKTOK_CLIENT_KEY: 'y', TIKTOK_CLIENT_SECRET: 'z', TOPIC_LIVE_PUBLISHING: 'true' }));
  assert.equal(refreshed.state, 'bereit');
  assert.equal(refreshed.can.livePublish, true);
  const replicate = C.capabilityOf('replicate', env({}));
  assert.deepEqual(replicate.can, { dryRun: true, produce: true, livePublish: false });
  const runway = C.capabilityOf('runway', env({ RUNWAYML_API_SECRET: 'x' }));
  assert.equal(runway.state, 'nicht_aktiviert');
});

test('livePublishCapability: platform, credentials and the live switch must all be satisfied', () => {
  assert.deepEqual(C.livePublishCapability('instagram', env({ TOPIC_LIVE_PUBLISHING: 'true' })), { ok: true });
  assert.equal(C.livePublishCapability('instagram', env({})).reason, 'live_publishing_disabled');
  assert.equal(C.livePublishCapability('x', env({ TOPIC_LIVE_PUBLISHING: 'true' })).reason, 'platform_not_enabled');
  assert.equal(C.livePublishCapability('youtube', env({ TOPIC_LIVE_PUBLISHING: 'true' })).reason, 'credentials_missing');
  assert.equal(C.livePublishCapability('myspace', env({ TOPIC_LIVE_PUBLISHING: 'true' })).reason, 'platform_not_enabled');
  assert.deepEqual(C.activePlatforms({}), ['instagram', 'facebook', 'tiktok', 'youtube', 'x']);
});

test('the credential matrix documents every variable the capability check knows', () => {
  const doc = fs.readFileSync('docs/CREDENTIALS.md', 'utf8');
  const names = new Set(C.SERVICES.flatMap(service => [...service.requires.flatMap(group => group.anyOf.flat()), ...service.optional.map(item => item.name)]));
  for (const name of names) assert.ok(doc.includes(`\`${name}\``), name);
  for (const service of C.SERVICES) assert.ok(doc.includes(service.label), service.label);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Inventory of every code path that can write to a social platform. The approval gate is a hard invariant
// (AGENTS.md): this test fails as soon as a new module starts using a platform write function, so every new path gets
// reviewed against lib/publishing/approval-gate.ts before it can merge. Extend the allowlists only after that review.
const root = path.join(__dirname, '..');
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const rel = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(rel);
  return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
});
const files = [...walk('lib'), ...walk('app')].map(file => file.split(path.sep).join('/'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const users = symbol => files.filter(file => new RegExp(`\\b${symbol}\\b`).test(read(file))).sort();

const ALLOWED = {
  // Meta write clients
  publishFacebookPhoto: ['app/api/whatsapp/webhook/route.ts', 'lib/distribution/publishers/legacy-affiliate.ts', 'lib/distribution/publishers/meta.ts', 'lib/meta/facebook-page.ts', 'lib/meta/publisher.ts'],
  facebookPageGraph: ['lib/distribution/publishers/meta.ts', 'lib/meta/facebook-page.ts'],
  instagramGraph: ['app/api/instagram/reel/route.ts', 'lib/distribution/publishers/meta.ts', 'lib/meta/advance-instagram.ts', 'lib/meta/instagram-image.ts', 'lib/meta/instagram-publisher.ts'],
  publishInstagramImage: ['app/api/whatsapp/webhook/route.ts', 'lib/distribution/publishers/legacy-affiliate.ts', 'lib/meta/instagram-image.ts'],
  advanceInstagram: ['app/api/instagram/reel/route.ts', 'lib/automation/continue.ts', 'lib/distribution/publishers/legacy-affiliate.ts', 'lib/meta/advance-instagram.ts'],
  // Platform publishers of the shared distribution layer
  defaultPublishers: ['lib/agents/topic-runtime.ts', 'lib/distribution/affiliate.ts', 'lib/distribution/publishers/index.ts'],
};

for (const [symbol, allowed] of Object.entries(ALLOWED)) {
  test(`platform write function ${symbol} is used only by reviewed modules`, () => {
    assert.deepEqual(users(symbol), [...allowed].sort());
  });
}

test('PlatformPublisher.publish is called only by publishAll, right after authorizePublish and assertPermitMatches', () => {
  const callers = files.filter(file => /\bpublisher\.publish\(/.test(read(file)));
  assert.deepEqual(callers, ['lib/distribution/publish.ts']);
  const src = read('lib/distribution/publish.ts');
  const authorize = src.indexOf('permit = await authorizePublish(');
  const assertMatch = src.indexOf('assertPermitMatches(permit, content, variant.platform)');
  const publish = src.indexOf('await publisher.publish(');
  assert.ok(authorize > 0 && assertMatch > authorize && publish > assertMatch, 'order: authorizePublish → assertPermitMatches → publish');
});

test('Instagram media_publish (graph.publish) runs only after the last-moment approval re-check', () => {
  const callers = files.filter(file => /\bgraph\.publish\(/.test(read(file))).sort();
  assert.deepEqual(callers, ['lib/meta/advance-instagram.ts', 'lib/meta/instagram-image.ts']);
  for (const file of callers) {
    const src = read(file);
    const check = src.search(/stillAuthorized\(db|verifyPublishStillAuthorized\(db/);
    const publish = src.indexOf('graph.publish(');
    assert.ok(check > 0 && check < publish, `${file}: re-check before media_publish`);
  }
});

test('the direct Studio route cannot create an Instagram container outside the shared distribution layer', () => {
  const src = read('app/api/instagram/reel/route.ts');
  const publishBranch = src.indexOf('if (action === "publish")');
  const direct = src.lastIndexOf('advanceInstagram(jobId, action');
  assert.ok(publishBranch > 0 && direct > publishBranch, 'publish is handled (and returns) before the generic advance call');
  assert.match(src.slice(publishBranch, direct), /publishApprovedAffiliateReel\(/);
  assert.match(src.slice(publishBranch, direct), /return Response\.json\(\{ publication: await repo\.get\(jobId\), stage: "processing" \}\)/);
});

test('no code path requests affiliate product links (no artificial clicks)', () => {
  // Product links are only ever written into texts; they are never fetched by the server.
  for (const file of files) {
    const src = read(file);
    assert.ok(!/fetch\([^)]*affiliateUrl/.test(src), `${file} fetches an affiliate URL`);
    assert.ok(!/fetch\([^)]*amzn\.to|fetch\(\s*["'`]https:\/\/(www\.)?amazon\./.test(src), `${file} requests an Amazon/affiliate link`);
  }
});

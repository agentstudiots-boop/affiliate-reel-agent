const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../.test-build/lib/landing/legal');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('legal profile never contains invented data: every required field is either null or supplied by the operator', () => {
  const missing = L.missingLegalFields().map(item => item.key);
  for (const key of ['name', 'street', 'postalCodeCity', 'country', 'email']) {
    const set = !!L.LEGAL[key];
    assert.equal(missing.includes(key), !set);
  }
  assert.equal(L.legalComplete(), missing.length === 0);
  assert.equal(L.missingLegalFields({ ...L.LEGAL, name: ' ' }).some(item => item.key === 'name'), true);
});

test('incomplete legal pages carry a visible draft notice and noindex, complete ones do not', () => {
  const shell = read('app/legal-shell.tsx');
  assert.match(shell, /legalComplete\(\)/);
  assert.match(shell, /Entwurf .{1,3} nicht zur Ver.{1,3}ffentlichung freigegeben/);
  for (const page of ['app/impressum/page.tsx', 'app/datenschutz/page.tsx']) {
    assert.match(read(page), /index: false/);
    assert.match(read(page), /legalComplete\(\)/);
  }
});

test('privacy policy matches the code: no cookies, analytics or third-party embeds exist on the public pages', () => {
  const files = ['app/produkte/landing-view.tsx', 'app/produkte/track-link.tsx', 'app/produkte/page.tsx', 'app/legal-shell.tsx', 'app/impressum/page.tsx', 'app/datenschutz/page.tsx', 'app/layout.tsx'];
  for (const file of files) {
    const src = read(file);
    assert.ok(!/document\.cookie|localStorage|sessionStorage|gtag|googletagmanager|fbq\(|<iframe|<script|@vercel\/analytics|speed-insights/.test(src), `${file} uses storage, tracking or embeds`);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(name => /analytics|speed-insights|gtag|pixel/.test(name)));
  assert.ok(!fs.existsSync(path.join(root, 'middleware.ts')) && !fs.existsSync(path.join(root, 'proxy.ts')));
  // The click beacon sends only an id and the click table stores no IP address or user agent.
  assert.match(read('app/api/landing/click/route.ts'), /INSERT INTO landing_clicks\(publication_id,job_id\)/);
  assert.ok(!/\\b(ip|ip_address|user_agent)\\b/i.test(read('db/migrations/025_landing_clicks.sql')));
});

test('footer links to both legal pages and the affiliate disclosure and the product links stay sponsored and unchanged', () => {
  const view = read('app/produkte/landing-view.tsx');
  assert.match(view, /"\/impressum"/);
  assert.match(view, /"\/datenschutz"/);
  assert.match(view, /id="affiliate-hinweis"/);
  assert.match(view, /<TrackedLink id=\{item\.id\} href=\{item\.affiliateUrl\}/);
  assert.match(read('app/produkte/track-link.tsx'), /rel="sponsored noopener noreferrer"/);
});

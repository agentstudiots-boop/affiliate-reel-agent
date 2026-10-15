const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const loadRoute = require('./helpers/load-route.cjs');

// Admin login: signed HttpOnly session, protected internal area, public webhooks/cron/landing, logout.
const CODE = 'admin-session-test-code-123';
const session = () => require('../.test-build/lib/security/admin-session.js');
const policy = () => require('../.test-build/lib/security/access-policy.js');
const auth = () => require('../.test-build/lib/memory/auth.js');

function withEnv(t, extra = {}) {
  const env = { CONTENT_STUDIO_PASSWORD: CODE, ADMIN_SESSION_SECRET: undefined, ...extra };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}
const cookieOf = token => `other=1; ${session().ADMIN_SESSION_COOKIE}=${token}`;

test('session token: valid when signed with the current code; expired, tampered, foreign or unconfigured tokens fail', t => {
  withEnv(t);
  const { issueSessionToken, verifySessionToken, ADMIN_SESSION_TTL_SECONDS } = session();
  const now = Date.UTC(2026, 9, 15, 10);
  const issued = issueSessionToken(now);
  assert.ok(issued && issued.token.split('.').length === 2);
  assert.equal(issued.expiresAt, now + ADMIN_SESSION_TTL_SECONDS * 1000);
  assert.equal(verifySessionToken(issued.token, now + 1000).valid, true);
  assert.equal(verifySessionToken(issued.token, issued.expiresAt).valid, false, 'expired');
  const [body, sig] = issued.token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), exp: 9999999999 })).toString('base64url');
  assert.equal(verifySessionToken(`${forged}.${sig}`, now).valid, false, 'tampered payload');
  assert.equal(verifySessionToken(`${body}.${sig.slice(0, -2)}AA`, now).valid, false, 'tampered signature');
  assert.equal(verifySessionToken('', now).valid, false);
  assert.equal(verifySessionToken('a.b.c', now).valid, false);
  // Token carries no secret.
  assert.doesNotMatch(Buffer.from(body, 'base64url').toString(), new RegExp(CODE));
  // Rotating the access code (or ADMIN_SESSION_SECRET) ends every session.
  process.env.CONTENT_STUDIO_PASSWORD = 'rotated-code-456';
  assert.equal(verifySessionToken(issued.token, now).valid, false);
  process.env.CONTENT_STUDIO_PASSWORD = CODE; process.env.ADMIN_SESSION_SECRET = 'extra';
  assert.equal(verifySessionToken(issued.token, now).valid, false);
  delete process.env.ADMIN_SESSION_SECRET; delete process.env.CONTENT_STUDIO_PASSWORD;
  assert.equal(issueSessionToken(now), null, 'no access code configured: no session at all');
  assert.equal(verifySessionToken(issued.token, now).valid, false);
});

test('cookies are HttpOnly, SameSite=Strict, Secure on https; next path never redirects off-site', t => {
  withEnv(t);
  const { sessionCookie, clearedSessionCookie, safeNextPath } = session();
  const cookie = sessionCookie('tok', true);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\//);
  assert.match(clearedSessionCookie(true), /Max-Age=0/);
  for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', '/login', '/api/content', 42, undefined]) assert.equal(safeNextPath(bad), '/');
  assert.equal(safeNextPath('/?tab=1'), '/?tab=1');
});

test('authorized(): access-code header or session cookie; cookie state changes only from the same origin', t => {
  withEnv(t);
  const { authorized } = auth();
  const { token } = session().issueSessionToken();
  const url = 'https://studio.test/api/operations';
  assert.equal(authorized(new Request(url)), false);
  assert.equal(authorized(new Request(url, { headers: { 'x-content-password': 'wrong' } })), false);
  assert.equal(authorized(new Request(url, { headers: { 'x-content-password': CODE } })), true);
  assert.equal(authorized(new Request(url, { headers: { cookie: cookieOf(token) } })), true);
  assert.equal(authorized(new Request(url, { method: 'POST', headers: { cookie: cookieOf(token), origin: 'https://studio.test' } })), true);
  assert.equal(authorized(new Request(url, { method: 'POST', headers: { cookie: cookieOf(token), origin: 'https://evil.test' } })), false, 'CSRF');
  assert.equal(authorized(new Request(url, { method: 'POST', headers: { cookie: cookieOf(token), 'sec-fetch-site': 'cross-site' } })), false, 'CSRF without Origin');
  assert.equal(authorized(new Request(url, { headers: { cookie: cookieOf('forged.token') } })), false);
});

test('access policy: internal pages and APIs are protected; webhooks, cron, landing, legal and login stay public', () => {
  const { classifyPath } = policy();
  for (const path of ['/', '/?x=1', '/architecture', '/unknown']) assert.equal(classifyPath(path.split('?')[0]), 'internal_page', path);
  for (const path of ['/api/admin/migrate', '/api/content', '/api/content/jobs', '/api/operations', '/api/architecture', '/api/publication', '/api/production', '/api/trends', '/api/verify',
    '/api/meta/connection', '/api/whatsapp/connection', '/api/assets/upload', '/api/video/status', '/api/instagram/reel', '/api/generate'])
    assert.equal(classifyPath(path), 'internal_api', path);
  for (const path of ['/login', '/produkte', '/produkte/abc', '/impressum', '/datenschutz', '/api/whatsapp/webhook', '/api/cron/daily-draft', '/api/cron/topic-scout',
    '/api/cron/continue', '/api/cron/weekly-report', '/api/landing/click', '/api/auth/login', '/api/auth/logout', '/api/auth/session', '/_next/static/x.js', '/favicon.ico'])
    assert.equal(classifyPath(path), 'public', path);
  // Every API route in the repo is classified deliberately: new public routes need an explicit decision here.
  const routes = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${entry.name}`; if (entry.isDirectory()) walk(p); else if (entry.name === 'route.ts') routes.push(p); } };
  walk('app/api');
  const publicRoutes = routes.map(p => p.slice(3, -'/route.ts'.length)).filter(p => classifyPath(p) === 'public').sort();
  assert.deepEqual(publicRoutes, ['/api/auth/login', '/api/auth/logout', '/api/auth/session', '/api/cron/continue', '/api/cron/daily-draft', '/api/cron/topic-scout',
    '/api/cron/weekly-report', '/api/landing/click', '/api/whatsapp/webhook']);
  // Each public route keeps its own server-side protection.
  for (const file of fs.readdirSync('app/api/cron')) assert.match(fs.readFileSync(`app/api/cron/${file}/route.ts`, 'utf8'), /CRON_SECRET[\s\S]*timingSafeEqual/);
  assert.match(fs.readFileSync('app/api/whatsapp/webhook/route.ts', 'utf8'), /verifyMetaWebhookSignature/);
});

test('proxy.ts uses the policy and the session verifier (no hidden-URL protection)', () => {
  const source = fs.readFileSync('proxy.ts', 'utf8');
  assert.match(source, /export function proxy/);
  assert.match(source, /classifyPath/);
  assert.match(source, /verifySessionToken/);
  assert.match(source, /status: 401/);
  assert.match(source, /\/login/);
});

test('login route: wrong code → no cookie; right code → HttpOnly session; cross-origin login refused; logout clears', async t => {
  withEnv(t);
  const login = loadRoute('app/api/auth/login/route.ts');
  const post = (body, headers = {}) => login.POST(new Request('https://studio.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://studio.test', ...headers }, body: JSON.stringify(body) }));
  const wrong = await post({ password: 'nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.doesNotMatch(JSON.stringify(await wrong.json()), new RegExp(CODE));
  assert.equal((await post({ password: CODE }, { origin: 'https://evil.test' })).status, 403);
  const ok = await post({ password: CODE, next: 'https://evil.test' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^acs_admin_session=[^;]+; Path=\/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure$/);
  const token = cookie.split(';')[0].split('=')[1];
  assert.equal(session().verifySessionToken(token).valid, true);
  // Form login redirects only within the app.
  const form = new FormData(); form.set('password', CODE); form.set('next', '//evil.test');
  const redirected = await login.POST(new Request('https://studio.test/api/auth/login', { method: 'POST', headers: { origin: 'https://studio.test' }, body: form }));
  assert.equal(redirected.status, 303); assert.equal(redirected.headers.get('location'), '/');
  // Session endpoint and logout.
  const state = loadRoute('app/api/auth/session/route.ts');
  assert.deepEqual(await (await state.GET(new Request('https://studio.test/api/auth/session'))).json(), { authenticated: false });
  assert.equal((await (await state.GET(new Request('https://studio.test/api/auth/session', { headers: { cookie: cookieOf(token) } }))).json()).authenticated, true);
  const logout = loadRoute('app/api/auth/logout/route.ts');
  const out = await logout.POST(new Request('https://studio.test/api/auth/logout', { method: 'POST', headers: { origin: 'https://studio.test' } }));
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await logout.POST(new Request('https://studio.test/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.test' } }))).status, 403);
});

test('protected routes accept the session cookie (e.g. operations) and refuse it cross-origin; config GET is no longer public', async t => {
  withEnv(t);
  const { token } = session().issueSessionToken();
  const content = loadRoute('app/api/content/route.ts', {
    '@/lib/product-resolver': {}, '@/lib/orchestrator': {}, '@/lib/memory/repository': { ConflictError: class extends Error {} },
    '@/lib/whatsapp/content-approval': {}, '@/lib/whatsapp/language-memory': {}, '@/lib/memory/db': { databaseConfigured: () => true },
  });
  assert.equal(content.GET(new Request('https://studio.test/api/content')).status, 401);
  assert.equal(content.GET(new Request('https://studio.test/api/content', { headers: { cookie: cookieOf(token) } })).status, 200);
  const migrate = loadRoute('app/api/admin/migrate/route.ts', { '@/lib/memory/db': { databaseConfigured: () => true }, '@/lib/memory/migrations': { applyMigrations: async () => { throw new Error('should not run'); } } });
  assert.equal(migrate.GET(new Request('https://studio.test/api/admin/migrate')).status, 401);
  assert.doesNotMatch(await migrate.GET(new Request('https://studio.test/api/admin/migrate')).text(), /konfiguriert/);
  const crossSite = await migrate.POST(new Request('https://studio.test/api/admin/migrate', { method: 'POST', headers: { cookie: cookieOf(token), origin: 'https://evil.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=x' }));
  assert.equal(crossSite.status, 401);
});

test('frontend never holds the access code any more', () => {
  for (const file of ['app/page.tsx', 'app/content-studio.tsx', 'app/operations-panel.tsx', 'app/publication-gate.tsx', 'app/production-gate.tsx', 'app/architecture/command-center.tsx'])
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /x-content-password/, file);
  assert.match(fs.readFileSync('app/content-studio.tsx', 'utf8'), /\/api\/auth\/logout/);
});

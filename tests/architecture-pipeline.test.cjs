// Operations view of the Command Center (lib/architecture/pipeline-snapshot.ts): read-only stations per content path from
// a migrated PGlite database. Configuration alone never makes a station "belegt"; unknown figures stay null.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { readPipelineView } = require('../.test-build/lib/architecture/pipeline-snapshot');
const { checkCapabilities } = require('../.test-build/lib/capabilities');
const { NonProductionEffectError } = require('../.test-build/lib/security/runtime-guard');

const NOW = new Date('2026-10-30T12:00:00Z');
const OFF = { topicPipeline: false, topicDailyVideo: false, livePublishing: false };
const station = (view, track, id) => view.tracks.find(item => item.id === track).stations.find(item => item.id === id);

async function job(db, status = 'awaiting_approval') {
  const id = randomUUID();
  await db.query("INSERT INTO products(id,name,source_url) VALUES($1,'Produkt','https://www.amazon.de/dp/B000000001') ON CONFLICT DO NOTHING", ['B000000001']);
  await db.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
    VALUES($1,'B000000001','kitchen','k','g','instagram','t','{}',$2,'{}',now(),now())`, [id, status]);
  return id;
}

test('preview: the runtime guard blocks the database and the view says so', async () => {
  const view = await readPipelineView({ capabilities: [], switches: OFF, now: NOW, open: () => { throw new NonProductionEffectError('database'); } });
  assert.equal(view.available, false);
  assert.match(view.reason, /Runtime-Guard/);
  assert.deepEqual(view.tracks, []);
});

test('empty database: nothing is "belegt", unknown figures are null (never 0 for reach/revenue)', async () => {
  const db = await pgliteDatabase();
  try {
    const view = await readPipelineView({ capabilities: checkCapabilities({}), switches: OFF, now: NOW, open: () => db });
    assert.equal(view.available, true);
    assert.deepEqual(view.tracks.map(track => track.stations.map(item => item.id)), [['topic', 'draft', 'media', 'approvals', 'publication', 'results'], ['topic', 'draft', 'media', 'approvals', 'publication', 'results']]);
    for (const track of view.tracks) for (const item of track.stations) assert.notEqual(item.state, 'belegt', `${track.id}/${item.id}`);
    assert.equal(view.serviceWindow.open, false);
    assert.deepEqual({ drafts: view.undelivered.drafts, runs: view.undelivered.runs }, { drafts: 0, runs: 0 });
    const results = station(view, 'affiliate', 'results');
    assert.equal(results.metrics.find(item => item.label === 'Reichweite').value, null);
    assert.equal(results.metrics.find(item => item.label === 'Provisionen').value, null);
    assert.equal(station(view, 'topic', 'topic').state, 'aus');
    assert.equal(station(view, 'topic', 'publication').state, 'aus');
  } finally { await db.close(); }
});

test('configured provider without a successful job is not "belegt" (configured ≠ executed)', async () => {
  const db = await pgliteDatabase();
  try {
    const env = { RUNWAYML_API_SECRET: 'x', TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT: '2', TOPIC_STANDARD_VIDEO_PROVIDER: 'runway' };
    const view = await readPipelineView({ capabilities: checkCapabilities(env), switches: { topicPipeline: true, topicDailyVideo: true, livePublishing: false }, now: NOW, open: () => db });
    const media = station(view, 'topic', 'media');
    assert.notEqual(media.state, 'belegt');
    assert.match(media.reason, /Runway \(konfiguriert ≠ geprüft\)/);
  } finally { await db.close(); }
});

test('undelivered drafts: distinct drafts and cron calls are counted separately', async () => {
  const db = await pgliteDatabase();
  try {
    const a = randomUUID(), b = randomUUID();
    const run = (jobId, outcome, whatsapp, minutes) => db.query(`INSERT INTO daily_slot_runs(id,invoked_at,day,slot,outcome,whatsapp,job_id)
      VALUES($1,$2,'2026-10-30','morning',$3,$4,$5)`, [randomUUID(), new Date(NOW.getTime() - minutes * 60_000).toISOString(), outcome, whatsapp, jobId]);
    await run(a, 'awaiting_approval', 'template_required', 300);
    await run(a, 'already_claimed', 'approval_send_failed', 240);
    await run(a, 'already_claimed', 'approval_send_failed', 180);
    await run(b, 'awaiting_approval', 'approval_not_sent', 120);
    await run(b, 'already_claimed', 'approval_sent', 60);
    const view = await readPipelineView({ capabilities: [], switches: OFF, now: NOW, open: () => db });
    assert.deepEqual({ drafts: view.undelivered.drafts, runs: view.undelivered.runs }, { drafts: 2, runs: 4 });
  } finally { await db.close(); }
});

test('affiliate path: open approval with delivery status, published post with platform id and link, 24 h window', async () => {
  const db = await pgliteDatabase();
  try {
    const pending = await job(db);
    await db.query(`INSERT INTO content_approval_requests(id,job_id,content_hash,status,approver_wa_id,whatsapp_message_id,created_at)
      VALUES($1,$2,'h','pending','49','wamid.A',$3)`, [randomUUID(), pending, NOW.toISOString()]);
    await db.query("INSERT INTO whatsapp_delivery_statuses(message_id,status) VALUES('wamid.A','sent'),('wamid.A','delivered')");
    const published = await job(db, 'published');
    await db.query(`INSERT INTO publication_requests(id,job_id,platform,status,caption,content_hash,approver_wa_id,meta_post_id,permalink,updated_at)
      VALUES($1,$2,'facebook','published','c','h','49','123_456','https://www.facebook.com/123/posts/456',$3)`, [randomUUID(), published, new Date(NOW.getTime() - 3600_000).toISOString()]);
    await db.query("INSERT INTO whatsapp_events(message_id,wa_id,payload,received_at) VALUES('in.1','49','{}',$1)", [new Date(NOW.getTime() - 2 * 3600_000).toISOString()]);
    const view = await readPipelineView({ capabilities: [], switches: OFF, now: NOW, open: () => db });
    const approvals = station(view, 'affiliate', 'approvals');
    assert.equal(approvals.state, 'wartet_betreiber');
    assert.equal(approvals.current.contentId, pending);
    assert.match(approvals.reason, /Inhaltsfreigabe offen – zugestellt/);
    assert.equal(approvals.next.owner, 'Betreiber');
    const publication = station(view, 'affiliate', 'publication');
    assert.equal(publication.state, 'belegt');
    assert.deepEqual(publication.publications[0], { platform: 'facebook', status: 'published', externalId: '123_456', url: 'https://www.facebook.com/123/posts/456', at: new Date(NOW.getTime() - 3600_000).toISOString() });
    assert.equal(view.serviceWindow.open, true);
    assert.equal(view.serviceWindow.openUntil, new Date(NOW.getTime() + 22 * 3600_000).toISOString());
  } finally { await db.close(); }
});

test('affiliate path: an approval request that never reached the operator is a blocker with the 24 h hint', async () => {
  const db = await pgliteDatabase();
  try {
    const pending = await job(db);
    await db.query(`INSERT INTO content_approval_requests(id,job_id,content_hash,status,approver_wa_id) VALUES($1,$2,'h','pending','49')`, [randomUUID(), pending]);
    const view = await readPipelineView({ capabilities: [], switches: OFF, now: NOW, open: () => db });
    const approvals = station(view, 'affiliate', 'approvals');
    assert.equal(approvals.state, 'blockiert');
    assert.match(approvals.current.blocker, /24-h-Fenster geschlossen/);
    assert.match(approvals.next.action, /WhatsApp-Nachricht senden/);
  } finally { await db.close(); }
});

test('topic path: a held proposal waits for the operator; live publishing off is "aus", not an error', async () => {
  const db = await pgliteDatabase();
  try {
    await db.query(`INSERT INTO topic_runs(id,started_at,outcome,selected_topic_id) VALUES($1,now(),'success','t1')`, [randomUUID()]);
    await db.query(`INSERT INTO topic_contents(content_id,topic_id,stage,format,candidate,decision,copy,delivery)
      VALUES('tc_1','t1','proposed','image','{}','{}','{"origin":"model"}','awaiting_window')`);
    const view = await readPipelineView({ capabilities: [], switches: { topicPipeline: true, topicDailyVideo: false, livePublishing: false }, now: NOW, open: () => db });
    assert.equal(station(view, 'topic', 'topic').state, 'belegt');
    const draft = station(view, 'topic', 'draft');
    assert.equal(draft.state, 'wartet_betreiber');
    assert.equal(draft.current.contentId, 'tc_1');
    assert.match(draft.next.action, /nachgeliefert/);
    assert.equal(station(view, 'topic', 'publication').state, 'aus');
    assert.equal(station(view, 'topic', 'results').metrics[0].value, null);
  } finally { await db.close(); }
});

test('a missing table leaves only its station unreadable, the others stay readable', async () => {
  const db = await pgliteDatabase();
  try {
    await db.exec('DROP TABLE landing_clicks');
    const view = await readPipelineView({ capabilities: [], switches: OFF, now: NOW, open: () => db });
    assert.match(station(view, 'affiliate', 'results').reason, /nicht lesbar/);
    assert.doesNotMatch(station(view, 'affiliate', 'approvals').reason, /nicht lesbar/);
  } finally { await db.close(); }
});

test('source: SELECT only, no provider, messaging or publishing imports, no buttons that act', () => {
  const src = fs.readFileSync('lib/architecture/pipeline-snapshot.ts', 'utf8');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/.test(src), 'pipeline view must not write');
  assert.ok(!/from\s+["'][^"']*(whatsapp\/client|distribution\/publish|publishing\/approval-gate|visual\/providers|runway|production\/)/.test(src));
  const panel = fs.readFileSync('app/architecture/pipeline-panel.tsx', 'utf8');
  assert.ok(!/fetch\(|method:\s*"POST"/.test(panel), 'the panel only displays');
  assert.doesNotMatch(panel, /^import \{[^}]*\} from "@\/lib\//m, 'type imports only: no server code in the client bundle');
  const center = fs.readFileSync('app/architecture/command-center.tsx', 'utf8');
  assert.match(center, /useState<"operations" \| [^>]*>\(standalone \? "operations" : "architecture"\)/, 'the standalone page (phone) opens the operations view');
});

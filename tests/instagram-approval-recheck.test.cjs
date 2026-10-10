const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./helpers/affiliate-image-fixture.cjs');
const G=require('../.test-build/lib/publishing/approval-gate');
const {publishInstagramImage,resumeInstagramImages,finishInstagramImage}=require('../.test-build/lib/meta/instagram-image');
const {publishApprovedAffiliateImage}=require('../.test-build/lib/distribution/affiliate');
const {setEventSink}=require('../.test-build/lib/observability/events');

setEventSink(()=>{});
// P-11: a container created under an earlier permit must not be published once the approval is gone.
const STUCK=()=>Array(8).fill('PROCESSING');              // the container never finishes within one call
const contentOf=f=>`aff_img_${f.publicationId}`;
const igRow=f=>f.pg.query('SELECT status,error_phase,error_detail FROM instagram_image_posts').then(r=>r.rows[0]);
const attempt=(f,platform='instagram')=>f.pg.query("SELECT status,reason FROM publish_attempts WHERE content_id=$1 AND platform=$2 AND status<>'blocked' ORDER BY created_at DESC LIMIT 1",[contentOf(f),platform]).then(r=>r.rows[0]);
const asProcessing=async f=>{ // container created, Instagram still processing
  const result=await publishInstagramImage(f.publicationId,f.deps({statuses:STUCK()}));
  assert.equal(result.status,'processing');assert.equal(f.calls.publish,0);return result;
};

test('valid approval: a processing container is published exactly once by Status, also with parallel resume calls',async t=>{
  const f=await fixture(t);
  await asProcessing(f);
  const results=await Promise.all([resumeInstagramImages(f.deps()),resumeInstagramImages(f.deps())]);
  assert.ok(results.every(n=>n<=1));
  assert.equal(f.calls.publish,1,'media_publish runs once');
  assert.equal((await igRow(f)).status,'published');
  assert.equal(await resumeInstagramImages(f.deps()),0);assert.equal(f.calls.publish,1);
});

test('revoked approval: the stored container is NOT published and the attempt is voided',async t=>{
  const f=await fixture(t);
  await asProcessing(f);
  assert.deepEqual(await G.invalidateApprovals(f.db,contentOf(f),'operator_revoked'),[1]);
  await resumeInstagramImages(f.deps());
  assert.equal(f.calls.publish,0);
  const row=await igRow(f);assert.equal(row.status,'skipped');assert.equal(row.error_phase,'approval');assert.match(row.error_detail,/approval_invalidated/);
  assert.equal((await attempt(f)).status,'failed');
  assert.match(f.calls.notes.at(-1),/nicht veröffentlicht.*nicht mehr gültig/s);
  // Nothing re-opens it: later Status calls stay silent and never publish.
  assert.equal(await resumeInstagramImages(f.deps()),0);assert.equal(f.calls.publish,0);
});

test('changed content version: an approval of the old version does not cover the container',async t=>{
  const f=await fixture(t);
  await asProcessing(f);
  const changed='b'.repeat(64);
  // A new version registered for the same content (e.g. edited caption) is pending again; the old approval does not carry over.
  await f.pg.query("INSERT INTO content_versions(content_id,version,fingerprint,platforms) SELECT content_id,version+1,$2,platforms FROM content_versions WHERE content_id=$1 ORDER BY version DESC LIMIT 1",[contentOf(f),changed]);
  await f.pg.query("INSERT INTO publish_approvals(content_id,version,fingerprint,status) VALUES($1,2,$2,'pending')",[contentOf(f),changed]);
  await resumeInstagramImages(f.deps());
  assert.equal(f.calls.publish,0);assert.equal((await igRow(f)).status,'skipped');
});

test('approval revoked while the container is still being polled (late provider answer) still blocks media_publish',async t=>{
  const f=await fixture(t);
  await asProcessing(f);
  let polls=0;
  const deps=f.deps({statuses:['PROCESSING','PROCESSING','FINISHED']});
  deps.sleep=async()=>{if(++polls===1)await G.invalidateApprovals(f.db,contentOf(f),'revoked_while_polling');};
  await resumeInstagramImages(deps);
  assert.equal(f.calls.publish,0);assert.equal((await igRow(f)).status,'skipped');
});

test('already published job: no second media_publish, not by Status, not by a redelivered approval',async t=>{
  const f=await fixture(t);
  const first=await publishInstagramImage(f.publicationId,f.deps());
  assert.equal(first.status,'published');assert.equal(f.calls.publish,1);
  assert.equal(await resumeInstagramImages(f.deps()),0);
  // Meta redelivers the approval webhook: the shared distribution layer reports the stored result instead of posting again.
  const rerun=await publishApprovedAffiliateImage(f.publicationId,{db:f.db,trustedWaId:'491234',send:async()=>{},affiliate:{instagramImage:id=>publishInstagramImage(id,f.deps())}});
  assert.ok(rerun.outcomes.every(item=>item.reused||item.status==='blocked'||item.status==='failed'));
  assert.equal(f.calls.publish,1);
});

test('finishInstagramImage called directly without any permit never publishes (no bypass through the resume function)',async t=>{
  const f=await fixture(t,{grant:false});
  // A container exists in the database (as if created earlier) but the central gate never issued a permit.
  await f.pg.query("INSERT INTO instagram_image_posts(publication_id,status,container_id) VALUES($1,'container_created','111')",[f.publicationId]);
  const d=f.deps();
  const result=await finishInstagramImage(f.publicationId,{db:f.db,send:d.send,sleep:async()=>{},graph:await d.graph()});
  assert.equal(result.status,'blocked');assert.equal(f.calls.publish,0);
  assert.equal((await igRow(f)).status,'skipped');
});

test('an unclear (unknown) central attempt blocks the resume: never publish after an uncertain result',async t=>{
  const f=await fixture(t);
  await asProcessing(f);
  await f.pg.query("UPDATE publish_attempts SET status='unknown' WHERE content_id=$1 AND platform='instagram'",[contentOf(f)]);
  await resumeInstagramImages(f.deps());
  assert.equal(f.calls.publish,0);
});

test('preview deployment: a pending container is not published even with a valid approval',async t=>{
  const f=await fixture(t);
  await asProcessing(f);
  const previous=process.env.VERCEL_ENV;process.env.VERCEL_ENV='preview';
  t.after(()=>{if(previous===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous;});
  t.mock.method(console,'warn',()=>{});
  await resumeInstagramImages(f.deps());
  assert.equal(f.calls.publish,0);
});

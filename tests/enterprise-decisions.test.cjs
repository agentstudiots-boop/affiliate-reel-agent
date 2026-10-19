const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const D=require('../.test-build/lib/enterprise/decisions');

const SQL=fs.readFileSync('db/migrations/041_enterprise_decisions.sql','utf8');
const LIMITS={maxSteps:5,maxDepth:3,budgetCents:10_000};
const plan=(department,taskKind,extra={})=>validatePlan({goal:'x',steps:[{id:'s',department,taskKind,dependsOn:[],maxCostCents:0,maxModelCalls:0,...extra}],expectedValue:null,costCapCents:5000},LIMITS);
const publishStep=()=>plan('affiliate','affiliate.publication_request').decisionRequests[0];   // L3b
const budgetStep=()=>plan('executive','executive.budget_change').decisionRequests[0];          // L4
const OPTIONS=[{id:'yes',label:'Freigeben'},{id:'no',label:'Ablehnen'}];
const request=(db,extra={})=>D.requestDecision(db,{step:publishStep(),subjectKey:'affiliate:post:42',subject:'Beitrag 42 auf Facebook veröffentlichen',options:OPTIONS,
  recommendation:{optionId:'yes',reason:'Inhalt freigegeben'},...extra});
const row=async(db,id)=>(await db.query('SELECT status,authority,decided_message_id,request_message_id FROM enterprise_decisions WHERE id=$1',[id])).rows[0];
const reply=(r,extra={})=>({id:r.id,fingerprint:r.fingerprint,decision:'approved',authority:'whatsapp_operator',requestMessageId:'wamid.request',decidedMessageId:`wamid.reply.${crypto.randomUUID()}`,...extra});

test('migration 041 is additive, idempotent and registered (AC-1)',async()=>{
  assert.doesNotMatch(SQL,/\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|RENAME)\b/i);
  for(const statement of SQL.match(/CREATE (TABLE|UNIQUE INDEX|INDEX)[^\n]*/g))assert.match(statement,/IF NOT EXISTS/,statement);
  const db=await pgliteDatabase();
  await db.exec(SQL);
  const again=await applyMigrations(db);
  assert.deepEqual(again.applied,[]);
  assert.ok(again.alreadyApplied.includes('041_enterprise_decisions.sql'));
  assert.match(fs.readFileSync('lib/memory/ensure-automation-schema.ts','utf8'),/enterprise_decisions'\) IS NOT NULL AS enterprise_decisions/);
  // The schema itself: only decision levels, only the operator, a decided row carries its evidence.
  const base={id:crypto.randomUUID(),subject_key:'k',version:1,level:'L3b',department:'affiliate',task_kind:'affiliate.publication_request',subject:'s',
    fingerprint:'a'.repeat(64),expires_at:new Date(Date.now()+3600_000).toISOString()};
  const insert=fields=>{const r={...base,id:crypto.randomUUID(),...fields};const k=Object.keys(r);return db.query(`INSERT INTO enterprise_decisions(${k.join(',')}) VALUES(${k.map((_,i)=>`$${i+1}`).join(',')})`,k.map(x=>r[x]));};
  for(const bad of [{level:'L2'},{level:'L0'},{authority:'executive_agent'},{status:'approved'},{fingerprint:'xyz'},{expires_at:'2000-01-01T00:00:00Z'}])
    await assert.rejects(insert(bad),undefined,JSON.stringify(bad));
  await insert({subject_key:'p1'});
  await assert.rejects(insert({subject_key:'p1',version:2}),undefined,'second pending request for the same subject');
  await db.close();
});

test('only decision levels become requests; content is fingerprinted and validated (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const executable=plan('controlling','controlling.monthly_close').executable[0];
  await assert.rejects(D.requestDecision(db,{step:executable,subjectKey:'x',subject:'x',options:OPTIONS}),D.DecisionError);
  const r=await request(db);
  assert.deepEqual([r.version,r.level,/^[a-f0-9]{64}$/.test(r.fingerprint)],[1,'L3b',true]);
  assert.equal((await request(db)).id,r.id,'same content keeps the open request');
  for(const bad of [{options:[OPTIONS[0]]},{options:[OPTIONS[0],OPTIONS[0]]},{recommendation:{optionId:'maybe',reason:'x'}},{subject:'  '},
    {evidence:[{claim:'Reichweite steigt',kind:'fact'}]},{ttlHours:0},{ttlHours:24*30}])
    await assert.rejects(request(db,bad),D.DecisionError,JSON.stringify(bad));
  const l4=await D.requestDecision(db,{step:budgetStep(),subjectKey:'budget:opportunity:2026-11',subject:'Budget erhöhen',options:OPTIONS});
  assert.equal(l4.level,'L4');
  // Key order does not change the fingerprint; content does.
  const a=D.decisionFingerprint({level:'L3b',department:'a',taskKind:'a.b',subject:'s',options:OPTIONS,recommendation:{optionId:'yes',reason:'r'},evidence:[],maxCostCents:0});
  const b=D.decisionFingerprint({maxCostCents:0,evidence:[],recommendation:{reason:'r',optionId:'yes'},options:OPTIONS,subject:'s',taskKind:'a.b',department:'a',level:'L3b'});
  assert.equal(a,b);
  assert.notEqual(a,D.decisionFingerprint({level:'L3b',department:'a',taskKind:'a.b',subject:'s ',options:OPTIONS,recommendation:{optionId:'yes',reason:'r'},evidence:[],maxCostCents:0}));
  await db.close();
});

test('a changed request supersedes the open one; old answers no longer count (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const first=await request(db);
  assert.equal(await D.attachRequestMessage(db,first.id,'wamid.request'),true);
  const second=await request(db,{subject:'Beitrag 42 (neue Fassung) auf Facebook veröffentlichen'});
  assert.deepEqual([second.version,second.id!==first.id],[2,true]);
  assert.equal((await row(db,first.id)).status,'superseded');
  assert.deepEqual(await D.recordDecision(db,reply(first)),{ok:false,reason:'unknown_or_closed'});
  assert.equal(await D.attachRequestMessage(db,first.id,'wamid.other'),false,'a superseded request cannot be sent');
  await db.close();
});

test('only the operator, answering exactly the request message with the right fingerprint, decides (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const r=await request(db);
  assert.deepEqual(await D.recordDecision(db,reply(r)),{ok:false,reason:'wrong_message'},'not sent yet');
  assert.equal(await D.attachRequestMessage(db,r.id,'wamid.request'),true);
  assert.equal(await D.attachRequestMessage(db,r.id,'wamid.again'),false,'bound once');
  assert.deepEqual(await D.recordDecision(db,reply(r,{authority:'executive_agent'})),{ok:false,reason:'not_operator'});
  assert.deepEqual(await D.recordDecision(db,reply(r,{authority:'model'})),{ok:false,reason:'not_operator'});
  assert.deepEqual(await D.recordDecision(db,reply(r,{requestMessageId:'wamid.other'})),{ok:false,reason:'wrong_message'});
  assert.deepEqual(await D.recordDecision(db,reply(r,{fingerprint:'b'.repeat(64)})),{ok:false,reason:'fingerprint_mismatch'});
  assert.deepEqual(await D.recordDecision(db,reply(r,{decision:'maybe'})),{ok:false,reason:'unknown_or_closed'});
  assert.equal((await row(db,r.id)).status,'pending','nothing recorded so far');
  assert.deepEqual(await D.recordDecision(db,reply(r)),{ok:true,status:'approved'});
  const decided=await row(db,r.id);
  assert.deepEqual([decided.status,decided.authority,decided.request_message_id],['approved','whatsapp_operator','wamid.request']);
  assert.deepEqual(await D.recordDecision(db,reply(r,{decision:'rejected'})),{ok:false,reason:'unknown_or_closed'},'decided once');
  await db.close();
});

test('missing answers expire and never approve; an approval executes nothing (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const r=await request(db);
  await D.attachRequestMessage(db,r.id,'wamid.request');
  await db.query("UPDATE enterprise_decisions SET expires_at=now() - interval '1 second', created_at=now() - interval '2 seconds' WHERE id=$1",[r.id]);
  assert.deepEqual(await D.recordDecision(db,reply(r)),{ok:false,reason:'expired'});
  assert.deepEqual(await D.expireDecisions(db),[r.id]);
  assert.equal((await row(db,r.id)).status,'expired');

  const fresh=await request(db,{subjectKey:'affiliate:post:43'});
  await D.attachRequestMessage(db,fresh.id,'wamid.request2');
  const before=(await db.query("SELECT (SELECT count(*) FROM enterprise_tasks) AS tasks,(SELECT count(*) FROM enterprise_outbox) AS outbox,(SELECT count(*) FROM publish_attempts) AS publish")).rows[0];
  assert.equal((await D.recordDecision(db,reply(fresh,{requestMessageId:'wamid.request2'}))).ok,true);
  const after=(await db.query("SELECT (SELECT count(*) FROM enterprise_tasks) AS tasks,(SELECT count(*) FROM enterprise_outbox) AS outbox,(SELECT count(*) FROM publish_attempts) AS publish")).rows[0];
  assert.deepEqual(after,before,'an approved decision creates no task, no outbox entry and no publish attempt');
  await db.close();
});

test('module is isolated: no WhatsApp sending, no publishing, not wired into app code; authorities unchanged (AC-6)',()=>{
  const source=fs.readFileSync('lib/enterprise/decisions.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../memory/db','../publishing/authority','./plan','./policy','node:crypto']);
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|sendWhatsApp|publish\(|INSERT INTO enterprise_outbox|new Date\(\)|Date\.now/);
  assert.deepEqual(require('../.test-build/lib/publishing/authority').ACTIVE_APPROVAL_AUTHORITIES,['whatsapp_operator']);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)&&/enterprise\/decisions|enterprise_decisions/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');
  assert.deepEqual(users.sort(),[path.join('lib','memory','ensure-automation-schema.ts'),path.join('lib','memory','migrations.ts')]);
});

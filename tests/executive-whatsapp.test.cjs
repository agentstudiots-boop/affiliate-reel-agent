const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createHmac}=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const loadRoute=require('./helpers/load-route.cjs');
const E=require('../.test-build/lib/whatsapp/executive-status');

const OPERATOR='491701234567';
async function withEnv(values,fn){const old={};for(const k of Object.keys(values)){old[k]=process.env[k];if(values[k]===undefined)delete process.env[k];else process.env[k]=values[k];}
  try{return await fn();}finally{for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}}
const msg=(body,extra={})=>({id:`wamid.${crypto.randomUUID()}`,from:OPERATOR,body,replyToMessageId:null,payload:{},...extra});

test('only the exact command is recognised (AC-1)',()=>{
  for(const body of ['Executive','executive','Executive Status','executive-status!','EXECUTIVE STATUS?',' Executivestatus. '])assert.equal(E.isExecutiveStatusCommand(body),true,body);
  for(const body of ['Status','Weiter','Executive freigeben','Freigeben','Executive bitte Budget erhöhen','Was macht die Executive?',''])assert.equal(E.isExecutiveStatusCommand(body),false,body);
});

test('only the configured operator gets an answer; other senders and unknown approver fall through (AC-2)',async()=>{
  const db=await pgliteDatabase();const sent=[];const deps={database:()=>db,send:async t=>{sent.push(t);return 'wamid.out';}};
  await withEnv({WHATSAPP_APPROVER_WA_ID:OPERATOR},async()=>{
    assert.equal(await E.handleExecutiveStatus(msg('Executive',{from:'49999'}),deps),false);
    assert.equal(await E.handleExecutiveStatus(msg('Status'),deps),false);
  });
  await withEnv({WHATSAPP_APPROVER_WA_ID:undefined},async()=>assert.equal(await E.handleExecutiveStatus(msg('Executive'),deps),false));
  assert.deepEqual(sent,[]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM whatsapp_events')).rows[0].n,0);
  await db.close();
});

test('the answer is the read-only executive section, sent exactly once per message, and changes nothing (AC-3)',async()=>{
  const db=await pgliteDatabase();const sent=[];
  const now=new Date('2026-10-21T09:00:00Z');
  await db.query(`INSERT INTO enterprise_decisions(id,subject_key,version,level,department,task_kind,subject,fingerprint,expires_at,created_at)
    VALUES($1,'k',1,'L3b','affiliate','affiliate.publication_request','Beitrag 7 veröffentlichen',$2,'2026-10-23T09:00:00Z','2026-10-20T09:00:00Z')`,[crypto.randomUUID(),'a'.repeat(64)]);
  const snapshot=async()=>JSON.stringify((await db.query('SELECT id,status,authority,decided_message_id FROM enterprise_decisions ORDER BY id')).rows);
  const before=await snapshot();
  const deps={database:()=>db,send:async t=>{sent.push(t);return 'wamid.out';},now:()=>now};
  const m=msg('Executive Status',{from:'+49 170 1234567'});
  await withEnv({WHATSAPP_APPROVER_WA_ID:OPERATOR},async()=>{
    assert.equal(await E.handleExecutiveStatus(m,deps),true);
    assert.equal(await E.handleExecutiveStatus(m,deps),true);   // redelivery: claimed, not answered again
  });
  assert.equal(sent.length,1);
  const text=sent[0].replace(/ /g,' ');
  assert.match(text,/^Executive-Status \(letzte 7 Tage\)\n\nExecutive-Ebene \(nur Bericht, keine Wirkung\)\n/);
  assert.match(text,/Offene Entscheidungsvorlagen: 1\n– Beitrag 7 veröffentlichen \(L3b, gültig bis 23\.10\., 11:00\)/);
  assert.match(text,/nur als Antwort auf die jeweilige Anfrage-Nachricht/);
  assert.match(text,/Entschieden in den letzten 7 Tagen: freigegeben 0/);
  assert.match(text,/Kostenbuch in den letzten 7 Tagen: keine Einträge/);
  assert.ok(sent[0].length<=4000);
  assert.equal(await snapshot(),before,'the command never decides or changes a request');
  await db.close();
});

test('the module only reads and sends one text; no model, no decision path (AC-4)',()=>{
  const source=fs.readFileSync('lib/whatsapp/executive-status.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../enterprise/executive-weekly','../memory/db']);
  assert.doesNotMatch(source,/recordDecision|attachRequestMessage|replicate|recordModelCall|fetch\(|UPDATE|DELETE/);
  assert.equal((source.match(/INSERT INTO/g)||[]).length,1);
  assert.match(source,/INSERT INTO whatsapp_events/);
});

// The real webhook route: the command is reached only with EXECUTIVE_WHATSAPP=true, right after „Status“/„Weiter“ and
// before every other stage; without the switch the message continues through the unchanged chain.
async function webhook(t,switchValue){
  const db=await pgliteDatabase();
  const env={WHATSAPP_PHONE_NUMBER_ID:'123456',META_APP_SECRET:'local-webhook-test',WHATSAPP_APPROVER_WA_ID:OPERATOR,EXECUTIVE_WHATSAPP:switchValue};
  const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  t.after(async()=>{for(const k of Object.keys(env)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await db.close();});
  const calls={executive:0,imageReply:0};
  const route=loadRoute('app/api/whatsapp/webhook/route.ts',{
    'next/server':{after:()=>{}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/production/repository':{productionRepository:()=>require('../.test-build/lib/production/repository').productionRepository(db)},
    '@/lib/whatsapp/client':{...require('../.test-build/lib/whatsapp/client'),sendWhatsAppText:async()=>{throw new Error('unexpected send');}},
    '@/lib/daily/draft':{createDailyDraft:async()=>{throw new Error('unexpected');},sendDailyApproval:async()=>{throw new Error('unexpected');},sendPendingDailyApprovals:async()=>0},
    '@/lib/automation/continue':{continuePendingReels:async()=>({considered:0,advanced:0,blocked:0}),recoverRunwayPreflightIncident:async()=>0,latestInstagramReelStatus:async()=>''},
    '@/lib/whatsapp/executive-status':{handleExecutiveStatus:async()=>{calls.executive++;return true;}},
    // First stage after the command: consumes the message so the rest of the chain does not run in this test.
    '@/lib/whatsapp/image-quality-reply':{handleImageQualityReply:async()=>{calls.imageReply++;return true;}},
  });
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456'},
    messages:[{id:`wamid.${crypto.randomUUID()}`,from:OPERATOR,type:'text',text:{body:'Executive'}}]}}]}]});
  const response=await route.POST(new Request('https://local.test/api/whatsapp/webhook',{method:'POST',
    headers:{'x-hub-signature-256':`sha256=${createHmac('sha256','local-webhook-test').update(body).digest('hex')}`},body}));
  assert.equal(response.status,200);
  return calls;
}

test('webhook: without the switch (or with any value other than "true") the command path is never reached (AC-5)',async t=>{
  for(const value of [undefined,'1','TRUE'])assert.deepEqual(await webhook(t,value),{executive:0,imageReply:1},String(value));
});

test('webhook: with EXECUTIVE_WHATSAPP=true the command answers before the image-stop replies and the router (AC-6)',async t=>{
  assert.deepEqual(await webhook(t,'true'),{executive:1,imageReply:0});
  const source=fs.readFileSync('app/api/whatsapp/webhook/route.ts','utf8');
  const at=name=>source.indexOf(name);
  assert.ok(at('/^(status|weiter)[.!?]*$/i.test(message.body.trim())\n')<at('handleExecutiveStatus({'));
  assert.ok(at('handleExecutiveStatus({')<at('await handleImageQualityReply('));
  assert.ok(at('handleExecutiveStatus({')<at('routeOperatorMessage({'));
});

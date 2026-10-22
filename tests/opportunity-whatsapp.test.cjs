const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createHmac}=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const loadRoute=require('./helpers/load-route.cjs');
const O=require('../.test-build/lib/whatsapp/opportunity-check');

const OPERATOR='491701234567';
async function withEnv(values,fn){const old={};for(const k of Object.keys(values)){old[k]=process.env[k];if(values[k]===undefined)delete process.env[k];else process.env[k]=values[k];}
  try{return await fn();}finally{for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}}
const msg=(body,extra={})=>({id:`wamid.${crypto.randomUUID()}`,from:OPERATOR,body,replyToMessageId:null,payload:{},...extra});
// Fake research: no network, no cost.
const SEARCH=async()=>[{title:'Marktbericht',url:'https://example.org/markt',content:'Text'}];
const MODEL=async()=>({criteria:[
  {criterion:'competition',kind:'fact',confidence:0.7,sources:[{reference:'https://example.org/markt'}],value:{type:'scale',level:3},score:3},
  {criterion:'marketPotential',kind:'fact',confidence:0.9,sources:[{reference:'https://erfunden.example'}],value:{type:'text',text:'groß'},score:5},
]});
function harness(db,extra={}){
  const sent=[],deferred=[];
  const deps={database:()=>db,send:async t=>{sent.push(t);return 'wamid.out';},defer:work=>deferred.push(work),now:()=>new Date('2026-10-21T10:00:00Z'),
    search:SEARCH,model:MODEL,...extra};
  return {sent,deferred,deps,flush:async()=>{while(deferred.length)await deferred.shift()();}};
}

test('the command is parsed strictly: title on the first line, summary after it (AC-1)',()=>{
  assert.deepEqual(O.parseOpportunityCommand('Geschäftsidee prüfen: Smarte Kräutertöpfe'),{title:'Smarte Kräutertöpfe',summary:''});
  assert.deepEqual(O.parseOpportunityCommand('geschaeftsidee pruefen – Abo für Gartenpflege\nRegional, nur Frühling bis Herbst'),
    {title:'Abo für Gartenpflege',summary:'Regional, nur Frühling bis Herbst'});
  assert.equal(O.parseOpportunityCommand(`Geschäftsidee prüfen: ${'x'.repeat(300)}`).title.length,200);
  for(const body of ['Geschäftsidee prüfen','Geschäftsidee prüfen: ab','Bitte Geschäftsidee prüfen: X','Geschäftsidee: Kräuter','Status','Freigeben'])
    assert.equal(O.parseOpportunityCommand(body),null,body);
  assert.equal(O.dailyLimit(undefined),3);
  for(const [value,expected] of [['5',5],['10',10],['11',3],['0',3],['-1',3],['abc',3],['2.5',3]])assert.equal(O.dailyLimit(value),expected,value);
});

test('only the operator, once per message, at most the daily limit per Berlin day (AC-2)',async()=>{
  const db=await pgliteDatabase();
  await withEnv({WHATSAPP_APPROVER_WA_ID:OPERATOR,OPPORTUNITY_DAILY_LIMIT:'2'},async()=>{
    const h=harness(db);
    assert.equal(await O.handleOpportunityCheck(msg('Geschäftsidee prüfen: Fremd',{from:'49999'}),h.deps),false);
    assert.equal(await O.handleOpportunityCheck(msg('Hallo'),h.deps),false);
    const first=msg('Geschäftsidee prüfen: Idee eins');
    assert.equal(await O.handleOpportunityCheck(first,h.deps),true);
    assert.equal(await O.handleOpportunityCheck(first,h.deps),true);   // redelivery
    assert.equal(await O.handleOpportunityCheck(msg('Geschäftsidee prüfen: Idee zwei'),h.deps),true);
    assert.equal(await O.handleOpportunityCheck(msg('Geschäftsidee prüfen: Idee drei'),h.deps),true);
    assert.equal(h.sent.length,3);
    assert.match(h.sent[2],/^Tageslimit für Geschäftsideen erreicht \(2 pro Tag\)\. „Idee drei“ wurde nicht geprüft/);
    assert.equal(h.deferred.length,2,'research only for the two accepted ideas');
    // Next Berlin day (00:30 Berlin = 22:30 UTC the evening before): allowed again.
    const tomorrow=harness(db,{now:()=>new Date('2026-10-21T22:30:00Z')});
    assert.equal(await O.handleOpportunityCheck(msg('Geschäftsidee prüfen: Idee vier'),tomorrow.deps),true);
    assert.match(tomorrow.sent[0],/^Geschäftsidee angenommen: „Idee vier“/);
  });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM opportunities")).rows[0].n,3);
  await db.close();
});

test('accepted idea: acknowledgement first, then bounded research and a stored assessment; the answer is no approval (AC-3)',async()=>{
  const db=await pgliteDatabase();let searches=0,models=0;
  await withEnv({WHATSAPP_APPROVER_WA_ID:OPERATOR,OPPORTUNITY_DAILY_LIMIT:undefined},async()=>{
    const h=harness(db,{search:async(...a)=>{searches++;return SEARCH(...a);},model:async(...a)=>{models++;return MODEL(...a);}});
    const m=msg('Geschäftsidee prüfen: Smarte Kräutertöpfe\nFür Stadtwohnungen');
    assert.equal(await O.handleOpportunityCheck(m,h.deps),true);
    assert.equal(h.sent.length,1);
    assert.match(h.sent[0],/^Geschäftsidee angenommen: „Smarte Kräutertöpfe“\. Recherche läuft \(höchstens 3 Websuchen, 1 Modellaufruf\)/);
    assert.equal(searches+models,0,'nothing paid before the webhook has answered');
    await h.flush();
    assert.deepEqual([searches,models],[3,1]);
    const result=h.sent[1];
    assert.match(result,/^Geschäftsidee „Smarte Kräutertöpfe“ – Bewertung \(Vorlage, kein Auftrag\)/);
    assert.match(result,/– Wettbewerb: 3\/5 \(Konfidenz 70 %\)/);
    assert.match(result,/– Marktpotenzial: verworfen \(Fakt ohne Quelle\)/);
    assert.match(result,/– Zielgruppe: keine belastbare Angabe/);
    assert.match(result,/Gesamt: unbekannt – Gewichte fehlen \(Betreiberentscheidung Q-07\)/);
    assert.match(result,/Empfehlung: keine Empfehlung möglich/);
    assert.match(result,/Es wurde nichts gestartet, gekauft oder veröffentlicht/);
    // No reply hint that is itself a command („Weiter“ resumes approved daily publications, „Status“ …).
    assert.doesNotMatch(result,/\b(Weiter|Status|Freigeben|Ablehnen|Executive)\b/);
    assert.ok(result.length<=4000);
    const row=(await db.query(`SELECT o.status,o.summary,a.created_by,a.model_calls,a.recommendation,a.test_recommended,a.research
      FROM opportunities o JOIN opportunity_assessments a ON a.opportunity_id=o.id WHERE o.source_message_id=$1`,[m.id])).rows[0];
    assert.deepEqual([row.status,row.summary,row.created_by,row.model_calls,row.recommendation,row.test_recommended],
      ['assessed','Für Stadtwohnungen','operator',1,'blocked',false]);
    assert.deepEqual(row.research,[{reference:'https://example.org/markt',note:'Marktbericht'}]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM enterprise_decisions')).rows[0].n,0,'no decision request, no approval');
  });
  await db.close();
});

test('a failed research hands the idea back and says so; nothing is stored as assessed (AC-4)',async()=>{
  const db=await pgliteDatabase();
  await withEnv({WHATSAPP_APPROVER_WA_ID:OPERATOR},async()=>{
    for(const [extra,pattern] of [[{model:async()=>{throw new Error('timeout');}},/Recherche nicht möglich \(Modellantwort nicht verfügbar\)/],
      [{search:async()=>[]},/Recherche nicht möglich \(keine Suchergebnisse\)/]]){
      const h=harness(db,extra);const m=msg(`Geschäftsidee prüfen: Idee ${crypto.randomUUID().slice(0,4)}`);
      await O.handleOpportunityCheck(m,h.deps);await h.flush();
      assert.match(h.sent[1],pattern);assert.match(h.sent[1],/Nichts bewertet, nichts gestartet\./);
      assert.equal((await db.query('SELECT status FROM opportunities WHERE source_message_id=$1',[m.id])).rows[0].status,'proposed');
    }
    // A store failure after the research: handed back, generic message, no exception escapes the deferred work.
    const broken=harness(db);const m=msg('Geschäftsidee prüfen: Idee kaputt');
    await O.handleOpportunityCheck(m,broken.deps);
    await db.query('ALTER TABLE opportunity_assessments RENAME TO opportunity_assessments_off');   // test-only: simulates a storage failure
    await broken.flush();
    await db.query('ALTER TABLE opportunity_assessments_off RENAME TO opportunity_assessments');
    assert.match(broken.sent[1],/Prüfung fehlgeschlagen\. Nichts bewertet, nichts gestartet\./);
    assert.equal((await db.query('SELECT status FROM opportunities WHERE source_message_id=$1',[m.id])).rows[0].status,'proposed');
  });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM opportunity_assessments')).rows[0].n,0);
  await db.close();
});

// The real webhook route: the trigger is reached only with OPPORTUNITY_SCOUT_ENABLED=true and before the image-stop replies.
async function webhook(t,switchValue){
  const db=await pgliteDatabase();
  const env={WHATSAPP_PHONE_NUMBER_ID:'123456',META_APP_SECRET:'local-webhook-test',WHATSAPP_APPROVER_WA_ID:OPERATOR,OPPORTUNITY_SCOUT_ENABLED:switchValue,EXECUTIVE_WHATSAPP:undefined};
  const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  t.after(async()=>{for(const k of Object.keys(env)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await db.close();});
  const calls={opportunity:0,imageReply:0,deferred:0};
  const route=loadRoute('app/api/whatsapp/webhook/route.ts',{
    'next/server':{after:()=>{calls.deferred++;}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/production/repository':{productionRepository:()=>require('../.test-build/lib/production/repository').productionRepository(db)},
    '@/lib/whatsapp/client':{...require('../.test-build/lib/whatsapp/client'),sendWhatsAppText:async()=>{throw new Error('unexpected send');}},
    '@/lib/daily/draft':{createDailyDraft:async()=>{throw new Error('unexpected');},sendDailyApproval:async()=>{throw new Error('unexpected');},sendPendingDailyApprovals:async()=>0},
    '@/lib/automation/continue':{continuePendingReels:async()=>({considered:0,advanced:0,blocked:0}),recoverRunwayPreflightIncident:async()=>0,latestInstagramReelStatus:async()=>''},
    '@/lib/whatsapp/opportunity-check':{handleOpportunityCheck:async(message,deps)=>{calls.opportunity++;assert.equal(typeof deps.defer,'function');return true;}},
    '@/lib/whatsapp/image-quality-reply':{handleImageQualityReply:async()=>{calls.imageReply++;return true;}},
  });
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456'},
    messages:[{id:`wamid.${crypto.randomUUID()}`,from:OPERATOR,type:'text',text:{body:'Geschäftsidee prüfen: Test'}}]}}]}]});
  const response=await route.POST(new Request('https://local.test/api/whatsapp/webhook',{method:'POST',
    headers:{'x-hub-signature-256':`sha256=${createHmac('sha256','local-webhook-test').update(body).digest('hex')}`},body}));
  assert.equal(response.status,200);
  return {opportunity:calls.opportunity,imageReply:calls.imageReply};
}

test('webhook: without the switch the trigger is never reached (AC-5)',async t=>{
  for(const value of [undefined,'1','TRUE'])assert.deepEqual(await webhook(t,value),{opportunity:0,imageReply:1},String(value));
});

test('webhook: with OPPORTUNITY_SCOUT_ENABLED=true the trigger runs after „Executive“ and before every other stage (AC-6)',async t=>{
  assert.deepEqual(await webhook(t,'true'),{opportunity:1,imageReply:0});
  const source=fs.readFileSync('app/api/whatsapp/webhook/route.ts','utf8');
  const at=name=>source.indexOf(name);
  assert.ok(at('handleExecutiveStatus({')<at('handleOpportunityCheck({'));
  assert.ok(at('handleOpportunityCheck({')<at('await handleImageQualityReply('));
  assert.ok(at('handleOpportunityCheck({')<at('routeOperatorMessage({'));
  assert.match(source,/defer: work => after\(work\)/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const C=require('../.test-build/lib/enterprise/contract');

const LIMITS={maxSteps:10,maxDepth:4,budgetCents:10000};
const META={messageId:'msg_1',correlationId:'cor_1',from:'executive',idempotencyKey:'controlling.monthly_close:2026-11',createdAt:'2026-11-01T07:00:00Z'};
const step=(id,department,taskKind,extra={})=>({id,department,taskKind,dependsOn:[],maxCostCents:0,maxModelCalls:0,...extra});
const valid=steps=>{const result=validatePlan({goal:'x',steps,expectedValue:null,costCapCents:5000},LIMITS);assert.equal(result.ok,true,result.violations.join('|'));return result;};
const envelopeFor=(department,taskKind,extra)=>{
  const result=valid([step('s',department,taskKind,extra)]);
  const built=C.envelopeFromStep(result.executable[0],META);
  assert.equal(built.ok,true,built.reason);return built.envelope;
};

test('only executable steps become task envelopes; level and handler come from the registry (AC-1)',()=>{
  const envelope=envelopeFor('opportunity','opportunity.research',{maxCostCents:300,maxModelCalls:2});
  assert.deepEqual({to:envelope.to,taskKind:envelope.taskKind,handlerId:envelope.handlerId,permissionLevel:envelope.permissionLevel,budget:envelope.budget,kind:envelope.kind,schemaVersion:envelope.schemaVersion},
    {to:'opportunity',taskKind:'opportunity.research',handlerId:'opportunity.research',permissionLevel:'L1',budget:{maxModelCalls:2,maxCostCents:300,deadline:null},kind:'task.request',schemaVersion:1});
  const decision=valid([step('p','affiliate','affiliate.publication_request')]).decisionRequests[0];
  assert.match(C.envelopeFromStep(decision,META).reason,/nie ausführbar/);
  const tampered={...valid([step('s','controlling','controlling.monthly_close')]).executable[0],handlerId:'affiliate.publicationRequest'};
  assert.match(C.envelopeFromStep(tampered,META).reason,/passt nicht mehr zum Register/);
  assert.equal(C.envelopeFromStep(valid([step('s','controlling','controlling.monthly_close')]).executable[0],{...META,createdAt:'gestern'}).ok,false);
});

test('received envelopes are re-checked against schema, registry and level (AC-2)',()=>{
  const envelope=envelopeFor('controlling','controlling.monthly_close');
  assert.equal(C.checkEnvelope(envelope).ok,true);
  assert.match(C.checkEnvelope({...envelope,permissionLevel:'L2'}).reason,/widerspricht der Registerstufe L0/);
  assert.match(C.checkEnvelope({...envelope,handlerId:'controlling.costAnalysis'}).reason,/Handler passt nicht/);
  assert.match(C.checkEnvelope({...envelope,taskKind:'affiliate.publication_request'}).reason,/nicht erlaubt/);
  assert.match(C.checkEnvelope({...envelope,to:'affiliate',taskKind:'affiliate.publication_request',handlerId:'affiliate.publicationRequest',permissionLevel:'L3b'}).reason,/nie als Aufgabe ausführbar/);
  assert.equal(C.checkEnvelope({...envelope,to:'marketing'}).ok,false);
  assert.equal(C.checkEnvelope({...envelope,budget:{...envelope.budget,maxCostCents:-1}}).ok,false);
  assert.equal(C.checkEnvelope(null).ok,false);
  const reg=JSON.parse(JSON.stringify(require('../.test-build/lib/enterprise/registry').REGISTRY));reg.controlling.tasks['controlling.write']={action:'write_note',handlerId:'controlling.write'};
  assert.match(C.checkEnvelope({...envelope,taskKind:'controlling.write',handlerId:'controlling.write',permissionLevel:'L2'},reg).reason,/über der Obergrenze L1/);
});

test('results must parse, stay within budget and cite facts (AC-3)',()=>{
  const envelope=envelopeFor('opportunity','opportunity.research',{maxCostCents:300,maxModelCalls:2});
  const ok={status:'succeeded',output:{summary:'drei Kandidaten'},usedCostCents:120,usedModelCalls:1,evidence:[{claim:'Nachfrage steigt',kind:'fact',source:'https://example.org/q3'}]};
  assert.equal(C.checkResult(ok,envelope).ok,true);
  assert.match(C.checkResult({...ok,usedCostCents:301},envelope).reason,/Kosten 301 > Budget 300/);
  assert.match(C.checkResult({...ok,usedModelCalls:3},envelope).reason,/Modellaufrufe 3 > Budget 2/);
  assert.match(C.checkResult({...ok,evidence:[{claim:'Nachfrage steigt',kind:'fact'}]},envelope).reason,/Fakt ohne Quelle/);
  const failed={status:'failed',failureClass:'outcome_unknown',reason:'Anbieterantwort unklar',usedCostCents:300,usedModelCalls:2};
  assert.equal(C.checkResult(failed,envelope).ok,true);
  assert.equal(C.checkResult({...failed,failureClass:'flaky'},envelope).ok,false);
  assert.equal(C.checkResult({status:'done'},envelope).ok,false);
});

test('health reports belong to the right department and "ok" needs evidence (AC-4)',()=>{
  const report={department:'affiliate',status:'ok',checkedAt:'2026-11-01T07:00:00Z',evidence:[{label:'letzter Tageslauf',value:'2026-11-01',source:'daily_slot_runs'}]};
  assert.equal(C.checkHealth(report,'affiliate').ok,true);
  assert.match(C.checkHealth(report,'controlling').reason,/statt controlling/);
  assert.match(C.checkHealth({...report,evidence:[]},'affiliate').reason,/ohne Nachweis/);
  assert.equal(C.checkHealth({...report,status:'unknown',evidence:[],reason:'keine Datenbank'},'affiliate').ok,true);
  assert.equal(C.checkHealth({...report,status:'fine'},'affiliate').ok,false);
});

test('departments get named read views, never a database handle (AC-5)',async()=>{
  const calls=[];
  const read=C.createReadCapability('affiliate',{daily_runs:async params=>{calls.push(params);return [{day:'2026-11-01'}];}});
  assert.deepEqual(await read('daily_runs',{days:7}),[{day:'2026-11-01'}]);
  assert.deepEqual(calls,[{days:7}]);
  await assert.rejects(read('content_jobs'),C.CapabilityError);
  await assert.rejects(read('toString'),C.CapabilityError);
  await assert.rejects(read('__proto__'),C.CapabilityError);
});

test('contract module is isolated: only zod and kernel modules, not used by app code (AC-6)',()=>{
  const source=fs.readFileSync('lib/enterprise/contract.ts','utf8');
  for(const match of source.matchAll(/from\s+"([^"]+)"/g))assert.ok(['zod','./policy','./registry','./plan'].includes(match[1]),match[1]);
  assert.doesNotMatch(source,/fetch\(|process\.env|getDatabase|Date\.now|new Date/);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/enterprise\/contract/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');
  assert.deepEqual(users,[]);
});

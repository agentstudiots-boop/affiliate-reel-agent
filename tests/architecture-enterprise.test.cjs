const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const loadRoute=require('./helpers/load-route.cjs');
const {withEnv}=require('./helpers/live-env.cjs');
const {buildEnterpriseView,enterpriseViewSchema}=require('../.test-build/lib/architecture/enterprise');
const {readEnterpriseView}=require('../.test-build/lib/architecture/enterprise-snapshot');
const {NonProductionEffectError}=require('../.test-build/lib/security/runtime-guard');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const {DEPARTMENT_IDS}=require('../.test-build/lib/enterprise/registry');
const R=require('../.test-build/lib/enterprise/tasks/repository');
const D=require('../.test-build/lib/enterprise/decisions');

const NOW=new Date('2026-11-15T12:00:00Z');
const LIMITS={maxSteps:5,maxDepth:3,budgetCents:10_000};
const dept=(view,id)=>view.departments.find(d=>d.id===id);
const health=(department,status='ok')=>({department,status,checkedAt:NOW.toISOString(),evidence:[{label:'x',value:1,source:'daily_slot_runs'}]});
let counter=0;
async function enqueue(db,department,taskKind){
  const plan=validatePlan({goal:'x',steps:[{id:'s',department,taskKind,dependsOn:[],maxCostCents:0,maxModelCalls:0}],expectedValue:null,costCapCents:0},LIMITS);
  const built=envelopeFromStep(plan.executable[0],{messageId:`m${++counter}`,correlationId:'c',from:'executive',idempotencyKey:`k${counter}`,createdAt:new Date().toISOString()});
  return (await R.enqueueTask(db,{envelope:built.envelope,createdBy:'executive'})).id;
}
const publishStep=()=>validatePlan({goal:'x',steps:[{id:'s',department:'affiliate',taskKind:'affiliate.publication_request',dependsOn:[],maxCostCents:0,maxModelCalls:0}],
  expectedValue:null,costCapCents:0},LIMITS).decisionRequests[0];

test('no evidence: every register department is listed, every part null, nothing invented (AC-1)',()=>{
  const view=buildEnterpriseView({now:NOW,health:null,tasks:null,decisions:null,controlling:null,unavailableReason:'Test'});
  assert.equal(enterpriseViewSchema.safeParse(view).success,true);
  assert.deepEqual(view.departments.map(d=>d.id),[...DEPARTMENT_IDS]);
  assert.deepEqual([view.available,view.reason],[false,'Test']);
  assert.deepEqual(view.parts,{health:'unavailable',tasks:'unavailable',decisions:'unavailable',controlling:'unavailable'});
  for(const d of view.departments)assert.deepEqual([d.module,d.health,d.tasks,d.decisions,d.controlling],['none',null,null,null,null],d.id);
  assert.deepEqual(dept(view,'engineering'),{...dept(view,'engineering'),runtime:false,taskKinds:[]});
});

test('counts per department from the ledger; unknown departments listed separately, never reassigned (AC-2)',()=>{
  const view=buildEnterpriseView({now:NOW,health:{affiliate:health('affiliate','degraded')},
    tasks:[{department:'affiliate',status:'succeeded',count:3,lastAt:'2026-11-14T08:00:00.000Z'},{department:'affiliate',status:'failed',count:1,lastAt:'2026-11-15T09:00:00.000Z'},
      {department:'ghost',status:'queued',count:2,lastAt:null}],
    decisions:[{department:'affiliate',pending:2,nextExpiry:'2026-11-16T08:00:00.000Z'},{department:'ghost',pending:1,nextExpiry:null}],
    controlling:null});
  const a=dept(view,'affiliate');
  assert.deepEqual(a.tasks,{total:4,byStatus:{succeeded:3,failed:1},lastActivityAt:'2026-11-15T09:00:00.000Z'});
  assert.deepEqual(a.decisions,{pending:2,nextExpiry:'2026-11-16T08:00:00.000Z'});
  assert.deepEqual(dept(view,'controlling').tasks,{total:0,byStatus:{},lastActivityAt:null},'readable ledger without rows = real zero');
  assert.deepEqual(view.unknownDepartments,[{department:'ghost',tasks:2,pendingDecisions:1}]);
  assert.deepEqual([a.module,a.health.status,dept(view,'controlling').module],['connected','degraded','none']);
  assert.ok(a.agents.includes('content_text'),'agents come from the reviewed register mapping (E-06)');
  assert.deepEqual(view.parts,{health:'ok',tasks:'ok',decisions:'ok',controlling:'unavailable'});
});

test('a connected department whose report is unreadable shows no health instead of a guess (AC-3)',()=>{
  const view=buildEnterpriseView({now:NOW,health:{affiliate:null},tasks:null,decisions:null,controlling:null});
  assert.deepEqual([dept(view,'affiliate').module,dept(view,'affiliate').health,view.parts.health,view.available],['connected',null,'unavailable',false]);
});

test('preview/development: the runtime guard blocks the database and the view says so (AC-4)',async()=>{
  const view=await readEnterpriseView(NOW,()=>{throw new NonProductionEffectError('database');});
  assert.equal(view.available,false);
  assert.match(view.reason,/Runtime-Guard/);
});

test('an unexpected error leaves the enterprise level empty instead of breaking the Command Center (review #102)',async()=>{
  const broken={get affiliate(){throw new Error('kaputt');}};
  const view=await readEnterpriseView(NOW,()=>({}),broken);
  assert.deepEqual([view.available,view.parts.health,view.departments.length>0],[false,'unavailable',true]);
  assert.match(view.reason,/unerwarteter Fehler/);
});

test('migrated database: real counts, affiliate health from the adapter, controlling line attached (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const now=new Date();
  const empty=await readEnterpriseView(now,()=>db);
  assert.deepEqual(empty.parts,{health:'ok',tasks:'ok',decisions:'ok',controlling:'ok'});
  assert.deepEqual(dept(empty,'affiliate').tasks,{total:0,byStatus:{},lastActivityAt:null});
  assert.equal(dept(empty,'affiliate').health.status,'unknown','no cron evidence ⇒ unknown, never ok');
  assert.equal(dept(empty,'affiliate').controlling.department,'affiliate');
  await enqueue(db,'affiliate','affiliate.status_report');await enqueue(db,'controlling','controlling.monthly_close');
  await D.requestDecision(db,{step:publishStep(),subjectKey:'affiliate:post:7',subject:'Beitrag 7 veröffentlichen',options:[{id:'yes',label:'Freigeben'},{id:'no',label:'Ablehnen'}]});
  const view=await readEnterpriseView(now,()=>db);
  assert.equal(enterpriseViewSchema.safeParse(view).success,true);
  assert.deepEqual(dept(view,'affiliate').tasks.byStatus,{queued:1});
  assert.deepEqual(dept(view,'controlling').tasks.byStatus,{queued:1});
  assert.equal(dept(view,'affiliate').decisions.pending,1);
  const later=await readEnterpriseView(new Date(Date.now()+400*24*3600*1000),()=>db);
  assert.equal(dept(later,'affiliate').decisions.pending,0,'expired requests are not shown as open');
  await db.close();
});

test('reads only: every statement is SET TRANSACTION READ ONLY or SELECT/WITH, also inside the adapter (AC-6)',async()=>{
  const db=await pgliteDatabase();
  const statements=[];
  const spy=sql=>({query:(text,values)=>{statements.push(text.trim().split(/\s+/).slice(0,3).join(' '));return sql.query(text,values);},exec:text=>{statements.push(`EXEC ${text}`);return sql.exec(text);}});
  const watched={...spy(db),transaction:fn=>db.transaction(sql=>fn(spy(sql)))};
  await readEnterpriseView(new Date(),()=>watched);
  assert.ok(statements.length>5);
  for(const s of statements)assert.match(s,/^(SET TRANSACTION READ|SELECT|WITH)\b/,s);
  await db.close();
});

test('missing ledger tables make their part unavailable instead of zero (AC-7)',async()=>{
  const fake={query:async()=>({rows:[]}),exec:async()=>{},transaction:async fn=>fn({query:async text=>({rows:/to_regclass/.test(text)?[{ok:false}]:[]}),exec:async()=>{}})};
  const view=await readEnterpriseView(NOW,()=>fake,{});
  assert.deepEqual(view.parts,{health:'unavailable',tasks:'unavailable',decisions:'unavailable',controlling:'ok'});
  assert.equal(dept(view,'affiliate').tasks,null);
  assert.equal(view.controlling.parts.costs,'unavailable');
});

test('API: operator-protected, carries the enterprise level, no secret value; only lib/architecture reads it (AC-8)',async()=>{
  const restore=withEnv({CONTENT_STUDIO_PASSWORD:'right-code-123',REPLICATE_API_TOKEN:'r8_SECRET-VALUE-123',VERCEL_ENV:undefined,VERCEL:undefined});
  try{
    const enterprise=buildEnterpriseView({now:NOW,health:null,tasks:null,decisions:null,controlling:null});
    const route=loadRoute('app/api/architecture/route.ts',{
      '@/lib/architecture/snapshot':{readSnapshot:async()=>({available:false,reason:'test',generatedAt:NOW.toISOString(),topic:null,affiliate:null,publications:null,chances:null,vision:null,visualJobs:null,activity:null})},
      '@/lib/architecture/enterprise-snapshot':{readEnterpriseView:async()=>enterprise}});
    assert.equal((await route.GET(new Request('http://localhost/api/architecture'))).status,401);
    const ok=await route.GET(new Request('http://localhost/api/architecture',{headers:{'x-content-password':'right-code-123'}}));
    const text=await ok.text();
    assert.ok(!text.includes('SECRET-VALUE-123')&&!text.includes('right-code-123'));
    assert.deepEqual(JSON.parse(text).enterprise,enterprise);
  }finally{restore();}
  for(const file of ['lib/architecture/enterprise.ts','lib/architecture/enterprise-snapshot.ts']){
    const source=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b|process\.env|fetch\(|\.handle\(|enqueueTask|recordDecision|requestDecision/,file);
  }
});

// ---------- H-04/H-05: 2D view of the enterprise level ----------
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {EnterprisePanel,moneyText}=require('../.test-build/app/architecture/enterprise-panel');
const html=(view,initial)=>renderToStaticMarkup(React.createElement(EnterprisePanel,{view,initial}));

test('2D view: every department as a keyboard-reachable card; without evidence it says "keine Daten" (AC-9)',()=>{
  const empty=buildEnterpriseView({now:NOW,health:null,tasks:null,decisions:null,controlling:null,unavailableReason:'Preview/Entwicklung: Datenbankzugriff durch den Runtime-Guard gesperrt'});
  const out=html(empty);
  for(const d of empty.departments)assert.ok(out.includes(`<b>${d.label}</b>`),d.label);
  assert.equal((out.match(/<button type="button" class="ccCard"/g)||[]).length,empty.departments.length);
  assert.match(out,/Runtime-Guard gesperrt/);
  assert.match(out,/Aufgaben: keine Daten/);
  assert.match(out,/nicht angeschlossen/);
  assert.doesNotMatch(out,/In Ordnung|0,00/,'nothing invented');
  assert.match(html(undefined),/noch nicht geliefert/);
});

test('2D detail panel: health with sources, task counts, open decisions, costs as lower bound, agents (AC-10)',()=>{
  const controlling={contractVersion:1,currency:'EUR',period:'2026-11',generatedAt:NOW.toISOString(),parts:{modelUsage:'ok',costs:'ok',revenue:'ok'},
    departments:DEPARTMENT_IDS.map(department=>({department,modelUsage:{calls:department==='affiliate'?7:0,failures:0,inputTokens:0,outputTokens:0,predictTimeS:0,usageComplete:true,models:[]},
      costs:{measured:{amountCents:department==='affiliate'?120:null,entries:department==='affiliate'?3:0,unknownAmountEntries:department==='affiliate'?1:0,complete:department!=='affiliate'},
        estimated:{amountCents:null,entries:0,unknownAmountEntries:0,complete:true},forecast:{amountCents:null,entries:0,unknownAmountEntries:0,complete:true}},
      revenue:{measured:{amountCents:null,entries:0,unknownAmountEntries:0,complete:true},estimated:{amountCents:null,entries:0,unknownAmountEntries:0,complete:true},forecast:{amountCents:null,entries:0,unknownAmountEntries:0,complete:true}}})),
    unassigned:{modelUsage:null,costs:null,revenue:null},sources:[]};
  const view=buildEnterpriseView({now:NOW,health:{affiliate:{...health('affiliate','degraded'),reason:'letzte Freigabeanfrage nicht beim Betreiber angekommen'}},
    tasks:[{department:'affiliate',status:'succeeded',count:2,lastAt:NOW.toISOString()},{department:'affiliate',status:'queued',count:1,lastAt:NOW.toISOString()}],
    decisions:[{department:'affiliate',pending:1,nextExpiry:'2026-11-16T08:00:00.000Z'}],controlling});
  const out=html(view,'affiliate');
  assert.match(out,/data-testid="cc-enterprise-detail"/);
  assert.match(out,/Eingeschränkt/);
  assert.match(out,/letzte Freigabeanfrage nicht beim Betreiber angekommen/);
  assert.match(out,/x: <b>1<\/b> <small class="muted">· Quelle: daily_slot_runs<\/small>/,'every evidence value names its source');
  assert.match(out,/erledigt: <b>2<\/b>/);
  assert.match(out,/wartend: <b>1<\/b>/);
  assert.match(out,/offen: <b>1<\/b>/);
  assert.match(out,/Kosten gemessen: <b>mind\.\s1,20\s€<\/b>/);
  assert.match(out,/Modellaufrufe: <b>7<\/b>/);
  assert.match(out,/<code>content_text<\/code>/);
  assert.equal(moneyText({amountCents:null,entries:2,unknownAmountEntries:2,complete:false}),'unbekannt');
  assert.equal(moneyText(null),'keine Daten');
  const engineering=html(view,'engineering');
  assert.match(engineering,/arbeitet außerhalb der App/);
});

test('Command Center offers the enterprise view without WebGL and reads nothing itself (AC-11)',()=>{
  const center=fs.readFileSync('app/architecture/command-center.tsx','utf8');
  assert.match(center,/setMode\("enterprise"\)[^]*>Unternehmen<\/button>/);
  // Without WebGL (or without enterprise data) the 2D cards are shown; with WebGL the planets use the same canvas (H-03).
  assert.match(center,/mode === "enterprise" && !planetsShown && <EnterprisePanel view=\{data\.enterprise\} selected=\{department\} onSelect=\{setDepartment\} development=\{data\.development\} \/>/);
  assert.match(center,/const planetsShown = enterprise3d && showScene;/);
  assert.match(center,/const enterprise3d = mode === "enterprise" && !!data\?\.enterprise;/);
  assert.match(center,/mode !== "profiles" && \(mode !== "enterprise" \|\| enterprise3d\), resetToken/,'the scene only runs in the enterprise view when there is data');
  const panel=fs.readFileSync('app/architecture/enterprise-panel.tsx','utf8');
  assert.doesNotMatch(panel,/fetch\(|process\.env|memory\/db/);
  assert.doesNotMatch(panel,/^import \{[^}]*\} from "@\/lib\//m,'no value import from lib/: no server code in the client bundle');
  assert.match(panel,/^import type \{ DepartmentView, EnterpriseView \} from "@\/lib\/architecture\/enterprise";$/m);
});

// ---------- H-03: enterprise level as planets in the 3D scene ----------
const P=require('../.test-build/app/architecture/enterprise-planets');

test('planets: Executive in the centre, the other departments on one orbit, fixed size, state in words (H-03 AC-1)',()=>{
  const view=buildEnterpriseView({now:NOW,health:{affiliate:health('affiliate','degraded')},
    tasks:[{department:'affiliate',status:'succeeded',count:500,lastAt:NOW.toISOString()}],decisions:[{department:'affiliate',pending:2,nextExpiry:null}],controlling:null});
  const planets=P.planets(view);
  assert.deepEqual(planets.map(p=>p.id),view.departments.map(d=>d.id));
  const byId=Object.fromEntries(planets.map(p=>[p.id,p]));
  assert.deepEqual(byId.executive.position,[0,0,0]);
  const ring=planets.filter(p=>p.id!=='executive');
  for(const p of ring)assert.ok(Math.abs(Math.hypot(p.position[0],p.position[2])-P.PLANET_ORBIT)<0.01,p.id);
  assert.equal(new Set(ring.map(p=>p.position.join())).size,ring.length,'no two planets in one place');
  assert.equal(new Set(ring.map(p=>p.radius)).size,1,'size never depends on activity (500 tasks change nothing)');
  assert.equal(byId.affiliate.status,'Eingeschränkt');
  assert.equal(byId.affiliate.pendingDecisions,2);
  assert.match(byId.affiliate.sub,/Eingeschränkt · 2 Entscheidungen offen/);
  assert.equal(byId.affiliate.wireframe,false);
  for(const id of ['executive','controlling','opportunity','engineering']){
    assert.equal(byId[id].wireframe,true,id);
    assert.equal(byId[id].status,'nicht angeschlossen',id);
  }
  assert.match(byId.engineering.plain,/arbeitet außerhalb der App/);
  assert.equal(byId.controlling.pendingDecisions,0);
});

test('planets: without evidence nothing is invented; unreadable report and missing ledger stay visible (H-03 AC-2)',()=>{
  const empty=buildEnterpriseView({now:NOW,health:null,tasks:null,decisions:null,controlling:null});
  for(const p of P.planets(empty)){
    assert.equal(p.pendingDecisions,null,p.id);
    assert.doesNotMatch(p.sub,/In Ordnung|offen/,p.id);
  }
  const unreadable=P.planets(buildEnterpriseView({now:NOW,health:{affiliate:null},tasks:null,decisions:null,controlling:null}));
  assert.equal(unreadable.find(p=>p.id==='affiliate').status,'Bericht nicht lesbar');
  assert.deepEqual(P.planets(undefined),[]);
});

test('planets: camera goals keep the orbit in view and look at a planet from outside (H-03 AC-3)',()=>{
  for(const aspect of [0.5,1,1.8]){
    const goal=P.enterpriseOverviewGoal(aspect);
    const distance=Math.hypot(...goal.position);
    const halfWidth=Math.tan(45*Math.PI/360)*aspect*distance;
    assert.ok(halfWidth>=P.PLANET_ORBIT||distance>=79,`aspect ${aspect}: orbit fits`);
  }
  const position=[P.PLANET_ORBIT,0,0];
  const goal=P.planetGoal(position,1.6);
  assert.deepEqual(goal.target,position);
  assert.ok(goal.position[0]>P.PLANET_ORBIT,'camera outside the orbit');
});

test('2D panel can be controlled by the Command Center; planets module reads nothing (H-03 AC-4)',()=>{
  const view=buildEnterpriseView({now:NOW,health:null,tasks:null,decisions:null,controlling:null});
  const out=renderToStaticMarkup(React.createElement(EnterprisePanel,{view,selected:'engineering',onSelect:()=>{}}));
  assert.match(out,/data-testid="cc-enterprise-detail"/);
  assert.match(out,/arbeitet außerhalb der App/);
  const source=fs.readFileSync('app/architecture/enterprise-planets.ts','utf8');
  assert.deepEqual([...source.matchAll(/^import (type )?\{[^}]*\} from "([^"]+)";$/gm)].map(m=>`${m[1]?'type ':''}${m[2]}`).sort(),
    ['./enterprise-panel','type @/lib/architecture/enterprise']);
  assert.doesNotMatch(source,/fetch\(|process\.env|Date\.now|new Date|Math\.random/);
  const scene=fs.readFileSync('app/architecture/scene.tsx','utf8');
  assert.match(scene,/if \(mode === "enterprise"\) return/);
});

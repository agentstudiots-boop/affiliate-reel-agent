const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {departmentForAgent,allocateModelUsage,MODEL_AGENT_DEPARTMENTS}=require('../.test-build/lib/enterprise/controlling/agent-departments');
const {DEPARTMENT_IDS}=require('../.test-build/lib/enterprise/registry');

const files=[];
const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory()){if(entry.name!=='node_modules')walk(full);}
  else if(/\.(ts|tsx)$/.test(entry.name))files.push(full);
}};
walk('app');walk('lib');
const read=file=>fs.readFileSync(file,'utf8');
const row=(agent,extra={})=>({agent,model:'m',calls:2,failures:1,inputTokens:10,outputTokens:5,predictTimeS:1.25,...extra});

test('only exact agent names are mapped; unknown and inherited names stay unassigned (AC-1)',()=>{
  assert.equal(departmentForAgent('content_text'),'affiliate');
  assert.equal(departmentForAgent('whatsapp_router'),'affiliate');
  for(const name of ['content_new_agent','content','toString','__proto__','constructor','',null,undefined,42])assert.equal(departmentForAgent(name),null,String(name));
  for(const owner of Object.values(MODEL_AGENT_DEPARTMENTS))assert.ok(DEPARTMENT_IDS.includes(owner),owner);
  assert.ok(Object.isFrozen(MODEL_AGENT_DEPARTMENTS));
});

test('every agent name the code records in model_calls is mapped (AC-2)',()=>{
  const recorders=files.filter(file=>/\brecordModelCall\b/.test(read(file))&&!file.startsWith(path.join('lib','observability')));
  // New recording sites must be added here and to MODEL_AGENT_DEPARTMENTS; dynamic names are resolved below.
  assert.deepEqual(recorders.sort(),['lib/content/model.ts','lib/whatsapp/chat.ts','lib/whatsapp/instruction.ts','lib/whatsapp/route-llm.ts','lib/whatsapp/transcribe.ts','lib/whatsapp/video-revision.ts'].map(p=>path.join(...p.split('/'))).sort());
  const names=new Set();
  // lib/content/model.ts records `content_${agent}` for each generate("<agent>", ...) call – also from the topic pipeline
  // (lib/topic-pipeline), which is part of the Content Studio and therefore counts as affiliate. Searched everywhere.
  assert.match(read('lib/content/model.ts'),/agent:`content_\$\{agent\}`/);
  for(const file of files.filter(f=>!f.startsWith(path.join('lib','enterprise')))){
    const source=read(file);
    for(const m of source.matchAll(/\bgenerate\(\s*"([a-z_]+)"/g))names.add(`content_${m[1]}`);
  }
  // routerModelCall records options.agent, default "whatsapp_router".
  const router=read('lib/whatsapp/route-llm.ts');
  const fallback=router.match(/options\.agent \?\? "([a-z_]+)"/);
  assert.ok(fallback,'Standard-Agent von routerModelCall nicht gefunden');names.add(fallback[1]);
  // Whole calls, also across lines; an agent given as a variable could not be checked.
  for(const file of files)for(const call of read(file).matchAll(/\brouterModelCall\(([\s\S]*?)\);/g)){
    for(const m of call[1].matchAll(/\bagent:\s*"([a-z_]+)"/g))names.add(m[1]);
    assert.doesNotMatch(call[1].replace(/\bagent:\s*"[a-z_]+"/g,''),/\bagent\b/,`${file}: routerModelCall mit nicht-literalem Agentennamen`);
  }
  // The other recording sites pass literal agent names.
  for(const file of recorders.filter(f=>!/model\.ts$|route-llm\.ts$/.test(f)))for(const m of read(file).matchAll(/agent: ?"([a-z_]+)"/g))names.add(m[1]);
  assert.ok(names.size>=10,[...names].join(','));
  for(const name of names)assert.equal(departmentForAgent(name)!==null,true,`${name} ist keiner Abteilung zugeordnet`);
  // No stale entries: every mapped name is still recorded somewhere.
  for(const name of Object.keys(MODEL_AGENT_DEPARTMENTS))assert.ok(names.has(name),`${name} wird nicht mehr aufgezeichnet`);
});

test('allocation sums per department, keeps every department visible and lists unassigned agents by name (AC-3)',()=>{
  const result=allocateModelUsage([row('content_text'),row('content_text',{model:'m2'}),row('whatsapp_chat'),row('mystery_agent'),row('mystery_agent')]);
  assert.deepEqual(Object.keys(result.byDepartment).sort(),[...DEPARTMENT_IDS].sort());
  assert.deepEqual(result.byDepartment.affiliate,{calls:6,failures:3,inputTokens:30,outputTokens:15,predictTimeS:3.8,usageComplete:true,models:['m','m2']});
  assert.deepEqual(result.byDepartment.executive,{calls:0,failures:0,inputTokens:0,outputTokens:0,predictTimeS:0,usageComplete:true,models:[]});
  assert.deepEqual([result.unassigned.calls,result.unassigned.agents],[4,['mystery_agent']]);
});

test('missing metrics mark sums as incomplete instead of inventing values (AC-4)',()=>{
  const result=allocateModelUsage([row('content_image',{inputTokens:null,outputTokens:null}),row('content_image',{predictTimeS:-1,calls:Number.NaN})]);
  const totals=result.byDepartment.affiliate;
  assert.equal(totals.usageComplete,false);
  assert.deepEqual([totals.calls,totals.inputTokens,totals.outputTokens,totals.predictTimeS],[2,10,5,1.3]);
  assert.equal(allocateModelUsage([]).unassigned.usageComplete,true);
  // Review #88 nit: invalid call counts are not silently treated as complete.
  assert.equal(allocateModelUsage([row('content_text',{calls:NaN})]).byDepartment.affiliate.usageComplete,false);
  assert.equal(allocateModelUsage([row('content_text',{failures:-1})]).byDepartment.affiliate.usageComplete,false);
});

test('pure module: only the registry is imported, not wired into app code (AC-5)',()=>{
  const source=read('lib/enterprise/controlling/agent-departments.ts');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]),['../registry']);
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|\.query\(/);
  const users=files.filter(file=>!file.startsWith(path.join('lib','enterprise'))&&/enterprise\/controlling\/agent-departments/.test(read(file)));
  // Only the read-only enterprise level of the Command Center (H-01) lists the mapped agents per department.
  assert.deepEqual(users,[path.join('lib','architecture','enterprise.ts')]);
});

// DIAG-MODEL: a rejected editorial answer is classified (invalid_json / schema_violation / provider state) and logged with
// schema paths, codes and limits only – never answer text or values. The new error classes pass through the existing
// evaluations (modelUsage, cost import, department attribution) unchanged.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {z}=require('zod');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {createGenerator}=require('../.test-build/lib/content/model');
const {schemaIssues,schemaKeys,jsonShape,providerState}=require('../.test-build/lib/content/model-diagnostics');
const {setModelCallStore,modelCallSummary}=require('../.test-build/lib/observability/model-calls');
const {importModelCalls}=require('../.test-build/lib/enterprise/controlling/import-model-calls');
const {departmentForAgent,allocateModelUsage}=require('../.test-build/lib/enterprise/controlling/agent-departments');

const SECRET_TEXT='Geheimer Werbetext Zitrone';
const schema=z.object({ summary:z.string().max(20), items:z.array(z.object({ concept:z.string().max(5) }).strict()).max(3) }).strict();
const metrics={input_token_count:900,output_token_count:120,predict_time:2.5};

// One fake Replicate exchange: the POST answers immediately with the given prediction; polls return `polled` in turn.
function provider(prediction,polled=[]){
  return async(url,init)=>{
    if(init&&init.method==='POST')return new Response(JSON.stringify({id:'abcdefghijkl1234',...prediction}),{status:201});
    return new Response(JSON.stringify({id:'abcdefghijkl1234',...(polled.shift()||{status:'failed'})}),{status:200});
  };
}

async function run(prediction,polled){
  const warnings=[],calls=[];
  const warn=console.warn,token=process.env.REPLICATE_API_TOKEN;
  console.warn=line=>warnings.push(String(line));
  process.env.REPLICATE_API_TOKEN='test-token';
  setModelCallStore(async call=>{calls.push(call);});
  try{
    const generate=createGenerator({mode:'ai',request:provider(prediction,polled),minIntervalMs:0});
    await assert.rejects(generate('trend','Test',{},schema,()=>{throw new Error('no reference');}));
  }finally{
    console.warn=warn;setModelCallStore(null);
    if(token===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=token;
  }
  const event=warnings.map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(e=>e&&e.event==='editorial_model_failed');
  return {event,calls,raw:warnings.join('\n')};
}

test('text before the JSON is classified invalid_json; only the shape of the answer is logged',async()=>{
  const {event,calls,raw}=await run({status:'succeeded',output:`${SECRET_TEXT}: {"summary":"x","items":[]}`,metrics});
  assert.equal(event.reason,'invalid_json');
  assert.deepEqual(event.detail.shape,{chars:`${SECRET_TEXT}: {"summary":"x","items":[]}`.length,start:'text',end:'brace'});
  assert.equal(calls[0].errorClass,'invalid_json');
  assert.doesNotMatch(raw,/Zitrone|Werbetext/);
});

test('a schema violation logs at most three schema paths with code and limit, never values or foreign keys',async()=>{
  const answer={summary:SECRET_TEXT,items:[{concept:'ok'},{concept:'Zitronenpresse',Zitronenschluessel:1},{concept:'abc'},{concept:'zu lang'}]};
  const {event,calls,raw}=await run({status:'succeeded',output:JSON.stringify(answer),metrics});
  assert.equal(event.reason,'schema_violation');
  assert.equal(calls[0].errorClass,'schema_violation');
  assert.ok(event.detail.issues.length>=1&&event.detail.issues.length<=3);
  assert.deepEqual(event.detail.issues[0],{path:'summary',code:'too_big',limit:20});
  for(const issue of event.detail.issues)assert.match(issue.path,/^(\(root\)|[A-Za-z_*][A-Za-z0-9_]*|\d+)(\.([A-Za-z_*][A-Za-z0-9_]*|\d+))*$/);
  assert.doesNotMatch(raw,/Zitrone|Werbetext|Zitronenschluessel|Zitronenpresse/);
});

test('schema paths mask keys the schema does not define (e.g. record keys chosen by the model)',()=>{
  const recordSchema=z.object({ byName:z.record(z.string(),z.number().max(1)) });
  const result=recordSchema.safeParse({byName:{[SECRET_TEXT]:5}});
  const issues=schemaIssues(result.error,schemaKeys(recordSchema));
  assert.deepEqual(issues,[{path:'byName.*',code:'too_big',limit:1}]);
  const strict=z.object({a:z.string()}).strict().safeParse({a:'x',[SECRET_TEXT]:1});
  assert.doesNotMatch(JSON.stringify(schemaIssues(strict.error,schemaKeys(z.object({a:z.string()})))),/Zitrone/);
});

test('a provider failure records the last prediction state, polls and waiting time – no prediction id, polling unchanged',async()=>{
  const {event,calls,raw}=await run({status:'starting'},[{status:'failed'}]);
  assert.equal(event.reason,'invalid_provider_result');
  assert.equal(calls[0].errorClass,'invalid_provider_result');
  assert.equal(event.detail.provider.status,'failed');
  assert.equal(event.detail.provider.output,false);
  assert.equal(event.detail.provider.polls,1);
  assert.ok(event.detail.provider.waitedMs>=1000);
  assert.doesNotMatch(raw,/abcdefghijkl1234/);
});

test('helpers never echo answer content',()=>{
  assert.deepEqual(jsonShape('```json\n{"a":1}\n```'),{chars:19,start:'fence',end:'fence'});
  assert.deepEqual(jsonShape('   '),{chars:3,start:'empty',end:'empty'});
  assert.deepEqual(providerState({status:SECRET_TEXT,output:SECRET_TEXT},0,-5),{status:'other',output:true,polls:0,waitedMs:0});
  assert.deepEqual(providerState(null,2,10),{status:'none',output:false,polls:2,waitedMs:10});
});

test('the new error classes pass through modelUsage, the cost import and the department attribution',async()=>{
  const db=await pgliteDatabase();
  const store=call=>db.query(`INSERT INTO model_calls(agent,model,provider,ok,error_class,latency_ms,prediction_id,input_tokens,output_tokens,predict_time_s,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()-interval '5 minutes')`,
    [call.agent,call.model,call.provider??'replicate',call.ok,call.errorClass?.slice(0,60)??null,Math.round(call.latencyMs),call.predictionId??null,call.inputTokens??null,call.outputTokens??null,call.predictTimeS??null]);
  for(const output of [`${SECRET_TEXT} {}`,JSON.stringify({summary:SECRET_TEXT,items:[]})]){
    const token=process.env.REPLICATE_API_TOKEN,warn=console.warn;
    process.env.REPLICATE_API_TOKEN='test-token';console.warn=()=>{};setModelCallStore(store);
    try{await assert.rejects(createGenerator({mode:'ai',request:provider({status:'succeeded',output,metrics}),minIntervalMs:0})('trend','Test',{},schema,()=>null));}
    finally{setModelCallStore(null);console.warn=warn;if(token===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=token;}
  }
  const classes=(await db.query('SELECT error_class FROM model_calls ORDER BY id')).rows.map(r=>r.error_class);
  assert.deepEqual(classes,['invalid_json','schema_violation']);
  const usage=await modelCallSummary(db,7);
  assert.deepEqual(usage.map(r=>[r.agent,r.calls,r.failures,r.inputTokens]),[['content_trend',2,2,1800]]);
  assert.equal(departmentForAgent('content_trend'),'affiliate');
  const allocation=allocateModelUsage(usage);
  assert.equal(allocation.byDepartment.affiliate.failures,2);
  assert.equal(allocation.unassigned.calls,0);
  const imported=await importModelCalls(db,{departmentOf:departmentForAgent});
  assert.equal(imported.calls,2);
  const departments=(await db.query('SELECT DISTINCT department FROM cost_entries')).rows.map(r=>r.department);
  assert.deepEqual(departments,['affiliate']);
  await db.close();
});

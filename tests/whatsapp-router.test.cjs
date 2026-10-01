const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {routeOperatorMessage,isLiteralGate,systemFacts,statusText}=require('../.test-build/lib/whatsapp/router');
const {startProductSearch}=require('../.test-build/lib/whatsapp/start-image-post');
const {RouterUnavailable,routeSchema}=require('../.test-build/lib/whatsapp/route-llm');
const {loadRouteContext}=require('../.test-build/lib/whatsapp/route-context');

const route=(over={})=>({intent:'chitchat',draft_id:null,search_query:null,reject_current:false,operator_note:null,answer:null,clarification_question:null,confidence:0.95,ambiguity:'none',...over});

// A well-behaved model, simulated: sentence -> structured intent. The router itself is what is under test.
const MODEL={
  'Nein, nimm ein anderes Produkt.':()=>route({intent:'search_product',reject_current:true}),
  'Such mir stattdessen eine Silbermatte.':()=>route({intent:'search_product',reject_current:true,search_query:'Silbermatte'}),
  'Das Produkt passt, aber mach das Bild neu.':()=>route({intent:'revise_image'}),
  'Ändere nur den Text.':()=>route({intent:'revise_text'}),
  'Warum hast du das Produkt ausgewählt?':()=>route({intent:'question'}),
  'Was ist gerade noch offen?':()=>route({intent:'status'}),
  'Nimm etwas Ähnliches, aber günstiger.':()=>route({intent:'search_product',reject_current:true,search_query:'Kuscheldecke',operator_note:'Preise kann ich nicht verlässlich vergleichen; ich suche ähnliche Produkte.'}),
  'Mach weiter.':()=>route({intent:'status'}),
  'Nicht veröffentlichen.':()=>route({intent:'reject_current'}),
  'Such was Neues.':()=>route({intent:'search_product'}),
  'Passt so, raus damit.':()=>route({intent:'approve_attempt'}),
};

async function fixture(t,{open=1}={}){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  const asins=['B000000001','B000000002'];const jobs=[];
  for(let i=0;i<open;i++){
    const id=crypto.randomUUID();jobs.push(id);
    const product={name:i?'Heizdecke Premium':'Kuscheldecke',asin:asins[i],sourceUrl:`https://www.amazon.de/dp/${asins[i]}`,affiliateUrl:`https://www.amazon.de/dp/${asins[i]}?tag=alltaeglichle-21`};
    await pg.query("INSERT INTO products(id,name,source_url) VALUES($1,$2,$3)",[`p${i}`,product.name,product.sourceUrl]);
    const snapshot={version:1,id,status:'awaiting_approval',opportunity:{product},content:{format:'image',caption:`Caption ${i}`}};
    await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
      VALUES($1,$2,'home','k','post','facebook','t',$3,'awaiting_approval',$4,now(),now())`,[id,`p${i}`,JSON.stringify({product}),JSON.stringify(snapshot)]);
    await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status,whatsapp_message_id) VALUES(current_date,$1,$2,'awaiting_approval',$3)",[i?'afternoon':'morning',id,`wamid.approval${i}`]);
    await pg.query("INSERT INTO product_selection_locks(key,job_id,expires_at) VALUES($1,$2,now()+interval '7 days'),($3,$2,now()+interval '7 days')",[`asin:${asins[i]}`,id,`family:throw_blanket${i}`]);
  }
  const state={interpreted:0,sent:[],started:[],converse:[]};
  const msg=(body,id='wamid.in.'+Math.random().toString(36).slice(2),replyToMessageId=null)=>({id,from:'491234',body,replyToMessageId,payload:{}});
  const deps=(extra={})=>({database:db,send:async text=>{state.sent.push(text);return 'wamid.out';},
    interpret:extra.interpret||(async body=>{state.interpreted++;const make=MODEL[body];if(!make)throw new RouterUnavailable('router_failed');return make();}),
    searchProduct:(input,request)=>startProductSearch(input,{...request,replyToMessageIdForReplace:null},db,async(...args)=>{state.started.push(args);return {status:'awaiting_approval',jobId:'new',whatsapp:'approval_sent'};},async text=>{state.sent.push(text);return 'wamid.out';}),
    converse:async(input,facts)=>{state.converse.push({input,facts});return true;}});
  const draftStatus=async()=>(await pg.query("SELECT j.status AS job,d.status AS draft FROM daily_drafts d JOIN content_jobs j ON j.id=d.job_id ORDER BY d.slot")).rows;
  return {pg,db,jobs,state,msg,deps,draftStatus};
}

test('literal gate words never reach the model; everything else is interpreted first',async t=>{
  const f=await fixture(t);
  for(const body of ['Nein.','Freigeben.','Ablehnen','Status','weiter','Entwurf'])assert.equal(isLiteralGate(body),true,body);
  for(const body of ['Nicht veröffentlichen.','Mach weiter.','Nein, nimm ein anderes Produkt.'])assert.equal(isLiteralGate(body),false,body);
  for(const body of ['Nein.','Freigeben.'])assert.deepEqual(await routeOperatorMessage(f.msg(body),f.deps()),{handled:false});
  assert.equal(f.state.interpreted,0);
  for(const body of ['Artikelsuche Saugroboter','Bildpost B0C2C739KY','Neuer Auftrag https://www.amazon.de/dp/B0C2C739KY','https://www.amazon.de/dp/B0C2C739KY'])
    assert.deepEqual(await routeOperatorMessage(f.msg(body),f.deps()),{handled:false},body);
  assert.equal(f.state.interpreted,0,'explicit commands and product links skip the model');
});

test('„Nein, nimm ein anderes Produkt.“ replaces the single open draft without leaving a zombie',async t=>{
  const f=await fixture(t);
  const result=await routeOperatorMessage(f.msg('Nein, nimm ein anderes Produkt.'),f.deps());
  assert.deepEqual(result,{handled:true});
  assert.deepEqual(await f.draftStatus(),[{job:'needs_input',draft:'needs_input'}]);
  assert.equal(f.state.started.length,1);assert.equal(f.state.started[0][3],undefined);
  const locks=(await f.pg.query('SELECT key FROM product_selection_locks ORDER BY key')).rows.map(r=>r.key);
  assert.deepEqual(locks,['asin:B000000001'],'ASIN stays locked, family lock is released');
  assert.match(f.state.sent[0],/Alten Entwurf.*gestoppt/);
  const stored=(await f.pg.query('SELECT raw_message,action,route FROM whatsapp_routes')).rows[0];
  assert.equal(stored.raw_message,'Nein, nimm ein anderes Produkt.');assert.equal(stored.action,'replace_product');
});

test('„Such mir stattdessen eine Silbermatte.“ and „günstiger“ pass the search term; unverifiable wishes are answered honestly',async t=>{
  const f=await fixture(t);
  await routeOperatorMessage(f.msg('Such mir stattdessen eine Silbermatte.'),f.deps());
  assert.equal(f.state.started[0][3],'Silbermatte');
  const g=await fixture(t);
  await routeOperatorMessage(g.msg('Nimm etwas Ähnliches, aber günstiger.'),g.deps());
  assert.equal(g.state.started[0][3],'Kuscheldecke');assert.match(g.state.sent[0],/Preise kann ich nicht verlässlich vergleichen/);
});

test('„Such was Neues.“ searches without touching the open draft; in an idle state nothing is stopped',async t=>{
  const f=await fixture(t);
  await routeOperatorMessage(f.msg('Such was Neues.'),f.deps());
  assert.deepEqual(await f.draftStatus(),[{job:'awaiting_approval',draft:'awaiting_approval'}]);assert.equal(f.state.started.length,1);
  const idle=await fixture(t,{open:0});
  await routeOperatorMessage(idle.msg('Nein, nimm ein anderes Produkt.'),idle.deps());
  assert.equal(idle.state.started.length,1);assert.doesNotMatch(idle.state.sent[0],/gestoppt/);
});

test('image or text changes keep the product: the router only resolves the target and continues the gated chain',async t=>{
  const f=await fixture(t);
  const image=await routeOperatorMessage(f.msg('Das Produkt passt, aber mach das Bild neu.'),f.deps());
  assert.equal(image.handled,false);assert.equal(image.skipKeywordStages,true);assert.equal(image.message.replyToMessageId,'wamid.approval0');
  const text=await routeOperatorMessage(f.msg('Ändere nur den Text.'),f.deps());
  assert.equal(text.message.replyToMessageId,'wamid.approval0');
  assert.deepEqual(await f.draftStatus(),[{job:'awaiting_approval',draft:'awaiting_approval'}]);assert.equal(f.state.started.length,0);
  const idle=await fixture(t,{open:0});
  assert.deepEqual(await routeOperatorMessage(idle.msg('Ändere nur den Text.'),idle.deps()),{handled:true});
  assert.match(idle.state.sent[0],/keinen offenen Entwurf/);
});

test('with two open drafts a vague reference asks briefly; a quoted approval resolves it',async t=>{
  const f=await fixture(t,{open:2});
  assert.deepEqual(await routeOperatorMessage(f.msg('Das Produkt passt, aber mach das Bild neu.'),f.deps()),{handled:true});
  assert.match(f.state.sent[0],/Welchen Entwurf meinst du\?/);assert.match(f.state.sent[0],/Kuscheldecke/);assert.match(f.state.sent[0],/Heizdecke Premium/);
  const quoted=await routeOperatorMessage(f.msg('Das Produkt passt, aber mach das Bild neu.','wamid.in.q','wamid.approval1'),f.deps());
  assert.equal(quoted.message.replyToMessageId,'wamid.approval1');
  const search=await routeOperatorMessage(f.msg('Nein, nimm ein anderes Produkt.','wamid.in.s','wamid.approval1'),f.deps());
  assert.deepEqual(search,{handled:true});
  assert.deepEqual(await f.draftStatus(),[{job:'needs_input',draft:'needs_input'},{job:'awaiting_approval',draft:'awaiting_approval'}]);
});

test('questions and status requests never start a pipeline; facts come from the database',async t=>{
  const f=await fixture(t);
  await routeOperatorMessage(f.msg('Warum hast du das Produkt ausgewählt?'),f.deps());
  assert.equal(f.state.converse.length,1);assert.match(f.state.converse[0].facts,/Kuscheldecke.*B000000001.*Inhaltsfreigabe/);assert.equal(f.state.started.length,0);
  await routeOperatorMessage(f.msg('Was ist gerade noch offen?'),f.deps());
  assert.match(f.state.sent.at(-1),/Offen:\n• „Kuscheldecke“ – Inhaltsfreigabe/);
  await routeOperatorMessage(f.msg('Mach weiter.'),f.deps());assert.match(f.state.sent.at(-1),/Offen:/);
  const idle=await fixture(t,{open:0});
  await routeOperatorMessage(idle.msg('Was ist gerade noch offen?'),idle.deps());assert.match(idle.state.sent[0],/nichts auf deine Freigabe/);
  assert.deepEqual(await f.draftStatus(),[{job:'awaiting_approval',draft:'awaiting_approval'}]);
});

test('free-text refusal goes through the real rejection gate; free-text approval never approves',async t=>{
  const f=await fixture(t);
  const reject=await routeOperatorMessage(f.msg('Nicht veröffentlichen.'),f.deps());
  assert.equal(reject.handled,false);assert.equal(reject.message.body,'Ablehnen');assert.equal(reject.message.replyToMessageId,'wamid.approval0');
  const approve=await routeOperatorMessage(f.msg('Passt so, raus damit.'),f.deps());
  assert.deepEqual(approve,{handled:true});assert.match(f.state.sent.at(-1),/nur auf ein ausdrückliches „Freigeben“/);
  assert.deepEqual(await f.draftStatus(),[{job:'awaiting_approval',draft:'awaiting_approval'}]);
});

test('model output is validated: unknown ids are ignored, low confidence asks, failures fall back, replays are free',async t=>{
  const f=await fixture(t);
  const bad=await routeOperatorMessage(f.msg('x1'),f.deps({interpret:async()=>route({intent:'revise_text',draft_id:'00000000-0000-0000-0000-000000000000'})}));
  assert.equal(bad.message.replyToMessageId,'wamid.approval0','an invented id falls back to the only open draft');
  const unsure=await routeOperatorMessage(f.msg('x2'),f.deps({interpret:async()=>route({intent:'search_product',confidence:0.3,ambiguity:'high',reject_current:true})}));
  assert.deepEqual(unsure,{handled:true});assert.equal(f.state.started.length,0);assert.deepEqual(await f.draftStatus(),[{job:'awaiting_approval',draft:'awaiting_approval'}]);
  const down=await routeOperatorMessage(f.msg('Unbekannter Satz'),f.deps());
  assert.deepEqual(down,{handled:false},'router unavailable: the existing chain takes over');
  assert.throws(()=>routeSchema.parse({...route(),extra:1}));assert.throws(()=>routeSchema.parse(route({intent:'delete_everything'})));
  const m=f.msg('Was ist gerade noch offen?','wamid.in.replay');
  await routeOperatorMessage(m,f.deps());const before=f.state.interpreted,sentBefore=f.state.sent.length;
  await routeOperatorMessage(m,f.deps());
  assert.equal(f.state.interpreted,before);assert.equal(f.state.sent.length,sentBefore);
});

test('a reply to a video cost approval is left to the production gate',async t=>{
  const f=await fixture(t);
  const runId=crypto.randomUUID();
  await f.pg.query("INSERT INTO production_runs(id,job_id,content_type,provider,provider_mode,status) VALUES($1,$2,'video','runway','RUNWAY_SINGLE_CLIP','awaiting_whatsapp_approval')",[runId,f.jobs[0]]);
  await f.pg.query("INSERT INTO approval_requests(id,production_run_id,job_id,kind,status,approval_token,summary,whatsapp_message_id,approver_wa_id) VALUES($1,$2,$3,'render','pending','tok',$4,'wamid.cost','491234')",[crypto.randomUUID(),runId,f.jobs[0],'Kosten']);
  const result=await routeOperatorMessage(f.msg('Nein, nimm ein anderes Produkt.','wamid.in.cost','wamid.cost'),f.deps());
  assert.deepEqual(result,{handled:false});assert.equal(f.state.interpreted,0);
});

test('context carries product, ASIN, stage, history and the 7-day product states for the model',async t=>{
  const f=await fixture(t,{open:2});
  await f.pg.query("INSERT INTO whatsapp_events(message_id,wa_id,body,payload) VALUES('wamid.prev','491234','Mach das Bild schöner','{}')");
  const context=await loadRouteContext(f.db,'491234','wamid.now','wamid.approval1');
  assert.equal(context.open_items.length,2);assert.equal(context.replying_to,f.jobs[1]);
  assert.ok(context.open_items.every(item=>item.asin&&item.product&&item.stage==='content_approval'&&item.caption_excerpt));
  assert.ok(context.recent_messages.some(m=>m.from==='operator'&&m.text==='Mach das Bild schöner'));
  assert.ok(context.recent_products.some(p=>p.asin==='B000000001'&&p.state==='wartet auf Freigabe'));
  assert.match(systemFacts(context),/Produkte dürfen innerhalb von 7 Tagen nicht erneut/);
  assert.match(statusText(context),/Heizdecke Premium/);
});

test('signed webhook → router → model call → state → pipeline → reply, for the real handler source',async t=>{
  const {createHmac}=require('node:crypto');const loadRoute=require('./helpers/load-route.cjs');
  const f=await fixture(t);
  const env={META_APP_SECRET:'test-router-signature',WHATSAPP_PHONE_NUMBER_ID:'123456',REPLICATE_API_TOKEN:'router-test-token',WHATSAPP_ROUTER_ENABLED:'true'};
  const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  t.after(()=>{for(const key of Object.keys(env)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
  const modelCalls=[];
  t.mock.method(global,'fetch',async(url,init)=>{
    if(String(url).includes('/models/')){
      const body=JSON.parse(init.body);modelCalls.push(body.input);
      assert.equal(init.headers.Authorization,'Bearer router-test-token');assert.ok(!JSON.stringify(body).includes('router-test-token'));
      return new Response(JSON.stringify({id:'abcdefghijkl1',status:'succeeded',output:JSON.stringify(route({intent:'search_product',reject_current:true,search_query:'Silbermatte'}))}),{status:200});
    }
    throw new Error('unexpected request '+url);
  });
  const real=require('../.test-build/lib/whatsapp/router');const search=require('../.test-build/lib/whatsapp/start-image-post');
  const sent=[],started=[];
  const handler=loadRoute('app/api/whatsapp/webhook/route.ts',{
    'next/server':{after:()=>{}},
    '@/lib/memory/db':{getDatabase:()=>f.db},
    '@/lib/production/repository':{productionRepository:()=>({applyIncomingWhatsApp:async()=>{throw Error('keyword chain must not run');}})},
    '@/lib/whatsapp/router':{routeOperatorMessage:(m,deps)=>real.routeOperatorMessage(m,{...deps,database:f.db})},
    '@/lib/whatsapp/start-image-post':{startImagePostFromWhatsApp:async()=>{throw Error('keyword stage ran before the router');},startProductSearch:(input,request,db,start,send)=>search.startProductSearch(input,request,f.db,start,send)},
    '@/lib/daily/draft':{createDailyDraft:async(...args)=>{started.push(args);return {status:'awaiting_approval',jobId:'new',whatsapp:'approval_sent'};},sendDailyApproval:async()=>true,sendPendingDailyApprovals:async()=>0},
    '@/lib/whatsapp/client':{sendWhatsAppText:async text=>{sent.push(text);return 'wamid.out';}},
  });
  const payload=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456'},messages:[{id:'wamid.e2e',from:'491234',type:'text',text:{body:'Nee, das Produkt will ich nicht. Such mir lieber eine Silbermatte.'}}]}}]}]});
  const request=()=>new Request('https://local.test/api/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':`sha256=${createHmac('sha256',env.META_APP_SECRET).update(payload).digest('hex')}`},body:payload});
  assert.equal((await handler.POST(request())).status,200);
  assert.equal(modelCalls.length,1);
  const sentContext=JSON.parse(modelCalls[0].prompt);
  assert.equal(sentContext.operator_message,'Nee, das Produkt will ich nicht. Such mir lieber eine Silbermatte.');
  assert.equal(sentContext.context.open_items[0].asin,'B000000001');assert.equal(sentContext.context.open_items[0].stage,'content_approval');
  assert.equal(started.length,1);assert.equal(started[0][3],'Silbermatte');
  assert.deepEqual(await f.draftStatus(),[{job:'needs_input',draft:'needs_input'}]);
  assert.match(sent[0],/Alten Entwurf.*gestoppt.*„Silbermatte“/);
  assert.equal((await f.pg.query("SELECT action FROM whatsapp_routes")).rows[0].action,'replace_product');
  // Meta redelivers the same webhook: no second model call, no second search, no second reply.
  assert.equal((await handler.POST(request())).status,200);
  assert.equal(modelCalls.length,1);assert.equal(started.length,1);assert.equal(sent.length,1);
});

// ---- Fragepfad: Kontext, Antwort, Fail-safe -------------------------------------------------
const answerRoute=(text,over={})=>route({intent:'question',answer:text,...over});

test('free question without a quote, one clear active product: answered from stored data, nothing changes',async t=>{
  const f=await fixture(t);
  let seen;
  const out=await routeOperatorMessage(f.msg('Warum hast du eigentlich dieses Produkt ausgewählt?'),f.deps({interpret:async(body,context)=>{seen=context;return answerRoute('Die Kuscheldecke stammt aus der Suche. Ein konkreter Auswahlgrund ist nicht gespeichert.');}}));
  assert.deepEqual(out,{handled:true});
  assert.equal(seen.focus.source,'single_open');assert.equal(seen.focus.asin,'B000000001');assert.equal(seen.focus.product,'Kuscheldecke');
  assert.match(seen.focus.data_limits,/nur Titel und ASIN/);assert.ok(seen.focus.verified_product_data.some(line=>/Titel der Amazon-Produktseite: Kuscheldecke/.test(line)));
  assert.ok(seen.focus.selection_basis.length>0);
  assert.match(f.state.sent[0],/Kuscheldecke/);assert.equal(f.state.converse.length,0,'answered in the same call, no second model call');
  assert.deepEqual(await f.draftStatus(),[{job:'awaiting_approval',draft:'awaiting_approval'}]);assert.equal(f.state.started.length,0);
});

test('free question as a direct reply to a concrete approval message uses exactly that product, also when it is already closed',async t=>{
  const f=await fixture(t,{open:2});
  let seen;
  await routeOperatorMessage(f.msg('Warum hast du dieses Produkt gewählt?','wamid.in.q1','wamid.approval1'),f.deps({interpret:async(body,context)=>{seen=context;return answerRoute('Das ist die Heizdecke Premium.');}}));
  assert.equal(seen.focus.source,'replying_to');assert.equal(seen.focus.product,'Heizdecke Premium');assert.equal(seen.focus.draft_id,f.jobs[1]);
  // The quoted draft was stopped meanwhile: still resolved, with an honest state.
  await f.pg.query("UPDATE daily_drafts SET status='needs_input',feedback='replaced_by_operator' WHERE job_id=$1",[f.jobs[1]]);
  await f.pg.query("UPDATE content_jobs SET status='needs_input' WHERE id=$1",[f.jobs[1]]);
  await routeOperatorMessage(f.msg('Warum hast du dieses Produkt gewählt?','wamid.in.q2','wamid.approval1'),f.deps({interpret:async(body,context)=>{seen=context;return answerRoute('Das war die Heizdecke; sie wurde inzwischen gestoppt.');}}));
  assert.equal(seen.focus.draft_id,f.jobs[1]);assert.equal(seen.focus.state,'gestoppt/ersetzt');
});

test('two open products without a quote: no guessed focus, a short question instead of a wrong assignment',async t=>{
  const f=await fixture(t,{open:2});
  let seen;
  const out=await routeOperatorMessage(f.msg('Die Beschreibung passt doch gar nicht zu diesem Produkt.'),f.deps({interpret:async(body,context)=>{seen=context;return route({intent:'clarify',clarification_question:null,confidence:0.9,ambiguity:'high'});}}));
  assert.deepEqual(out,{handled:true});assert.equal(seen.focus,null);assert.equal(seen.candidate_job_ids.length,2);
  assert.match(f.state.sent[0],/Welchen Entwurf meinst du\?/);assert.match(f.state.sent[0],/Kuscheldecke/);assert.match(f.state.sent[0],/Heizdecke Premium/);
});

test('an old, closed job never becomes the context while a newer product is open; latest recent is used only when nothing is open',async t=>{
  const f=await fixture(t);
  await f.pg.query("UPDATE content_jobs SET created_at=now()-interval '30 hours',updated_at=now()-interval '30 hours' WHERE id=$1",[f.jobs[0]]);
  await f.pg.query("UPDATE daily_drafts SET status='needs_input',created_at=now()-interval '30 hours' WHERE job_id=$1",[f.jobs[0]]);
  await f.pg.query("UPDATE content_jobs SET status='needs_input' WHERE id=$1",[f.jobs[0]]);
  const none=await loadRouteContext(f.db,'491234','wamid.x',null);
  assert.equal(none.focus,null,'a 30 hour old closed job is not an active context');
  const fresh=await fixture(t);
  await fresh.pg.query("UPDATE daily_drafts SET status='needs_input'");await fresh.pg.query("UPDATE content_jobs SET status='needs_input'");
  const recent=await loadRouteContext(fresh.db,'491234','wamid.y',null);
  assert.equal(recent.focus.source,'latest_recent');assert.equal(recent.focus.state,'gestoppt/ersetzt');
});

test('an unusable model answer or an empty inline answer falls back to the facts-based chat, never to a silent failure',async t=>{
  const f=await fixture(t);
  await routeOperatorMessage(f.msg('Warum dieses Produkt?'),f.deps({interpret:async()=>answerRoute(null)}));
  assert.equal(f.state.converse.length,1);assert.match(f.state.converse[0].facts,/Besprochenes Produkt \(single_open\): „Kuscheldecke“ \(ASIN B000000001\)/);
  assert.match(f.state.converse[0].facts,/nur Titel und ASIN/);
});

test('rate limiting (HTTP 429) is retried once after the advertised wait; the chat path logs its failure reason',async t=>{
  const {interpretMessage}=require('../.test-build/lib/whatsapp/route-llm');
  const saved=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='token-for-test';t.after(()=>{if(saved===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=saved;});
  const context={now:'',replying_to:null,open_items:[],recent_messages:[],recent_products:[],recent_instructions:[],focus:null,candidate_job_ids:[]};
  let posts=0;const waits=[];
  const request=async(url,init)=>{
    if(init?.method==='POST'){posts++;if(posts===1)return new Response('{"retry_after":4}',{status:429});
      return new Response(JSON.stringify({id:'abcdefghijkl2',status:'succeeded',output:JSON.stringify(route({intent:'status'}))}),{status:200});}
    throw Error('unexpected GET');
  };
  const result=await interpretMessage('Was ist offen?',context,request,async ms=>{waits.push(ms);});
  assert.equal(result.intent,'status');assert.equal(posts,2);assert.deepEqual(waits,[4000]);
  posts=0;const failing=async()=>new Response('{}',{status:429});
  await assert.rejects(interpretMessage('x',context,failing,async()=>{}),/router_http_429/);
});

// ---- Produktdaten: nur belegte Aussagen ---------------------------------------------------
const {unsupportedClaims,productEvidence,unsupportedProductClaims,PRODUCT_DATA_UNCERTAIN}=require('../.test-build/lib/content/claim-support');
const {cleanAmazonTitle}=require('../.test-build/lib/product-resolver');

test('product data contradicting the generated use case is detected: rolling dough on an oven crisping mat',()=>{
  const title='Silikon Backmatte Backunterlage Backofen Matte - Backen Knusprig Backformhundekekse HitzebestäNdig Mit Pyramiden Noppen Leicht Zu Reinigen Wiederverwendbar FüR';
  const evidence=productEvidence({name:cleanAmazonTitle(title),productVerifiedName:cleanAmazonTitle(title)},[]);
  const copy='Mit einer Silikon-Backmatte bleibt die Küche beim Backen sauber: Einfach Teig ausrollen, nach dem Backen die Matte abnehmen. Spülmaschinengeeignet, 42 cm breit.';
  const ids=unsupportedClaims(copy,evidence).map(claim=>claim.id);
  assert.ok(ids.includes('dough_work'));assert.ok(ids.includes('dishwasher'));assert.ok(ids.some(id=>id.startsWith('number:42cm')));
  // What the title does support is not flagged.
  assert.deepEqual(unsupportedClaims('Hitzebeständig, wiederverwendbar und leicht zu reinigen – knusprig backen.',evidence),[]);
  // Operator-verified facts extend the evidence.
  const withFact=productEvidence({name:'Backmatte',productVerifiedName:'Backmatte'},[{claim:'Auch zum Ausrollen von Teig geeignet',source:'https://example.com/p'}]);
  assert.deepEqual(unsupportedClaims('Teig ausrollen',withFact),[]);
});

test('unsupported claims stop the plan: needs_input with product_data_uncertain, no approval, and the publication gate agrees',async()=>{
  const {runContentJob}=require('../.test-build/lib/content/orchestrator');
  const {opportunitySchema}=require('../.test-build/lib/content/schema');
  const {facebookPagePublicationError}=require('../.test-build/lib/meta/publication-eligibility');
  const opportunity=opportunitySchema.parse({product:{productVerifiedAt:new Date().toISOString(),productVerifiedName:'Backofen Matte Hitzebeständig',name:'Backofen Matte Hitzebeständig',sourceUrl:'https://www.amazon.de/dp/B0CM14MKY8',affiliateUrl:'https://www.amazon.de/dp/B0CM14MKY8?tag=alltaeglichle-21',asin:'B0CM14MKY8',price:'',targetGroup:'Hobbybäcker',benefits:'Eignung vor Kauf prüfen',notes:''},
    useCase:'Teig ausrollen und danach spülmaschinengeeignet reinigen.',targetPlatform:'facebook',budget:'low'});
  const job=await runContentJob(opportunity,{id:crypto.randomUUID(),mode:'reference',allowedFormats:['image'],loadLearning:async()=>undefined,onUpdate:async()=>{}});
  if(job.status==='needs_input'){assert.equal(job.error,PRODUCT_DATA_UNCERTAIN);assert.match(job.review.issues[0],/Nicht durch die Produktdaten belegt/);}
  else{ // the reference writer did not repeat the claim: the final gate must still refuse a draft that does
    const tampered={...job,status:'approved',content:{...job.content,caption:`${job.content.caption} Einfach Teig ausrollen.`}};
    assert.match(facebookPagePublicationError(tampered),/Nicht durch die Produktdaten belegt.*dough|Teig ausrollen/);
  }
});

test('a scout idea the article does not support is neutralized before it reaches the content plan',async t=>{
  const {PGlite}=require('@electric-sql/pglite');const loadRoute=require('./helpers/load-route.cjs');
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  let seenUseCase=null;
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runProductScout:async()=>({candidates:[{kind:'Saisontrend',name:'Silikon Backmatte',category:'Küche',whyNow:'Backsaison',reelIdea:'Teig ausrollen, in der Spülmaschine reinigen und 250 °C Hitze zeigen.',
      resolvedProduct:{name:'Backofen Matte Hitzebeständig',productVerifiedName:'Backofen Matte Hitzebeständig',productVerifiedAt:new Date().toISOString(),sourceUrl:'https://www.amazon.de/dp/B0CM14MKY8',affiliateUrl:'https://www.amazon.de/dp/B0CM14MKY8?tag=alltaeglichle-21',asin:'B0CM14MKY8',price:'',targetGroup:'Hobbybäcker',benefits:'Eignung vor Kauf prüfen',notes:''}}]}),
      runContentJob:async(opportunity,options)=>{seenUseCase=opportunity.useCase;return {id:options.id,status:'needs_input',opportunity,events:[],error:'product_data_uncertain',review:{passed:false,score:35,issues:['Nicht durch die Produktdaten belegt: Teig ausrollen/kneten.']},modelCalls:0,totalTokens:0,revisions:0,mode:'reference'};}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{WhatsAppRejectedError:Error,sendWhatsAppText:async()=>{throw Error('no message may be sent');},dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('no');}},
  });
  const result=await daily.createDailyDraft('2026-10-02','manual:x');
  assert.doesNotMatch(seenUseCase,/ausrollen|Spülmaschine|250/);assert.match(seenUseCase,/Eignung vor dem Kauf prüfen/);
  assert.equal(result.status,'needs_input');assert.equal(result.reason,'product_data_uncertain');
  const row=(await pg.query("SELECT status,scout_report->>'reason' AS reason,scout_report->>'detail' AS detail FROM daily_drafts")).rows[0];
  assert.deepEqual(row,{status:'needs_input',reason:'product_data_uncertain',detail:'Nicht durch die Produktdaten belegt: Teig ausrollen/kneten.'});
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
});

test('a stale snapshot of another article cannot leak its properties into new content',()=>{
  const oldSnapshotContent={title:'Kürbis-Schnitzset 10 Teile',caption:'Spülmaschinengeeignet, 10 Stück, lebensmittelecht und bis 250 °C hitzebeständig.'};
  const newProduct={name:'Wäschekorb faltbar grau',productVerifiedName:'Wäschekorb faltbar grau',asin:'B000000009'};
  const opportunity={product:newProduct,verifiedFacts:[]};
  const ids=unsupportedProductClaims(opportunity,oldSnapshotContent).map(claim=>claim.id);
  for(const id of ['dishwasher','food_safe','heat'])assert.ok(ids.includes(id),id);
  assert.ok(ids.some(id=>id.startsWith('number:10stück')));
  assert.deepEqual(unsupportedProductClaims(opportunity,{title:'Ordnung im Bad',caption:'Der Wäschekorb ist faltbar und grau.'}),[]);
});

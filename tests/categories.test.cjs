const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');
const tax=require('../.test-build/lib/content/taxonomy');
const store=require('../.test-build/lib/content/category-store');
const {changeCategory}=require('../.test-build/lib/whatsapp/category-change');
const {routeOperatorMessage}=require('../.test-build/lib/whatsapp/router');
const {loadPublishedProducts}=require('../.test-build/lib/landing/published');
const {contentApprovalMessage}=require('../.test-build/lib/whatsapp/content-approval');

const route=(over={})=>({intent:'set_category',draft_id:null,search_query:null,reject_current:false,operator_note:null,answer:null,image_instruction:null,
  category_name:null,category_create:false,category_force_new:false,clarification_question:null,confidence:0.95,ambiguity:'none',...over});

async function database(t){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  return {pg,db};
}

// A real daily draft (real orchestrator in reference mode), with the scout candidate under our control.
async function dailyDraft(t,{name='Silikon Backmatte Backunterlage',scoutCategory='Backen',day='2026-10-02',slot='morning',asin='B000000001',db:shared}={}){
  const base=shared||await database(t);const {pg,db}=base;
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES($1,'491234','changes_requested','{}') ON CONFLICT DO NOTHING",[`in.${asin}`]);
  const messages=[];
  const product={name,productVerifiedName:name,productVerifiedAt:new Date().toISOString(),sourceUrl:`https://www.amazon.de/dp/${asin}`,asin,affiliateUrl:`https://www.amazon.de/dp/${asin}?tag=alltaeglichle-21`,price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''};
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runContentJob:require('../.test-build/lib/content/orchestrator').runContentJob,
      runProductScout:async()=>({candidates:[{resolvedProduct:product,kind:'Dauerläufer',name,category:scoutCategory,reelIdea:'Das Produkt im Alltag verwenden und die Eignung vor dem Kauf prüfen.',whyNow:'Ganzjährig'}]})},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{WhatsAppRejectedError:class extends Error{},sendWhatsAppText:async body=>{messages.push(body);return `wamid.mock.${asin}.${messages.length}`;},dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('no');}},
  });
  const result=await daily.createDailyDraft(day,slot);
  assert.equal(result.status,'awaiting_approval',JSON.stringify(result));
  return {...base,result,messages,daily,jobId:result.jobId};
}
const snapshotOf=async(pg,id)=>(await pg.query('SELECT snapshot,category,opportunity FROM content_jobs WHERE id=$1',[id])).rows[0];

test('the pipeline assigns an existing category before the approval; it is shown in the WhatsApp content approval and stored in content_jobs.category',async t=>{
  const f=await dailyDraft(t);
  const row=await snapshotOf(f.pg,f.jobId);
  assert.equal(row.category,'cooking_baking');assert.equal(row.snapshot.opportunity.category,'cooking_baking');assert.equal(row.opportunity.category,'cooking_baking');
  assert.equal(f.messages.length,1);
  assert.match(f.messages[0],/\nKategorie: Kochen & Backen \(so wird der Beitrag auf der Landingpage einsortiert\)\n/);
  assert.match(f.messages[0],/Produkt: Silikon Backmatte/);assert.match(f.messages[0],/ASIN: B000000001/);assert.match(f.messages[0],/tag=alltaeglichle-21/);assert.match(f.messages[0],/Kategorie bitte Küche/);
  // The generic content approval (video/text/other) shows it as well.
  const short=structuredClone(row.snapshot);short.content.body='Kurztext';short.content.caption='Kurztext https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21';short.content.format='text';
  const text=contentApprovalMessage(short,tax.labelFor(row.category));
  assert.match(text,/\nKategorie: Kochen & Backen\n/);
});

test('the scout can only pick built-in categories; an unknown scout label never creates a category',async t=>{
  assert.equal(tax.suggestCategory('Unbekanntes Ding XY','Völlig neue Kategorie','Dauerläufer'),'general');
  assert.equal(tax.suggestCategory('Halloween Kürbis Silikon Backformen 2er-Set',null,'Saisontrend'),'cooking_baking');
  assert.equal(tax.suggestCategory('Kürbis-Schnitzwerkzeug-Set','Halloween','Saisontrend'),'seasonal');
  assert.equal(tax.suggestCategory('Edelstahl Trinkflasche','Unterwegs','Dauerläufer'),'outdoor');
  assert.equal(tax.suggestCategory('Wärmende Kuscheldecke',null,'Saisontrend'),'home_living');
  assert.equal(tax.suggestCategory('Etwas Namenloses','Gezielte Artikelsuche','Dauerläufer'),'general');
  const builtIn=new Set(tax.BUILT_IN_CATEGORIES.map(c=>c.key));
  for(const [n,c,k] of [['Zeug','Phantasie','Saisontrend'],['Dingens',null,null],['Sonstiges','Aktuelles Suchsignal','Aktueller Trend']])assert.ok(builtIn.has(tax.suggestCategory(n,c,k)));
  const f=await dailyDraft(t,{name:'Mysteriöses Gadget ohne Kategorie',scoutCategory:'Erfundene Kategorie',asin:'B000000002'});
  assert.equal((await snapshotOf(f.pg,f.jobId)).category,'general');
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM content_categories')).rows[0].n,0,'the pipeline never writes to the category registry');
});

test('historical keys are kept; one controlled taxonomy without duplicates from different spellings',()=>{
  for(const key of ['general','kitchen','household','home_living','technology','leisure'])assert.ok(tax.BUILT_IN_CATEGORIES.some(c=>c.key===key),key);
  for(const spelling of ['Home and Living','Home & Living','home_living','Wohnen & Living','wohnen','HOME   LIVING','Living'])assert.equal(tax.resolveCategory(spelling).category?.key,'home_living',spelling);
  for(const spelling of ['Küche','kueche','KÜCHE','Kuche'])assert.equal(tax.resolveCategory(spelling).category?.key,'kitchen',spelling);
  for(const spelling of ['Kochen & Backen','Backen und Kochen','kochen und backen'])assert.equal(tax.resolveCategory(spelling).category?.key,'cooking_baking',spelling);
  assert.equal(tax.resolveCategory('Dekoration').category.key,'decor');assert.equal(tax.resolveCategory('Saisonal').category.key,'seasonal');
  assert.equal(tax.resolveCategory('Backen').kind,'similar','an overlapping name asks instead of guessing');
  assert.equal(tax.resolveCategory('Heizdecken').kind,'none');
  assert.equal(tax.labelFor('home_living'),'Home & Living');assert.equal(tax.labelFor('cooking_baking'),'Kochen & Backen');
  assert.equal(tax.keyFor('Kochen & Backen'),'kochen_und_backen');assert.equal(tax.keyFor('Übergrößen'),'uebergroessen');
  assert.equal(tax.validNewName('Backen.'),'Backen');
  for(const bad of ['','x','Eine ganz lange Kategorie mit vielen Wörtern drin','12345','Kategorie; DROP TABLE'])assert.equal(tax.validNewName(bad),null,bad);
});

test('the registry never duplicates: variants resolve to the existing entry, a real new name is created once',async t=>{
  const {db}=await database(t);
  const first=await store.createCategory(db,'Backen',null);
  assert.equal(first.created,true);assert.equal(first.category.key,'backen');assert.equal(first.category.label,'Backen');
  for(const again of ['backen','BACKEN ','Backen!'])assert.deepEqual((await store.createCategory(db,again,null)).created,false,again);
  assert.equal((await store.createCategory(db,'Home and Living',null)).category.key,'home_living');
  assert.equal((await store.createCategory(db,'Home and Living',null)).created,false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM content_categories')).rows[0].n,1);
  const registry=await store.loadRegistry(db);
  assert.equal(tax.labelFor('backen',registry),'Backen');assert.equal(tax.resolveCategory('backen',registry).category.custom,true);
  assert.ok('error' in await store.createCategory(db,'bitte-ein-satz mit zu vielen wörtern hier',null));
});

async function twoDrafts(t){
  const a=await dailyDraft(t,{name:'Silikon Backmatte Backunterlage',asin:'B000000001',slot:'morning'});
  const b=await dailyDraft(t,{name:'Heizdecke Premium',scoutCategory:'Wohnen',asin:'B000000003',slot:'afternoon',db:a});
  return {db:a.db,pg:a.pg,a:a.jobId,b:b.jobId,messages:a.messages,daily:a.daily};
}
const harness=(f)=>{const sent=[],approvals=[];
  const deps={db:f.db,send:async text=>{sent.push(text);return 'wamid.n';},sendApproval:async id=>{approvals.push(id);return true;}};
  const msg=(body,id=`wamid.c.${Math.random().toString(36).slice(2)}`,reply=null)=>({id,from:'491234',body,replyToMessageId:reply,payload:{}});
  return {sent,approvals,deps,msg};
};

test('„Kategorie bitte Küche“ changes only the category of the focused draft and requires a fresh approval; nothing else moves',async t=>{
  const f=await twoDrafts(t);const h=harness(f);
  const beforeA=await snapshotOf(f.pg,f.a),beforeB=await snapshotOf(f.pg,f.b);
  const oldApproval=(await f.pg.query('SELECT whatsapp_message_id FROM daily_drafts WHERE job_id=$1',[f.a])).rows[0].whatsapp_message_id;
  assert.ok(oldApproval);
  await changeCategory(h.msg('Kategorie bitte Küche'),{draftId:f.a,name:'Küche',create:false,forceNew:false},h.deps);
  const afterA=await snapshotOf(f.pg,f.a);
  assert.equal(afterA.category,'kitchen');assert.equal(afterA.snapshot.opportunity.category,'kitchen');assert.equal(afterA.opportunity.category,'kitchen');
  const strip=snapshot=>{const copy=structuredClone(snapshot);delete copy.events;delete copy.updatedAt;copy.opportunity.category='-';return copy;};
  assert.deepEqual(strip(afterA.snapshot),strip(beforeA.snapshot),'product, ASIN, link, image brief, caption, review: all unchanged');
  assert.equal(afterA.snapshot.opportunity.product.asin,'B000000001');assert.match(afterA.snapshot.opportunity.product.affiliateUrl,/tag=alltaeglichle-21/);
  assert.equal(afterA.snapshot.events.at(-1).data.kind,'category_change');
  assert.deepEqual(await snapshotOf(f.pg,f.b),beforeB,'the other open draft is untouched');
  const draft=(await f.pg.query('SELECT status,whatsapp_message_id FROM daily_drafts WHERE job_id=$1',[f.a])).rows[0];
  assert.deepEqual(draft,{status:'awaiting_approval',whatsapp_message_id:null},'the old approval message no longer works; a new one is required');
  assert.deepEqual(h.approvals,[f.a]);assert.match(h.sent[0],/auf „Küche“ gesetzt.*Produkt, ASIN, Link, Bild und Text sind unverändert.*noch nichts ist veröffentlicht/);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM publications')).rows[0].n,0);
  // Same category again: nothing changes, no new approval, the existing message stays valid.
  await changeCategory(h.msg('Das kann ruhig unter Küche bleiben'),{draftId:f.a,name:'Küche',create:false,forceNew:false},h.deps);
  assert.equal(h.approvals.length,1);assert.match(h.sent.at(-1),/bleibt „Küche“/);
});

test('a new category is created only on an explicit instruction; unknown or similar names ask instead of inventing',async t=>{
  const f=await twoDrafts(t);const h=harness(f);const before=(await snapshotOf(f.pg,f.a)).category;
  // Unknown name without „neue Kategorie“: nothing is created, nothing changes.
  await changeCategory(h.msg('Pack das unter Reiseideen'),{draftId:f.a,name:'Reiseideen',create:false,forceNew:false},h.deps);
  assert.match(h.sent.at(-1),/gibt es nicht.*Vorhandene Kategorien: Allgemein, Haushalt.*Mach dafür eine neue Kategorie Reiseideen/);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM content_categories')).rows[0].n,0);assert.equal((await snapshotOf(f.pg,f.a)).category,before);
  // Similar to „Kochen & Backen“: ask, even with „neue Kategorie“.
  await changeCategory(h.msg('Mach dafür eine neue Kategorie Backen'),{draftId:f.a,name:'Backen',create:true,forceNew:false},h.deps);
  assert.match(h.sent.at(-1),/Meinst du die bestehende Kategorie „Kochen & Backen“\?/);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM content_categories')).rows[0].n,0);
  // Explicit, genuinely new name: created in the registry, assigned, fresh approval.
  await changeCategory(h.msg('Mach dafür eine neue Kategorie Reiseideen'),{draftId:f.a,name:'Reiseideen',create:true,forceNew:false},h.deps);
  assert.equal((await snapshotOf(f.pg,f.a)).category,'reiseideen');
  assert.deepEqual((await f.pg.query('SELECT key,display_name FROM content_categories')).rows,[{key:'reiseideen',display_name:'Reiseideen'}]);
  assert.deepEqual(h.approvals,[f.a]);
  // Confirmed duplicate-like name: created as its own category.
  await changeCategory(h.msg('Ja, neue Kategorie Backen anlegen'),{draftId:f.b,name:'Backen',create:true,forceNew:true},h.deps);
  assert.equal((await snapshotOf(f.pg,f.b)).category,'backen');
  // A variant of an existing built-in name never becomes a duplicate.
  await changeCategory(h.msg('Neue Kategorie Home and Living'),{draftId:f.b,name:'Home and Living',create:true,forceNew:false},h.deps);
  assert.equal((await snapshotOf(f.pg,f.b)).category,'home_living');
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM content_categories')).rows[0].n,2);
  // Garbage is refused.
  await changeCategory(h.msg('neue Kategorie ???'),{draftId:f.b,name:'???',create:true,forceNew:false},h.deps);
  assert.match(h.sent.at(-1),/nicht geeignet/);assert.equal((await snapshotOf(f.pg,f.b)).category,'home_living');
});

test('the natural-language route targets only the focused draft; ambiguity asks; closed or publishing stages are refused',async t=>{
  const f=await twoDrafts(t);const h=harness(f);
  const state={interpreted:0};
  const deps=(over={})=>({database:f.db,send:h.deps.send,interpret:over.interpret||(async()=>{state.interpreted++;return route({category_name:'Küche'});}),
    searchProduct:async()=>{throw Error('no search');},converse:async()=>{throw Error('no chat');},
    setCategory:(input,request)=>changeCategory(input,request,h.deps)});
  // Two open drafts and no quote: a short question, nothing changes.
  const vague=await routeOperatorMessage(h.msg('Kategorie bitte Küche','wamid.in.1'),deps());
  assert.deepEqual(vague,{handled:true});assert.match(h.sent.at(-1),/Welchen Entwurf meinst du\?/);
  assert.equal((await snapshotOf(f.pg,f.a)).category,'cooking_baking');assert.equal((await snapshotOf(f.pg,f.b)).category,'home_living');
  // Quoting the approval of draft B resolves it: only B changes.
  const approvalB=(await f.pg.query('SELECT whatsapp_message_id FROM daily_drafts WHERE job_id=$1',[f.b])).rows[0].whatsapp_message_id;
  await routeOperatorMessage(h.msg('Das gehört für mich eher zu Deko','wamid.in.2',approvalB),deps({interpret:async()=>route({category_name:'Deko'})}));
  assert.equal((await snapshotOf(f.pg,f.b)).category,'decor');assert.equal((await snapshotOf(f.pg,f.a)).category,'cooking_baking');
  assert.deepEqual(h.approvals,[f.b]);
  // After the content approval the category can no longer be changed.
  await f.pg.query("UPDATE daily_drafts SET status='content_approved' WHERE job_id=$1",[f.a]);
  const idle=await routeOperatorMessage(h.msg('Pack das unter Outdoor','wamid.in.3'),deps({interpret:async()=>route({category_name:'Outdoor'})}));
  assert.equal(idle.handled,true);assert.equal((await snapshotOf(f.pg,f.a)).category,'cooking_baking');
  assert.equal(h.approvals.length,1);
});

test('the category survives image and text revisions, the content approval and the stored-category guard',async t=>{
  const {memoryRepository}=require('../.test-build/lib/memory/repository');
  const {runContentJob,reviseOperatorInstruction}=require('../.test-build/lib/content/orchestrator');
  const {opportunitySchema}=require('../.test-build/lib/content/schema');
  const {clarification}=require('../.test-build/lib/whatsapp/instruction');
  const {db,pg}=await database(t);const memory=memoryRepository(db);
  const opportunity=opportunitySchema.parse({product:{productVerifiedAt:new Date().toISOString(),productVerifiedName:'Silikon Backmatte',name:'Silikon Backmatte',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21',asin:'B000000001',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''},
    category:'cooking_baking',useCase:'Das Produkt im Alltag verwenden und die Eignung vor dem Kauf prüfen.',targetPlatform:'facebook',budget:'low'});
  const id=crypto.randomUUID();await memory.claim(id,opportunity,'reference');
  const job=await runContentJob(opportunity,{id,mode:'reference',allowedFormats:['image'],loadLearning:async()=>undefined,onUpdate:memory.save});
  assert.equal(job.opportunity.category,'cooking_baking');
  const stored=async()=>(await pg.query('SELECT category,snapshot FROM content_jobs WHERE id=$1',[id])).rows[0];
  assert.equal((await stored()).category,'cooking_baking');
  // Operator picks another category; image revision and text revision keep it.
  await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status,whatsapp_message_id) VALUES('2026-10-02','morning',$1,'awaiting_approval','wamid.a')",[id]);
  await store.setJobCategory(db,id,'kitchen');
  let snapshot=(await stored()).snapshot;
  const imageRevision=reviseOperatorInstruction(snapshot,{...clarification(),intent:'revise_image',confidence:.98,product_context_matches:true,image_instruction:'Das Bild zeigt eine Backmatte auf einer sauberen Arbeitsfläche.',requires_new_generation:true});
  assert.equal(imageRevision.opportunity.category,'kitchen');
  const textRevision=reviseOperatorInstruction(imageRevision,{...clarification(),intent:'revise_text',confidence:.98,product_context_matches:true,text_instruction:'Text natürlicher',text_operations:['naturalize'],
    proposed_hook:'Backen ohne Sauerei, geht das?',proposed_caption:'Eine Silikon-Backmatte kann beim Backen die Arbeitsfläche schonen. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten, der Affiliate-Link kostet dich nichts extra.'});
  assert.equal(textRevision.opportunity.category,'kitchen');
  // A later save can never overwrite the stored category (e.g. a stale in-memory copy).
  const stale=structuredClone(snapshot);stale.opportunity.category='cooking_baking';stale.events.push({sequence:stale.events.length+1,at:new Date().toISOString(),agent:'orchestrator',kind:'status',message:'x'});
  await memory.save(stale);
  const after=await stored();assert.equal(after.category,'kitchen');assert.equal(after.snapshot.opportunity.category,'kitchen');
});

test('landing page: the stored category is shown, a new published category becomes a chip, historical products keep their category',async t=>{
  const {pg,db}=await database(t);
  const add=async(name,category,at)=>{
    const id=crypto.randomUUID();const n=Math.random().toString(36).slice(2);
    await pg.query("INSERT INTO products(id,name,source_url) VALUES($1,$2,'https://www.amazon.de/dp/B000000001')",[n,name]);
    const opportunity={product:{name,affiliateUrl:'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21'}};
    await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at) VALUES($1,$2,$3,'k','post','facebook','t',$4,'approved',$5,now(),now())`,[id,n,category,JSON.stringify(opportunity),JSON.stringify({opportunity})]);
    await pg.query(`INSERT INTO publication_requests(id,job_id,platform,status,caption,image_url,content_hash,approver_wa_id,whatsapp_message_id,meta_post_id,permalink,updated_at) VALUES($1,$2,'facebook','published','Text',$3,'h','491234',$4,$4,'https://www.facebook.com/x/posts/1',$5)`,
      [crypto.randomUUID(),id,`https://s.public.blob.vercel-storage.com/generated/facebook/${id}/${'a'.repeat(64)}.png`,`m${n}`,at]);
    return id;
  };
  // Historical product: the Halloween baking mould stays under „Haushalt“ (migration 026 and the new logic do not touch it).
  const history=await add('Halloween Kürbis Silikon Backformen','household','2026-10-01T18:00:00Z');
  const before=(await pg.query('SELECT category,snapshot FROM content_jobs WHERE id=$1',[history])).rows[0];
  const fresh=await add('Silikon Backmatte','cooking_baking','2026-10-02T18:00:00Z');
  await store.createCategory(db,'Reiseideen','x');
  await add('Koffer Set','reiseideen','2026-10-03T18:00:00Z');
  const all=await loadPublishedProducts(db);
  assert.deepEqual(all.items.map(i=>[i.name,i.category,i.categoryLabel]),[['Koffer Set','reiseideen','Reiseideen'],['Silikon Backmatte','cooking_baking','Kochen & Backen'],['Halloween Kürbis Silikon Backformen','household','Haushalt']]);
  assert.deepEqual(all.categories.map(c=>c.label).sort(),['Haushalt','Kochen & Backen','Reiseideen'],'the new category appears as a chip automatically');
  assert.deepEqual((await loadPublishedProducts(db,'reiseideen')).items.map(i=>i.name),['Koffer Set']);
  const after=(await pg.query('SELECT category,snapshot FROM content_jobs WHERE id=$1',[history])).rows[0];
  assert.deepEqual(after,before,'no retroactive re-categorisation');
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM content_jobs WHERE category='household'")).rows[0].n,1);
  assert.ok(fresh);
});

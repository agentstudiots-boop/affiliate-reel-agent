const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {answerWhatsAppConversation,conversationalMessage,conversationalReply}=require('../.test-build/lib/whatsapp/chat');
const {imagePostCommand}=require('../.test-build/lib/whatsapp/start-image-post');

async function fixture(t){
  const pg=new PGlite();t.after(()=>pg.close());
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  await applyMigrations(db);
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  return db;
}

test('natural question and text suggestion route to conversation; explicit gates stay literal',()=>{
  for(const body of ['Gibt es so etwas auch als Whirlpoolmatte?','Freigeben?','Ablehnen?','Schlag mir ein neues Produkt vor','Schreibe einen Posttext über Badewannen'])
    assert.equal(conversationalMessage(body),true,body);
  for(const body of ['Freigeben','Ablehnen','Das ist aber eine Badematte für in die Badewanne','Artikelsuche Whirlpoolmatte'])
    assert.equal(conversationalMessage(body),false,body);
  assert.equal(imagePostCommand('Artikelsuche?'),null);
  assert.equal(imagePostCommand('Artikelsuche Saugroboter?'),null);
});

test('quoted product question is replied once without changing the approval, even on webhook replay',async t=>{
  const db=await fixture(t),id=crypto.randomUUID();
  await db.query("INSERT INTO products(id,name,source_url) VALUES('chat-product','Badewannenmatte','https://www.amazon.de/dp/B0C2C739KY')");
  await db.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
    VALUES($1,'chat-product','home','bath','post','facebook','reference',$2,'awaiting_approval',$3,now(),now())`,
  [id,JSON.stringify({product:{name:'Badewannenmatte',asin:'B0C2C739KY'}}),JSON.stringify({id,status:'awaiting_approval'})]);
  await db.query("INSERT INTO daily_drafts(day,slot,job_id,status,whatsapp_message_id) VALUES((now() AT TIME ZONE 'Europe/Berlin')::date,'manual',$1,'awaiting_approval','wamid.approval')",[id]);
  let generated=0,sent=0;
  const input={id:'wamid.question',from:'491234',body:'Kannst du mir eine Whirlpoolmatte empfehlen?',replyToMessageId:'wamid.approval',payload:{}};
  const options={database:db,reply:async(body,history,product)=>{
    generated++;assert.equal(product,'Badewannenmatte');assert.deepEqual(history,[]);
    return 'Ja, das wäre ein anderes Produkt. Für einen getrennten Auftrag: Artikelsuche Whirlpoolmatte.';
  },send:async()=>{sent++;return 'wamid.chat.reply';}};
  assert.equal(await answerWhatsAppConversation(input,options),true);
  assert.equal(await answerWhatsAppConversation(input,options),true);
  assert.equal(generated,1);assert.equal(sent,1);
  const row=await db.query('SELECT status,whatsapp_message_id FROM daily_drafts WHERE job_id=$1',[id]);
  assert.deepEqual(row.rows,[{status:'awaiting_approval',whatsapp_message_id:'wamid.approval'}]);
  const turn=await db.query('SELECT status,whatsapp_message_id FROM whatsapp_chat_turns WHERE message_id=$1',[input.id]);
  assert.deepEqual(turn.rows,[{status:'sent',whatsapp_message_id:'wamid.chat.reply'}]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM whatsapp_instructions')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
});

test('provider response is bounded and an uncertain POST is never repeated',async t=>{
  const old=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='mock-token';
  t.after(()=>{if(old===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=old;});
  let calls=0;
  const text=await conversationalReply('Hallo?',[],'Badewannenmatte',async(url,options)=>{
    calls++;assert.equal(options.method,'POST');assert.match(url,/gpt-5\.6-terra/);
    const input=JSON.parse(options.body).input;assert.equal(input.max_completion_tokens,550);
    return Response.json({id:'abcdef123456',status:'succeeded',output:['Hallo! ','Was möchtest du wissen?']});
  });
  assert.equal(text,'Hallo! Was möchtest du wissen?');assert.equal(calls,1);
  await conversationalReply('Hallo?',[],'Badewannenmatte',async()=>{calls++;throw Error('unknown result')});
  assert.equal(calls,2);
});

test('one-time cleanup removes old terminal inbox entries but retains audit and current slots',async t=>{
  const db=await fixture(t);
  await db.query("DELETE FROM schema_migrations WHERE name='021_whatsapp_chat.sql'");
  for(const [slot,status,offset] of [['old-rejected','rejected',-2],['old-blocked','needs_input',-1],['today-rejected','rejected',0],['old-open','awaiting_approval',-1]])
    await db.query("INSERT INTO daily_drafts(day,slot,job_id,status) VALUES((now() AT TIME ZONE 'Europe/Berlin')::date+$1::int,$2,$3,$4)",[offset,slot,crypto.randomUUID(),status]);
  await applyMigrations(db);
  const rows=await db.query('SELECT slot FROM daily_drafts ORDER BY slot');
  assert.deepEqual(rows.rows.map(r=>r.slot),['old-open','today-rejected']);
});

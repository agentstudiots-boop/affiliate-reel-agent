const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHmac}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');
const {extractIncomingWhatsAppMessages}=require('../.test-build/lib/whatsapp/security');
const {usableTranscript}=require('../.test-build/lib/whatsapp/transcribe');
const startPost=require('../.test-build/lib/whatsapp/start-image-post');

const env={META_APP_SECRET:'voice-secret',WHATSAPP_PHONE_NUMBER_ID:'123456',WHATSAPP_APPROVER_WA_ID:'491234',WHATSAPP_ACCESS_TOKEN:'wa-voice-token',
  OPENAI_API_KEY:'openai-voice-key',WHATSAPP_ROUTER_ENABLED:'false'};
const AUDIO=Buffer.from('OggS-fake-voice-bytes');

// Real route, real signature check, real voice layer, real transcription client, real text pipeline pieces for the
// searched command. Only network (Graph media, OpenAI, Graph send) and heavy downstream workflows are replaced.
async function fixture(t,{transcripts={},mediaStatus=200,openaiStatus=200,audioBytes=AUDIO}={}){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  t.after(()=>{for(const k of Object.keys(env)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}});
  const log={sent:[],instructions:[],approvals:[],resumes:0,drafts:[],transcribed:0,downloads:0,tokenHosts:[]};
  t.mock.method(global,'fetch',async(url,init={})=>{
    const u=String(url);
    if(u.includes('/messages')){log.sent.push(JSON.parse(init.body).text.body);return new Response(JSON.stringify({messages:[{id:'wamid.out'}]}),{status:200});}
    if(u.startsWith('https://graph.facebook.com/')&&!u.includes('/messages')){
      const id=decodeURIComponent(u.split('/').pop());
      return new Response(JSON.stringify({url:`https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${id}`,mime_type:'audio/ogg; codecs=opus',file_size:audioBytes.length}),{status:mediaStatus});
    }
    if(u.startsWith('https://lookaside.fbsbx.com/')){log.downloads++;log.tokenHosts.push(init.headers.Authorization);return new Response(audioBytes,{status:200});}
    if(u==='https://api.openai.com/v1/audio/transcriptions'){
      log.transcribed++;
      if(openaiStatus!==200)return new Response('{}',{status:openaiStatus});
      return new Response(JSON.stringify({text:transcripts[init.body.get('file').size]??transcripts.default}),{status:200});
    }
    throw new Error('unexpected request '+u);
  });
  const route=loadRoute('app/api/whatsapp/webhook/route.ts',{
    'next/server':{after:()=>{}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/production/repository':{productionRepository:()=>({})},
    '@/lib/automation/continue':{continuePendingReels:async()=>({considered:0,advanced:0,blocked:0}),latestInstagramReelStatus:async()=>'kein Reel',recoverRunwayPreflightIncident:async()=>0},
    '@/lib/whatsapp/recover-instruction':{recoverLatestInstruction:async()=>null},
    '@/lib/whatsapp/content-approval':{handleContentApproval:async m=>{log.approvals.push({body:m.body,replyTo:m.replyToMessageId,id:m.id});return m.body==='Freigabe';},requestContentApproval:async()=>{}},
    '@/lib/whatsapp/process-instruction':{processOperatorInstruction:async m=>{log.instructions.push({body:m.body,replyTo:m.replyToMessageId,id:m.id});return true;}},
    '@/lib/whatsapp/chat':{answerWhatsAppConversation:async()=>false},
    '@/lib/meta/resume-publication':{resumeApprovedDailyPublications:async()=>{log.resumes++;},publicationPreparationFailureText:()=>''},
    '@/lib/meta/instagram-image':{resumeInstagramImages:async()=>{},publishInstagramImage:async()=>{}},
    '@/lib/reporting/whatsapp-status':{latestImagePostsStatus:async()=>'Status-Text'},
    '@/lib/reporting/weekly':{deliverWeeklyReport:async()=>{}},
    '@/lib/daily/draft':{createDailyDraft:async(...a)=>{log.drafts.push(a);return {status:'awaiting_approval',jobId:'new',whatsapp:'approval_sent'};},sendDailyApproval:async()=>true,sendPendingDailyApprovals:async()=>0},
    '@/lib/whatsapp/start-image-post':startPost,
  });
  const payload=(id,audio=true,extra={})=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456'},
    messages:[{id,from:extra.from||'491234',type:audio?'audio':'text',...(audio?{audio:{id:extra.media||'media-'+id.replace(/[^A-Za-z0-9]/g,''),mime_type:'audio/ogg; codecs=opus',voice:true}}:{text:{body:extra.body||'x'}}),...(extra.replyTo?{context:{id:extra.replyTo}}:{})}]}}]}]});
  const post=raw=>route.POST(new Request('https://local.test/api/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':`sha256=${createHmac('sha256',env.META_APP_SECRET).update(raw).digest('hex')}`},body:raw}));
  return {db,pg,log,payload,post};
}
const voiceRow=(f,id)=>f.pg.query('SELECT status,failure,attempts FROM whatsapp_voice_messages WHERE message_id=$1',[id]).then(r=>r.rows[0]);

test('payload extraction: audio keeps media id and reply context, other media types stay ignored',()=>{
  const body=(m)=>({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'1'},messages:[m]}}]}]});
  const [a]=extractIncomingWhatsAppMessages(body({id:'wamid.a',from:'49',type:'audio',audio:{id:'media12345',mime_type:'audio/ogg'},context:{id:'wamid.draft'}}),'1');
  assert.deepEqual(a.audio,{mediaId:'media12345',mimeType:'audio/ogg'});assert.equal(a.replyToMessageId,'wamid.draft');assert.equal(a.body,'');
  assert.equal(extractIncomingWhatsAppMessages(body({id:'wamid.i',from:'49',type:'image',image:{id:'media12345'}}),'1').length,0);
  assert.equal(extractIncomingWhatsAppMessages(body({id:'wamid.b',from:'49',type:'audio',audio:{id:'../etc/passwd'}}),'1').length,0);
  assert.equal(extractIncomingWhatsAppMessages(body({id:'wamid.t',from:'49',type:'text',text:{body:'Hallo'}}),'1')[0].body,'Hallo');
});

test('1. a spoken instruction reaches the normal text pipeline unchanged, with the original message id',async t=>{
  const f=await fixture(t,{transcripts:{default:'Mach den Text etwas kürzer und freundlicher.'}});
  const r1=await f.post(f.payload('wamid.v1'));
  assert.equal(r1.status,200);
  assert.deepEqual(f.log.instructions,[{body:'Mach den Text etwas kürzer und freundlicher.',replyTo:null,id:'wamid.v1'}]);
  assert.match(f.log.sent[0],/Verstanden: „Mach den Text etwas kürzer und freundlicher\.“/);
  assert.equal(f.log.tokenHosts[0],'Bearer wa-voice-token');
  assert.equal((await voiceRow(f,'wamid.v1')).status,'done');
});

test('2. "Artikelsuche [Produkt]" by voice starts exactly one product search',async t=>{
  const f=await fixture(t,{transcripts:{default:'Artikelsuche Saugroboter'}});
  assert.equal((await f.post(f.payload('wamid.v2'))).status,200);
  assert.equal(f.log.drafts.length,1);assert.equal(f.log.drafts[0][3],'Saugroboter');
  assert.equal(f.log.instructions.length,0);
});

test('3. a change request by voice is handled as the same change request as typed text, with reply context',async t=>{
  const f=await fixture(t,{transcripts:{default:'Ändere bitte den Hook, der ist zu werblich.'}});
  await f.post(f.payload('wamid.v3',true,{replyTo:'wamid.draft.1'}));
  assert.deepEqual(f.log.approvals,[{body:'Ändere bitte den Hook, der ist zu werblich.',replyTo:'wamid.draft.1',id:'wamid.v3'}]);
  assert.deepEqual(f.log.instructions,[{body:'Ändere bitte den Hook, der ist zu werblich.',replyTo:'wamid.draft.1',id:'wamid.v3'}]);
});

test('4. "Freigabe" spoken as a reply to a draft is approved against exactly that draft',async t=>{
  const f=await fixture(t,{transcripts:{default:'Freigabe'}});
  await f.post(f.payload('wamid.v4',true,{replyTo:'wamid.draft.2'}));
  assert.deepEqual(f.log.approvals,[{body:'Freigabe',replyTo:'wamid.draft.2',id:'wamid.v4'}]);
  assert.equal(f.log.instructions.length,0);
});

test('5. "Weiter" by voice resumes the existing process exactly like the typed command',async t=>{
  const f=await fixture(t,{transcripts:{default:'Weiter.'}});
  await f.post(f.payload('wamid.v5',true,{replyTo:'wamid.status'}));
  assert.equal(f.log.resumes,1);
  assert.ok(f.log.sent.some(s=>/Status-Text/.test(s)));
  const events=await f.pg.query("SELECT body,reply_to_message_id FROM whatsapp_events WHERE message_id='wamid.v5'");
  assert.equal(events.rows.length,1);assert.equal(events.rows[0].reply_to_message_id,'wamid.status');
});

test('6. unintelligible, empty, hallucinated or failing audio gives feedback and executes nothing',async t=>{
  for(const [name,opts] of [['noise',{transcripts:{default:'Untertitel der Amara.org-Community'}}],['empty',{transcripts:{default:'  '}}],
    ['provider',{openaiStatus:500}],['media',{mediaStatus:404,transcripts:{default:'Freigabe'}}],['toolarge',{audioBytes:Buffer.alloc(5*1024*1024),transcripts:{default:'Freigabe'}}]]){
    const f=await fixture(t,opts);
    const response=await f.post(f.payload('wamid.bad.'+name));
    assert.equal(response.status,200,name);
    assert.equal(f.log.approvals.length+f.log.instructions.length+f.log.drafts.length+f.log.resumes,0,name);
    assert.equal(f.log.sent.length,1,name);assert.match(f.log.sent[0],/Es wurde nichts ausgeführt/,name);
    assert.equal((await voiceRow(f,'wamid.bad.'+name)).status,'failed',name);
    // Meta redelivers: no second download, no second paid transcription, no second notice.
    const before=f.log.transcribed;await f.post(f.payload('wamid.bad.'+name));
    assert.equal(f.log.transcribed,before,name);assert.equal(f.log.sent.length,1,name);
  }
});

test('7. a redelivered voice webhook is transcribed and executed once',async t=>{
  const f=await fixture(t,{transcripts:{default:'Artikelsuche Heizdecke'}});
  const raw=f.payload('wamid.dup');
  await f.post(raw);await f.post(raw);
  assert.equal(f.log.transcribed,1);assert.equal(f.log.downloads,1);assert.equal(f.log.drafts.length,1);
  assert.equal(f.log.sent.filter(s=>/Verstanden/.test(s)).length,1);
});

test('a pipeline failure releases the voice message so the provider retry processes it again',async t=>{
  const f=await fixture(t,{transcripts:{default:'Freigabe'}});
  let boom=true;
  const route=loadRoute('app/api/whatsapp/webhook/route.ts',{
    'next/server':{after:()=>{}},'@/lib/memory/db':{getDatabase:()=>f.db},'@/lib/production/repository':{productionRepository:()=>({})},
    '@/lib/whatsapp/content-approval':{handleContentApproval:async()=>{if(boom)throw new Error('db down');return true;},requestContentApproval:async()=>{}},
    '@/lib/whatsapp/chat':{answerWhatsAppConversation:async()=>false},'@/lib/daily/draft':{sendDailyApproval:async()=>true,sendPendingDailyApprovals:async()=>0,createDailyDraft:async()=>({})},
  });
  const request=()=>{const raw=f.payload('wamid.retry');return new Request('https://local.test/x',{method:'POST',headers:{'x-hub-signature-256':`sha256=${createHmac('sha256',env.META_APP_SECRET).update(raw).digest('hex')}`},body:raw});};
  assert.equal((await route.POST(request())).status,503);
  boom=false;
  assert.equal((await route.POST(request())).status,200);
  assert.equal((await voiceRow(f,'wamid.retry')).status,'done');
});

test('only the operator can spend transcription budget; no audio or transcript is persisted',async t=>{
  const f=await fixture(t,{transcripts:{default:'Freigabe'}});
  await f.post(f.payload('wamid.stranger',true,{from:'499999'}));
  assert.equal(f.log.downloads+f.log.transcribed,0);assert.equal(f.log.approvals.length,0);
  assert.equal((await voiceRow(f,'wamid.stranger')).status,'ignored');
  await f.post(f.payload('wamid.persist'));
  const dump=JSON.stringify((await f.pg.query('SELECT * FROM whatsapp_voice_messages')).rows);
  assert.doesNotMatch(dump,/Freigabe|OggS|media-wamidpersist/);
});

test('text messages still bypass the voice layer completely',async t=>{
  const f=await fixture(t);
  await f.post(f.payload('wamid.text',false,{body:'Mach den Text kürzer'}));
  assert.equal(f.log.instructions[0].body,'Mach den Text kürzer');
  assert.equal(f.log.transcribed,0);assert.equal(f.log.sent.length,0);
  assert.equal((await f.pg.query('SELECT count(*)::int n FROM whatsapp_voice_messages')).rows[0].n,0);
});

test('usableTranscript rejects silence hallucinations and accepts real commands',()=>{
  for(const bad of ['','  ','.','Vielen Dank fürs Zuschauen!','Untertitel der Amara.org-Community','Musik',null,'x'.repeat(2001)])assert.equal(usableTranscript(bad),null,String(bad));
  assert.equal(usableTranscript(' Freigabe. '),'Freigabe.');
});

test('a provider refusal is logged with provider and status, but without keys or content',async t=>{
  const f=await fixture(t,{openaiStatus:401});
  const lines=[];t.mock.method(console,'error',v=>lines.push(String(v)));
  await f.post(f.payload('wamid.diag'));
  const line=lines.find(l=>l.includes('voice_message_failed'));
  assert.match(line,/"code":"provider_failed"/);assert.match(line,/openai http 401/);
  assert.doesNotMatch(line,/openai-voice-key|wa-voice-token/);
});

test('a failed Replicate prediction logs its provider reason without leaking the token',async t=>{
  const {transcribeAudio}=require('../.test-build/lib/whatsapp/transcribe');
  const old={o:process.env.OPENAI_API_KEY,r:process.env.REPLICATE_API_TOKEN};
  delete process.env.OPENAI_API_KEY;process.env.REPLICATE_API_TOKEN='r8_secrettoken123';
  t.after(()=>{if(old.o===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old.o;if(old.r===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=old.r;});
  const request=async()=>new Response(JSON.stringify({id:'abcdefghijkl1',status:'failed',error:'Invalid input: audio_file r8_secrettoken123 unsupported'}),{status:201});
  await assert.rejects(transcribeAudio(AUDIO,'audio/ogg',{request,sleep:async()=>{}}),e=>e.code==='provider_failed'&&/replicate prediction failed: Invalid input/.test(e.detail)&&!/secrettoken/.test(e.detail));
});

test('Replicate E006 on the original label retries the same audio with another label and returns the transcript',async t=>{
  const {transcribeAudio}=require('../.test-build/lib/whatsapp/transcribe');
  const old={o:process.env.OPENAI_API_KEY,r:process.env.REPLICATE_API_TOKEN};
  delete process.env.OPENAI_API_KEY;process.env.REPLICATE_API_TOKEN='r8_token';
  t.after(()=>{if(old.o===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old.o;if(old.r===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=old.r;});
  t.mock.method(console,'warn',()=>{});t.mock.method(console,'info',()=>{});
  const sent=[];
  const request=async(url,init)=>{const input=JSON.parse(init.body).input;sent.push(input.audio_file.slice(0,20));
    return input.audio_file.startsWith('data:audio/ogg')?new Response(JSON.stringify({id:'abcdefghijkl1',status:'failed',error:'The input was invalid (E006)'}),{status:201})
      :new Response(JSON.stringify({id:'abcdefghijkl2',status:'succeeded',output:{text:'Status bitte'}}),{status:201});};
  assert.equal(await transcribeAudio(AUDIO,'audio/ogg; codecs=opus',{request,sleep:async()=>{}}),'Status bitte');
  assert.deepEqual(sent.map(v=>v.slice(0,15)),['data:audio/ogg;','data:audio/mpeg']);
  // an HTTP refusal (wrong model, no credit) is not retried with other labels
  let calls=0;
  await assert.rejects(transcribeAudio(AUDIO,'audio/ogg',{request:async()=>{calls++;return new Response('{}',{status:402});},sleep:async()=>{}}),e=>e.code==='provider_failed');
  assert.equal(calls,1);
});

test('a throttled Replicate account (429, burst 1) waits the advised time before the next attempt',async t=>{
  const {transcribeAudio}=require('../.test-build/lib/whatsapp/transcribe');
  const old={o:process.env.OPENAI_API_KEY,r:process.env.REPLICATE_API_TOKEN};
  delete process.env.OPENAI_API_KEY;process.env.REPLICATE_API_TOKEN='r8_token';
  t.after(()=>{if(old.o===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old.o;if(old.r===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=old.r;});
  t.mock.method(console,'warn',()=>{});t.mock.method(console,'info',()=>{});
  const waits=[];let posts=0;
  const request=async()=>{posts++;
    if(posts===1)return new Response(JSON.stringify({id:'abcdefghijkl1',status:'failed',error:'E006'}),{status:201});
    if(posts===2)return new Response(JSON.stringify({detail:'throttled',retry_after:9}),{status:429});
    return new Response(JSON.stringify({id:'abcdefghijkl3',status:'succeeded',output:{text:'Weiter bitte'}}),{status:201});};
  assert.equal(await transcribeAudio(AUDIO,'audio/ogg',{request,sleep:async ms=>{waits.push(ms)}}),'Weiter bitte');
  assert.deepEqual(waits,[11000,11000]);assert.equal(posts,3);
});

const { approveContent } = require('./helpers/approve-content.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const {PGlite}=require('@electric-sql/pglite');
const {createReplicateImageProvider,DEFAULT_REPLICATE_IMAGE_MODEL}=require('../.test-build/lib/content/providers/replicate-image');
const {imageProviderStatus,getOriginalVisualProvider}=require('../.test-build/lib/content/image-provider');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {publicationRepository}=require('../.test-build/lib/meta/publication-gate');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');

function pngFixture(){
  const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
  const chunk=(type,data)=>{const inner=Buffer.concat([Buffer.from(type),data]);let crc=-1;for(const byte of inner)crc=table[(crc^byte)&255]^(crc>>>8);const len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE((crc^-1)>>>0);return Buffer.concat([len,inner,check])};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1024);ihdr.writeUInt32BE(1280,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.alloc(1280*(1+1024*3)))),chunk('IEND',Buffer.alloc(0))]);
}
const id='abcdefghijklmnop';
const result=(status='succeeded',output='https://replicate.delivery/example.png')=>new Response(JSON.stringify({id,status,output,metrics:{predict_time:12.5}}));
const dbAdapter=pg=>({query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))});
async function setup(){
  const pg=new PGlite();for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db=dbAdapter(pg),memory=memoryRepository(db),repo=publicationRepository(db);
  async function job(){
    const input=opportunitySchema.parse({product:{productVerifiedAt:'2026-09-26T08:00:00.000Z', productVerifiedName:'Kuscheldecke', name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001',price:'',targetGroup:'Haushalte',benefits:'Material und Größe vergleichen',notes:''},useCase:'Ruhiger Abend mit einer Decke auf dem Sofa.',targetPlatform:'facebook',budget:'low'});
    const jobId=crypto.randomUUID();await memory.claim(jobId,input,'reference');await runContentJob(input,{id:jobId,onUpdate:memory.save,loadLearning:memory.learn});return approveContent(db,memory,jobId);
  }
  return {pg,repo,job};
}

test('Replicate takes priority, OpenAI is selected only when the Replicate token is absent',()=>{
  const old={replicate:process.env.REPLICATE_API_TOKEN,openai:process.env.OPENAI_API_KEY,model:process.env.REPLICATE_IMAGE_MODEL};
  try {
    delete process.env.REPLICATE_API_TOKEN;delete process.env.OPENAI_API_KEY;delete process.env.REPLICATE_IMAGE_MODEL;
    assert.equal(imageProviderStatus().configured,false);assert.equal(getOriginalVisualProvider(),null);
    process.env.OPENAI_API_KEY='mock-openai';
    assert.equal(imageProviderStatus().provider,'openai');assert.equal(getOriginalVisualProvider().name,'openai');
    process.env.REPLICATE_API_TOKEN='mock-replicate';
    assert.equal(imageProviderStatus().provider,'replicate');assert.equal(imageProviderStatus().fallback,'openai');
    assert.equal(imageProviderStatus().model,DEFAULT_REPLICATE_IMAGE_MODEL);
    assert.equal(getOriginalVisualProvider().name,'replicate');
    process.env.REPLICATE_IMAGE_MODEL='unsupported/model';
    assert.equal(imageProviderStatus().configured,false);
    assert.equal(getOriginalVisualProvider(),null);
  } finally {for(const [key,name] of [['replicate','REPLICATE_API_TOKEN'],['openai','OPENAI_API_KEY'],['model','REPLICATE_IMAGE_MODEL']]){
    if(old[key]===undefined)delete process.env[name];else process.env[name]=old[key];
  }}
});

test('one Replicate POST, bounded polling, PNG download and Blob upload precede publication',async()=>{
  const {pg,repo,job}=await setup();
  try {
    const approved=await job();let posts=0,gets=0,uploads=0;
    const provider=createReplicateImageProvider('mock-key',DEFAULT_REPLICATE_IMAGE_MODEL,{
      pollIntervalMs:0,
      request:async(url,options)=>{
        if(options.method==='POST'){
          posts++;assert.match(url,/\/v1\/models\/black-forest-labs\/flux-1.1-pro\/predictions$/);
          assert.equal(JSON.parse(options.body).input.aspect_ratio,'4:5');
          assert.equal(JSON.parse(options.body).input.output_format,'png');
          return result('processing',null);
        }
        if(url.includes('/v1/predictions/')){gets++;return result();}
        assert.equal(url,'https://replicate.delivery/example.png');assert.equal(options.redirect,'manual');
        return new Response(pngFixture(),{headers:{'content-type':'image/png'}});
      },
      upload:async(path,bytes,opts)=>{
        uploads++;assert.equal(opts.addRandomSuffix,false);assert.equal(opts.contentType,'image/png');assert.equal(bytes[0],137);
        return {url:`https://test.public.blob.vercel-storage.com/${path}`};
      },
    });
    const claim=await repo.claimVisual(approved.id,DEFAULT_REPLICATE_IMAGE_MODEL,'replicate');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
    const asset=await provider.render(claim.job);
    assert.equal(posts,1);assert.equal(gets,1);assert.equal(uploads,1);
    assert.equal(asset.usage.predictionId,id);assert.equal(asset.usage.predictTimeSeconds,12.5);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
    await assert.rejects(repo.prepareWithVisual(approved.id,'491234',{...asset,provider:'openai'}),/Originalbild fehlt|Bildversuch fehlt/);
    const publication=await repo.prepareWithVisual(approved.id,'491234',asset);
    assert.equal(publication.status,'pending');assert.equal(publication.imageUrl,asset.url);
    const attempt=(await pg.query('SELECT * FROM original_visual_attempts WHERE job_id=$1',[approved.id])).rows[0];
    assert.equal(attempt.provider,'replicate');assert.deepEqual(attempt.usage,{predictionId:id,predictTimeSeconds:12.5});
    assert.equal((await repo.claimVisual(approved.id,DEFAULT_REPLICATE_IMAGE_MODEL,'replicate')).existing.id,publication.id);
    assert.equal(posts,1);
  } finally {await pg.close()}
});

test('failure, timeout, invalid output, invalid PNG and Blob failure never create a publication request or a second POST',async()=>{
  const {pg,repo,job}=await setup();
  try {
    for(const scenario of ['http','timeout','output','mime','blob']){
      const approved=await job();let posts=0,uploads=0;
      const provider=createReplicateImageProvider('mock-key',DEFAULT_REPLICATE_IMAGE_MODEL,{
        timeoutMs:scenario==='timeout'?15:1000,pollIntervalMs:30,
        request:async(url,options)=>{
          if(options.method==='POST'){posts++;return scenario==='http'?new Response('rejected',{status:429}):scenario==='timeout'?result('processing',null):scenario==='output'?result('succeeded','https://evil.example/file.png'):result()}
          if(url.includes('/v1/predictions/'))return result('processing',null);
          return scenario==='mime'?new Response(pngFixture(),{headers:{'content-type':'text/html'}}):new Response(pngFixture(),{headers:{'content-type':'image/png'}});
        },upload:async()=>{uploads++;throw Error('blob unavailable')},
      });
      const claim=await repo.claimVisual(approved.id,DEFAULT_REPLICATE_IMAGE_MODEL,'replicate');
      await assert.rejects(provider.render(claim.job));
      assert.equal(posts,1,scenario);assert.equal(uploads,scenario==='blob'?1:0,scenario);
      assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests WHERE job_id=$1',[approved.id])).rows[0].n,0);
      await assert.rejects(repo.claimVisual(approved.id,DEFAULT_REPLICATE_IMAGE_MODEL,'replicate'),/bereits begonnen/);
    }
  } finally {await pg.close()}
});

test('Replicate HTTP failures are classified without leaking provider response or token',async()=>{
  const {pg,job}=await setup();
  const originalLog=console.error;
  try {
    const approved=await job();
    for(const [status,category] of [[401,'auth'],[402,'billing'],[403,'access'],[404,'model_or_endpoint'],[422,'request_schema'],[429,'rate_limit'],[503,'provider_error']]){
      let posts=0,logged='';
      console.error=value=>{logged=value};
      const provider=createReplicateImageProvider('private-test-token',DEFAULT_REPLICATE_IMAGE_MODEL,{
        request:async(url,options)=>{
          assert.equal(options.method,'POST');posts++;
          return new Response(JSON.stringify({detail:'private-test-token prompt user secret; aspect_ratio invalid'}),{status});
        },
      });
      await assert.rejects(provider.render(approved),/Kein automatischer zweiter Versuch/);
      const record=JSON.parse(logged);
      assert.equal(posts,1);assert.equal(record.httpStatus,status);assert.equal(record.category,category);
      assert.equal(record.predictionId,null);assert.equal(record.phase,'create');
      assert.doesNotMatch(logged,/private-test-token|user secret/);
      if(status===422)assert.equal(record.detail,'Ungültiges Feld: aspect_ratio');
    }
  } finally {console.error=originalLog;await pg.close()}
});

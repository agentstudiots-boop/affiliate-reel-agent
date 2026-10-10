const fs=require('node:fs');
const sharp=require('sharp');
const {PGlite}=require('@electric-sql/pglite');
const {approveContent}=require('./approve-content.cjs');
const {grantAffiliateImageGate}=require('./affiliate-gate.cjs');
const {memoryRepository}=require('../../.test-build/lib/memory/repository');
const {productionRepository}=require('../../.test-build/lib/production/repository');
const {publicationRepository}=require('../../.test-build/lib/meta/publication-gate');
const {runContentJob}=require('../../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../../.test-build/lib/content/schema');

// Approved affiliate image post (Facebook published) with an inert Instagram Graph; shared by the Instagram approval tests.
async function fixture(t,{grant=true}={}){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  const memory=memoryRepository(db),publication=publicationRepository(db),inbound=productionRepository(db);
  const opportunity=opportunitySchema.parse({product:{productVerifiedAt:'2026-09-26T08:00:00.000Z',productVerifiedName:'Kuscheldecke',name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21',price:'',targetGroup:'Haushalte',benefits:'Größe und Material vergleichen',notes:''},useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',targetPlatform:'facebook',budget:'low'});
  const id=crypto.randomUUID();await memory.claim(id,opportunity,'reference');
  await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});await approveContent(db,memory,id);
  const pending=await publication.prepare(id,'491234');await publication.claimImage(pending.id);
  await publication.bindImage(pending.id,`https://x.public.blob.vercel-storage.com/generated/facebook/${id}/${'a'.repeat(64)}.png`);
  await publication.claimWhatsAppSend(pending.id);await publication.bindMessage(pending.id,'wamid.pub');
  await inbound.applyIncomingWhatsApp({id:'wamid.ok',from:'491234',body:'Freigeben',replyToMessageId:'wamid.pub',payload:{}});
  const claimed=await publication.claimPublish(pending.id);await publication.published(claimed.id,'fb123','https://www.facebook.com/x/posts/1');
  // Since the last-gate check every Instagram publish step needs the central approval + open attempt the shared distribution layer creates.
  if(grant)await grantAffiliateImageGate(db,claimed.id,'491234');
  const png=await sharp({create:{width:800,height:1000,channels:4,background:'#336699'}}).png().toBuffer();
  const calls={create:[],publish:0,status:0,notes:[],uploads:[]};
  const graphWith=(over={})=>async()=>({
    createImage:async(url,caption)=>{calls.create.push({url,caption});if(over.createError)throw over.createError;return '111';},
    status:async()=>{calls.status++;return over.statuses?.shift()||'FINISHED';},
    publish:async()=>{calls.publish++;if(over.publishError)throw over.publishError;return '222';},
    permalink:async()=>'https://www.instagram.com/p/abc/',
  });
  const deps=(over={})=>({db,graph:graphWith(over),send:async text=>{calls.notes.push(text);return 'wamid.n';},sleep:async()=>{},
    loadImage:async()=>over.png||png,upload:async(path,bytes)=>{calls.uploads.push({path,bytes});return `https://x.public.blob.vercel-storage.com/${path}`;}});
  return {db,pg,id,publicationId:claimed.id,calls,deps,png};
}


module.exports={fixture};

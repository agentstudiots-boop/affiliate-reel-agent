const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {evaluateImageCreativeQuality}=require('../.test-build/lib/content/creative-quality');
const {imageProviderStatus,getOriginalVisualProvider}=require('../.test-build/lib/content/image-provider');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {imageSchema,opportunitySchema}=require('../.test-build/lib/content/schema');
const {facebookPagePublicationError}=require('../.test-build/lib/meta/publication-eligibility');
const {publicationRepository}=require('../.test-build/lib/meta/publication-gate');
const {memoryRepository}=require('../.test-build/lib/memory/repository');

function baseImage(changes={}){
  return imageSchema.parse({
    format:'image',layout:'single',title:'Kuscheldecke',hook:'Gemütlich vergleichen',
    useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',
    productIntegration:'Kuscheldecken anhand sinnvoller Kriterien vergleichen.',
    visualConcept:{
      kind:'lifestyle',
      mainIdea:'Gemütliche Wohnzimmerszene mit neutraler Decke auf einem Sofa und warmem Abendlicht.',
      productRelation:'Die Produktkategorie wird sichtbar im realistischen Wohnalltag eingesetzt.',
      everydaySituation:'Ein ruhiger Herbstabend auf dem Sofa im Wohnzimmer.',
      sourceKind:'search',representation:'generic_category',originality:'original_editorial',visualWeight:'image_led'
    },
    slides:[{
      headline:'Welche Decke passt zu deinem Alltag?',copy:'Material, Größe und Pflege anhand der Herstellerangaben vergleichen.',
      visual:'Gemütliche Wohnzimmerszene mit einer neutralen, unmarkierten Decke auf dem Sofa und warmem Abendlicht.',
      prompt:'Originelles redaktionelles Lifestyle-Visual im Hochformat 4:5 mit neutraler Decke, Sofa, warmem Abendlicht, glaubwürdiger Textur und freier Fläche für später gesetzte Schrift. Keine Logos, keine Shop-Oberfläche, keine exakte Modellnachbildung.',
      alt:'Neutrale Kuscheldecke auf einem Sofa in warmer Wohnatmosphäre.'
    }],
    caption:'Werbung | Ein ruhiger Abend auf dem Sofa: Bei einer Kuscheldecke lohnt sich ein Blick auf Material, Größe und Pflege.',
    cta:'Verlinkte Auswahl anhand der Kriterien vergleichen.',disclosure:'Werbung | Affiliate-Link',
    checks:['Keine Händlerbilder oder Modellbehauptungen verwenden.'],
    ...changes
  });
}

test('pure text/symbol fallback creative is blocked',()=>{
  const weak=baseImage({
    visualConcept:undefined,
    slides:[{headline:'Kuscheldecke',copy:'Vergleichen',visual:'Symbolgrafik mit grünem Hintergrund und Produktname.',
      prompt:'Reine Textkarte mit Typografie und Platzhalter.',alt:'Symbolgrafik'}]
  });
  const result=evaluateImageCreativeQuality(weak);
  assert.equal(result.passed,false);
  assert.match(result.issues.join(' '),/visuelles Konzept|Symbol|Textkarte|Platzhalter/i);
});

test('concrete lifestyle visual brief passes the creative quality gate',()=>{
  const result=evaluateImageCreativeQuality(baseImage());
  assert.equal(result.passed,true,JSON.stringify(result));
  assert.ok(result.score>=75);
});

test('internal briefing text cannot pass as a public image caption',()=>{
  const result=evaluateImageCreativeQuality(baseImage({caption:'Werbung | Kuscheldecke für An einem kühlen Herbstabend: Diese redaktionelle Übersicht ordnet Anwendung und Kaufkriterien ein.'}));
  assert.equal(result.passed,false);
  assert.match(result.issues.join(' '),/interne Prüfhinweise/);
});

test('search result source stays categorical and produces an original carousel brief',async()=>{
  const opportunity=opportunitySchema.parse({
    product:{name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/s?k=Kuscheldecke',affiliateUrl:'',price:'',targetGroup:'Haushalte',benefits:'Größe und Material vergleichen',notes:''},
    useCase:'An einem kühlen Herbstabend liegt eine neutrale Kuscheldecke auf dem Sofa. Eine Person sitzt mit Tee im warmen Licht.',category:'home_living',targetPlatform:'facebook',budget:'low'
  });
  const job=await runContentJob(opportunity);
  assert.equal(job.content.format,'image');
  assert.equal(job.content.visualConcept.sourceKind,'search');
  assert.equal(job.content.visualConcept.representation,'generic_category');
  assert.equal(job.content.layout,'carousel');
  assert.equal(job.opportunity.category,'home_living');
  assert.match(job.content.caption,/Feierabend, Tee.*Größe, Material und Pflege/);
  assert.doesNotMatch(job.content.caption,/Kuscheldecke für An einem|redaktionelle Übersicht|neutral/i);
  assert.match(job.content.cta,/Auswahl ansehen/);
  assert.doesNotMatch([job.content.title,job.content.hook,job.content.caption,...job.content.slides.map(s=>s.copy)].join(' '),/beste(?:r|s)?\b/i);
  assert.doesNotMatch(job.content.slides.map(s=>s.prompt).join(' '),/Amazon[-\s]?(?:UI|Screenshot|Bild)/i);
  assert.equal(job.review.passed,true,JSON.stringify(job.review));
});

test('single product page does not turn unverified benefits into model claims',async()=>{
  const opportunity=opportunitySchema.parse({
    product:{name:'Kuscheldecke Modell X',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'',price:'',targetGroup:'Haushalte',benefits:'angeblich wasserdicht und selbstheizend',notes:''},
    useCase:'Eine Decke für einen ruhigen Abend auf dem Sofa auswählen.',targetPlatform:'facebook',budget:'low',verifiedFacts:[]
  });
  const job=await runContentJob(opportunity);
  assert.equal(job.content.format,'image');
  assert.equal(job.content.visualConcept.sourceKind,'product');
  assert.equal(job.content.visualConcept.representation,'generic_category');
  const publicCopy=[job.content.caption,...job.content.slides.flatMap(s=>[s.headline,s.copy])].join(' ');
  assert.doesNotMatch(publicCopy,/wasserdicht|selbstheizend/i);
  assert.match(job.content.caption,/verlinkten Produktseite/);
});

test('missing image provider cannot silently fall back to the typographic card',()=>{
  const previous={replicate:process.env.REPLICATE_API_TOKEN,openai:process.env.OPENAI_API_KEY};
  try {
    delete process.env.REPLICATE_API_TOKEN;delete process.env.OPENAI_API_KEY;
    const status=imageProviderStatus();
    assert.equal(status.configured,false);
    assert.equal(status.provider,null);
    assert.equal(getOriginalVisualProvider(),null);
    assert.match(status.reason,/OPENAI_API_KEY/i);
  } finally {
    if(previous.replicate===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=previous.replicate;
    if(previous.openai===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous.openai;
  }
});

test('publication eligibility rejects a legacy weak image before a publication request can be created',()=>{
  const opportunity=opportunitySchema.parse({
    product:{name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/s?k=Kuscheldecke',affiliateUrl:'https://www.amazon.de/s?k=Kuscheldecke',price:'',targetGroup:'Haushalte',benefits:'vergleichen',notes:''},
    useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',targetPlatform:'facebook'
  });
  const weak=baseImage({
    visualConcept:undefined,
    layout:'single',
    slides:[{headline:'Kuscheldecke',copy:'Vergleichen',visual:'Symbolgrafik mit Produktname und grünem Hintergrund.',
      prompt:'Typografische Textkarte als Platzhalter.',alt:'Symbolgrafik'}]
  });
  const job={
    version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    status:'approved',mode:'reference',opportunity,events:[],revisions:0,modelCalls:0,totalTokens:0,
    content:weak,marketing:{primary:'Facebook Post',rationale:'test',audience:'Haushalte',adaptation:'test',linkPlacement:'test',conversionHypothesis:'test',metrics:['a','b'],publishingChecks:['a','b']}
  };
  assert.match(facebookPagePublicationError(job),/nicht veröffentlichungsreif|visuelles Konzept|Symbol/i);
});


test('creative quality gate prevents creation of a publication request in the database',async()=>{
  const pg=new PGlite();
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  try{
    for(const file of ['001_memory.sql','002_production_gates.sql','003_faceless_so.sql','004_daily_drafts.sql','005_publication_gate.sql','006_daily_notification.sql','007_publication_revisions.sql','008_weekly_reports.sql']){
      await pg.exec(fs.readFileSync(`db/migrations/${file}`,'utf8'));
    }
    const opportunity=opportunitySchema.parse({
      product:{name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/s?k=Kuscheldecke',affiliateUrl:'https://www.amazon.de/s?k=Kuscheldecke',price:'',targetGroup:'Haushalte',benefits:'Größe und Material vergleichen',notes:''},
      useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',targetPlatform:'facebook',budget:'low'
    });
    const id=crypto.randomUUID();
    await memoryRepository(db).claim(id,opportunity,'reference');
    const now=new Date().toISOString();
    const weakJob={
      version:1,id,createdAt:now,updatedAt:now,status:'approved',mode:'reference',opportunity,events:[],revisions:0,modelCalls:0,totalTokens:0,
      content:baseImage({
        visualConcept:undefined,
        slides:[{headline:'Kuscheldecke',copy:'Vergleichen',visual:'Symbolgrafik mit grünem Hintergrund und Produktname.',
          prompt:'Reine Textkarte mit Typografie und Platzhalter.',alt:'Symbolgrafik'}]
      }),
      marketing:{primary:'Facebook Post',rationale:'test',audience:'Haushalte',adaptation:'test',linkPlacement:'test',conversionHypothesis:'test',metrics:['a','b'],publishingChecks:['a','b']}
    };
    await pg.query("UPDATE content_jobs SET status='approved',snapshot=$2 WHERE id=$1",[id,JSON.stringify(weakJob)]);
    const publication=publicationRepository(db);
    await assert.rejects(publication.prepare(id,'491234'),/nicht veröffentlichungsreif|visuelles Konzept|Symbol/i);
    const count=await pg.query("SELECT count(*)::int AS n FROM publication_requests WHERE job_id=$1",[id]);
    assert.equal(count.rows[0].n,0);
  }finally{
    await pg.close();
  }
});

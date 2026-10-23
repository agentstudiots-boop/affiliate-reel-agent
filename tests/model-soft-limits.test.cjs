// DIAG-MODEL stage B: a too-long free-text field the schema names as soft is cut at a word boundary to the schema's own
// limit instead of discarding the whole answer. Everything else is rejected as before; published texts are never cut.
// Real generator and schemas, only the Replicate exchange is replaced.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {z}=require('zod');
const {createGenerator}=require('../.test-build/lib/content/model');
const {cutAtWord,softTextLimits,softTextPaths,trimSoftLimits}=require('../.test-build/lib/content/soft-limits');
const {strategicVerdictSchema,combineVerdicts}=require('../.test-build/lib/content/strategy');
const {imageSchema,textSchema,videoSchema}=require('../.test-build/lib/content/schema');
const {setModelCallStore}=require('../.test-build/lib/observability/model-calls');

const metrics={input_token_count:900,output_token_count:120,predict_time:2.5};
const provider=output=>async(url,init)=>new Response(JSON.stringify({id:'abcdefghijkl1234',status:'succeeded',output:JSON.stringify(output),metrics}),{status:init&&init.method==='POST'?201:200});

async function generate(agent,schema,answer){
  const logs=[],calls=[];
  const info=console.info,warn=console.warn,token=process.env.REPLICATE_API_TOKEN;
  console.info=line=>logs.push(String(line));console.warn=line=>logs.push(String(line));
  process.env.REPLICATE_API_TOKEN='test-token';
  setModelCallStore(async call=>{calls.push(call);});
  try{
    const result=await createGenerator({mode:'ai',request:provider(answer),minIntervalMs:0})(agent,'Test',{},schema,()=>{throw new Error('no reference');})
      .then(value=>({value}),error=>({error}));
    return {...result,calls,logs:logs.map(line=>{try{return JSON.parse(line);}catch{return {raw:line};}})};
  }finally{
    console.info=info;console.warn=warn;setModelCallStore(null);
    if(token===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=token;
  }
}

const words=(n,word='Begründung')=>Array.from({length:n},(_,i)=>`${word}${i}`).join(' ');
const verdict=reason=>({decision:'accept',reason,reachPotential:70,trustRisk:false,betterChanceHint:null});

test('only the proven soft fields are registered; published texts are never soft',()=>{
  assert.deepEqual(softTextPaths(strategicVerdictSchema),['reason']);
  assert.deepEqual(softTextPaths(imageSchema),['imageSpec.composition']);
  for(const schema of [textSchema,videoSchema])assert.deepEqual(softTextPaths(schema),[]);
  for(const path of softTextPaths(imageSchema))assert.doesNotMatch(path,/caption|slides|body|disclosure|cta|hook|title/);
});

test('cutAtWord stays within the limit, ends on a whole word and never splits a surrogate pair',()=>{
  assert.equal(cutAtWord('kurz',10),'kurz');
  assert.equal(cutAtWord('eins zwei drei vier',12),'eins zwei');
  assert.equal(cutAtWord('eins, zwei – drei',13),'eins, zwei');
  assert.equal(cutAtWord('a'.repeat(30),10),'a'.repeat(10));                 // no boundary: hard cut at the limit
  const emoji=cutAtWord('x'.repeat(9)+'😀'+'y',10);
  assert.equal(emoji,'x'.repeat(9));
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji));
  for(const max of [5,17,240,600]){const cut=cutAtWord(words(200),max);assert.ok(cut.length<=max&&cut.length>0,String(max));}
});

test('a strategy verdict with a too-long reason is kept: reason cut to 600 at a word boundary, call ok, only paths logged',async()=>{
  const long=words(120);
  assert.ok(long.length>600);
  const {value,error,calls,logs}=await generate('orchestrator',strategicVerdictSchema,verdict(long));
  assert.equal(error,undefined);
  assert.ok(value.reason.length<=600&&long.startsWith(value.reason));
  assert.match(value.reason,/\d$/);                                      // ends on a whole word
  assert.deepEqual([value.decision,value.reachPotential],['accept',70]);
  assert.equal(calls.length,1);assert.equal(calls[0].ok,true);
  const event=logs.find(l=>l.event==='editorial_model_soft_trim');
  assert.deepEqual(event,{event:'editorial_model_soft_trim',agent:'orchestrator',model:'openai/gpt-4.1',paths:['reason']});
  assert.ok(!JSON.stringify(logs).includes('Begründung1'),'no answer text in the logs');
  // Downstream unchanged: the combined reason is still bounded by 600.
  assert.ok(combineVerdicts({...verdict('Konkreter Anlass'),reachPotential:80},value).reason.length<=600);
});

test('any other violation still rejects the whole answer (no partial rescue, no foreign fields cut)',async()=>{
  for(const answer of [
    {...verdict(words(120)),reachPotential:200},                           // soft overshoot plus a hard error
    {...verdict('kurz'),betterChanceHint:words(60)},                       // too long, but not a soft field
    {...verdict(words(120)),extra:'x'},                                    // strict object: unknown key
    {...verdict(''),},                                                     // too short is not trimmed into validity
  ]){
    const {error,calls,logs}=await generate('orchestrator',strategicVerdictSchema,answer);
    assert.ok(error,JSON.stringify(Object.keys(answer)));
    assert.equal(calls[0].ok,false);assert.equal(calls[0].errorClass,'schema_violation');
    assert.ok(!logs.some(l=>l.event==='editorial_model_soft_trim'));
  }
});

test('a soft path only applies to the schema it is registered on',()=>{
  const other=z.object({reason:z.string().max(5)});
  const result=other.safeParse({reason:'viel zu lang'});
  assert.equal(trimSoftLimits(other,{reason:'viel zu lang'},result.error),null);
  const own=softTextLimits(z.object({items:z.array(z.object({note:z.string().max(8)}))}),['items.*.note']);
  const value={items:[{note:'kurz'},{note:'deutlich zu lang'}]};
  const trimmed=trimSoftLimits(own,value,own.safeParse(value).error);
  assert.deepEqual(trimmed,{value:{items:[{note:'kurz'},{note:'deutlich'}]},paths:['items.*.note']});
  assert.equal(value.items[1].note,'deutlich zu lang','the original answer is not mutated');
});

test('an image plan with a too-long imageSpec.composition is kept; caption and slides are never cut',async()=>{
  const base={
    format:'image',layout:'single',title:'Kuscheldecke',hook:'Gemütlich vergleichen',
    useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',
    productIntegration:'Kuscheldecken anhand sinnvoller Kriterien vergleichen.',
    slides:[{headline:'Welche Decke passt zu deinem Alltag?',copy:'Material, Größe und Pflege anhand der Herstellerangaben vergleichen.',
      visual:'Gemütliche Wohnzimmerszene mit einer neutralen, unmarkierten Decke auf dem Sofa und warmem Abendlicht.',
      prompt:'Originelles redaktionelles Lifestyle-Visual im Hochformat 4:5 mit neutraler Decke, Sofa, warmem Abendlicht und glaubwürdiger Textur.',
      alt:'Neutrale Kuscheldecke auf einem Sofa in warmer Wohnatmosphäre.'}],
    caption:'Werbung | Ein ruhiger Abend auf dem Sofa: Bei einer Kuscheldecke lohnt sich ein Blick auf Material, Größe und Pflege.',
    cta:'Verlinkte Auswahl anhand der Kriterien vergleichen.',disclosure:'Werbung | Affiliate-Link',
    checks:['Keine Händlerbilder oder Modellbehauptungen verwenden.'],
    imageSpec:{content_type:'affiliate_image',subject:'Kuscheldecke auf dem Sofa',primary_object:'Kuscheldecke',primary_object_terms:['decke'],
      primary_object_required:true,primary_object_prominence:'dominant',required_objects:['sofa'],forbidden_objects:['logo'],
      composition:words(40,'Szene'),style:'warm, redaktionell',aspect_ratio:'4:5',platforms:['facebook'],
      commercial_intent:'Kriterien für die Auswahl zeigen',product_reference_required:false,representation:'generic_category',
      edit_mode:'regenerate',change_instructions:[]},
  };
  assert.ok(base.imageSpec.composition.length>240);
  assert.ok(imageSchema.safeParse(base).success===false,'precondition: the uncut plan is invalid');
  const {value,error,calls}=await generate('image',imageSchema,base);
  assert.equal(error,undefined);
  assert.ok(value.imageSpec.composition.length<=240&&base.imageSpec.composition.startsWith(value.imageSpec.composition));
  assert.equal(value.caption,base.caption);assert.deepEqual(value.slides,base.slides);
  assert.equal(calls[0].ok,true);
  // A too-long caption (published text) is never shortened, even together with a soft overshoot.
  const rejected=await generate('image',imageSchema,{...base,caption:'Werbung | '+words(400,'Text')});
  assert.ok(rejected.error);assert.equal(rejected.calls[0].errorClass,'schema_violation');
});

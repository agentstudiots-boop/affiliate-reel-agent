const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendStoryHandoff } = require('../.test-build/lib/meta/story-handoff');

test('one approved Facebook publication hands its exact product link and original image to both story apps', async () => {
  const id = crypto.randomUUID();
  const asin = 'B0D9YQR9CT';
  const product = { name:'Kürbisschnitzset', productVerifiedName:'Kürbisschnitzset', productVerifiedAt:new Date().toISOString(),
    asin, sourceUrl:`https://www.amazon.de/dp/${asin}`,productUrl:`https://www.amazon.de/dp/${asin}`,
    affiliateUrl:`https://www.amazon.de/dp/${asin}?tag=alltaeglichle-21`, trackingId:'alltaeglichle-21',
    price:'',targetGroup:'Familien',benefits:'Eignung prüfen',notes:'' };
  const snapshot = { version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    mode:'reference', status:'approved',opportunity:{product,category:'home_living',useCaseKey:'general',
      targetPlatform:'facebook',useCase:'Kürbis in der Familie gemeinsam gestalten.',trend:'',goal:'education',budget:'low',verifiedFacts:[]},
    events:[],revisions:0,modelCalls:0,totalTokens:0 };
  let published = false, claimed = false;
  const sql = { query: async query => {
    if (query.includes('information_schema.columns')) return {rows:[{slots:true,stories:true}]};
    if (query.startsWith('INSERT INTO story_handoffs')) return {rows: published && !claimed ? (claimed=true,[{publication_id:id}]) : []};
    if (query.startsWith('SELECT p.image_url')) return {rows:[{image_url:'https://assets.public.blob.vercel-storage.com/approved.png',snapshot}]};
    if (query.startsWith('UPDATE story_handoffs')) return {rows:[]};
    throw Error(`Unexpected SQL ${query}`);
  } };
  const messages=[];
  const send=async text=>{messages.push(text);return 'wamid.story';};
  assert.equal(await sendStoryHandoff(id,sql,send),false);
  published=true;
  assert.equal(await sendStoryHandoff(id,sql,send),true);
  assert.equal(await sendStoryHandoff(id,sql,send),false);
  assert.equal(messages.length,1);
  assert.match(messages[0],/Facebook und Instagram/);
  assert.ok(messages[0].includes(product.affiliateUrl));
  assert.match(messages[0],/Link-Sticker/);
  assert.match(messages[0],/Keine Story wurde automatisch gepostet/);
});

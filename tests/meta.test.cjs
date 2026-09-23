const {test}=require('node:test');const assert=require('node:assert/strict');
const {checkMetaConnection,publicMetaReport}=require('../.test-build/lib/meta/connection');
const {prepareReelPublication}=require('../.test-build/lib/meta/publishing-plan');
const config={token:'test-token'};
const scopes=['instagram_basic','pages_read_engagement','instagram_content_publish'];
function fixture(changes={}){
 const calls=[];
 const transport=async(url,options)=>{
  const u=new URL(url),path=u.pathname.replace('/v25.0/',''),fields=u.searchParams.get('fields');calls.push(path);
  assert.equal(u.origin,'https://graph.facebook.com');assert.equal(options.method,'GET');assert.ok(!u.toString().includes(config.token));assert.equal(options.headers.Authorization,'Bearer '+config.token);
  const defaults={'me:id,name':{id:'111',name:'affiliatecontentsystem'},'me/permissions:null':{data:scopes.map(permission=>({permission,status:'granted'}))},'111/assigned_pages:id,name':{data:[{id:'222',name:'Alltäglich leichter'}]},'me/accounts:id,name':{data:[{id:'222',name:'Alltäglich leichter'}]},'222:id,name':{id:'222',name:'Alltäglich leichter'},'222:instagram_business_account':{instagram_business_account:{id:'333'}},'333:id,username':{id:'333',username:'alltaeglich.leichter'},'333/content_publishing_limit:config,quota_usage':{data:[{quota_usage:0}]}};
  const key=path+':'+fields,payload=Object.hasOwn(changes,key)?changes[key]:defaults[key];assert.ok(payload,'unexpected '+key);
  if(payload instanceof Error)throw payload;return {ok:!payload.error,status:payload.error?400:200,json:async()=>payload};
 };return {transport,calls};
}
test('discovers assets, verifies linkage, reads publishing status, never writes or exposes IDs/tokens',async()=>{
 const f=fixture(),r=await checkMetaConnection(config,f.transport);assert.equal(r.status,'connected');assert.equal(r.connectionOk,true);assert.equal(r.publishingReadCheck,true);assert.deepEqual(r.resolved,{pageId:'222',instagramId:'333'});
 const output=JSON.stringify(publicMetaReport(r));for(const secret of ['test-token','222','333'])assert.ok(!output.includes(secret));assert.equal(publicMetaReport(r).publishingEnabled,false);assert.ok(f.calls.length<=14);
});
test('missing token and invalid configuration make no network calls',async()=>{const fail=()=>{throw Error('unexpected');};assert.equal((await checkMetaConnection({},fail)).status,'token_missing');assert.equal((await checkMetaConnection({...config,pageId:'bad'},fail)).status,'configuration_error');});
for(const [name,error,status] of [['expired',{code:190,error_subcode:463},'token_expired'],['invalid',{code:190},'token_invalid'],['permission',{code:200},'missing_permission'],['rate',{code:4},'rate_limited']])test(name+' classified without raw provider errors or retries',async()=>{
 const f=fixture({'me:id,name':{error:{...error,message:'secret test-token'}}}),r=await checkMetaConnection(config,f.transport);assert.equal(r.status,status);assert.ok(!JSON.stringify(r).includes('test-token'));assert.equal(f.calls.length,1);
});
test('distinguishes missing page, missing link, unreachable Instagram and wrong identity',async()=>{
 for(const [changes,status] of [[{'111/assigned_pages:id,name':{data:[]},'me/accounts:id,name':{data:[]}},'page_unreachable'],[{'222:instagram_business_account':{instagram_business_account:null}},'instagram_not_linked'],[{'333:id,username':{error:{code:100,error_subcode:33}}},'instagram_unreachable'],[{'333:id,username':{id:'333',username:'someone.else'}},'identity_mismatch'],[{'me:id,name':{id:'111',name:'Personal account'}},'identity_mismatch']])assert.equal((await checkMetaConnection(config,fixture(changes).transport)).status,status);
});
test('falls back to accounts; unsupported permission inspection remains unknown',async()=>{const f=fixture({'111/assigned_pages:id,name':{error:{code:100}},'me/permissions:null':{error:{code:100}}});const r=await checkMetaConnection(config,f.transport);assert.equal(r.status,'connected');assert.ok(r.steps.some(s=>s.stage==='permissions'&&s.result==='unknown'));assert.ok(f.calls.includes('me/accounts'));});
test('missing publishing scope preserves successful account-read diagnosis',async()=>{const f=fixture({'me/permissions:null':{data:scopes.slice(0,2).map(permission=>({permission,status:'granted'}))}});const r=await checkMetaConnection(config,f.transport);assert.equal(r.status,'missing_permission');assert.equal(r.connectionOk,true);assert.deepEqual(r.missingPermissions,['instagram_content_publish']);});
test('configured IDs must match linkage; ambiguous page names fail',async()=>{assert.equal((await checkMetaConnection({...config,pageId:'222',instagramId:'444'},fixture().transport)).status,'identity_mismatch');const f=fixture({'111/assigned_pages:id,name':{data:[{id:'222',name:'Alltäglich leichter'},{id:'444',name:'Alltäglich leichter'}]}});assert.equal((await checkMetaConnection(config,f.transport)).status,'page_ambiguous');});
test('network failure is not misreported as invalid token',async()=>{const r=await checkMetaConnection(config,fixture({'me:id,name':Error('network test-token')}).transport);assert.equal(r.status,'service_unavailable');assert.ok(!JSON.stringify(r).includes('test-token'));});
test('publishing plan cannot publish and rejects insecure media URLs',()=>{const input={jobId:crypto.randomUUID(),contentId:'content-1',instagramUserId:'333',videoUrl:'https://example.org/video.mp4',assetSha256:'a'.repeat(64),caption:'Werbung | Affiliate-Link'};const r=prepareReelPublication(input);assert.equal(r.state,'awaiting_approval');assert.equal(r.publishingEnabled,false);assert.equal(r.approvalRequired,true);assert.throws(()=>prepareReelPublication({...input,videoUrl:'http://example.org/video.mp4'}));});

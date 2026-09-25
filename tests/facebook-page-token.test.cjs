const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pagePublishingToken}=require('../.test-build/lib/meta/connection');

test('derives and verifies the Page token with GET requests only',async()=>{
  const old=process.env.META_PAGE_ACCESS_TOKEN;delete process.env.META_PAGE_ACCESS_TOKEN;
  try{
    const calls=[];
    const transport=async(url,options)=>{
      const path=new URL(url).pathname;calls.push({path,method:options.method,auth:options.headers.Authorization});
      return new Response(JSON.stringify(path.endsWith('/123')?{id:'123',access_token:'page-token'}:{id:'123'}));
    };
    const result=await pagePublishingToken('123',{token:'system-token',version:'v25.0'},transport);
    assert.deepEqual(result,{status:'ready',source:'derived',token:'page-token'});
    assert.deepEqual(calls.map(call=>call.method),['GET','GET']);
    assert.deepEqual(calls.map(call=>call.auth),['Bearer system-token','Bearer page-token']);
  }finally{if(old===undefined)delete process.env.META_PAGE_ACCESS_TOKEN;else process.env.META_PAGE_ACCESS_TOKEN=old;}
});

test('missing or wrong Page token blocks publication before a POST',async()=>{
  const old=process.env.META_PAGE_ACCESS_TOKEN;delete process.env.META_PAGE_ACCESS_TOKEN;
  try{
    const missing=await pagePublishingToken('123',{token:'system-token'},async()=>new Response(JSON.stringify({id:'123'})));
    assert.deepEqual(missing,{status:'missing',source:'derived'});
    process.env.META_PAGE_ACCESS_TOKEN='wrong-page-token';
    const wrong=await pagePublishingToken('123',{token:'system-token'},async(url,options)=>{
      assert.equal(options.method,'GET');assert.equal(new URL(url).pathname,'/v25.0/me');
      return new Response(JSON.stringify({id:'456'}));
    });
    assert.deepEqual(wrong,{status:'invalid',source:'configured'});
  }finally{if(old===undefined)delete process.env.META_PAGE_ACCESS_TOKEN;else process.env.META_PAGE_ACCESS_TOKEN=old;}
});

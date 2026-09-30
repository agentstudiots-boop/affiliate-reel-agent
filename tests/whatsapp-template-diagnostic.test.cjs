const {test}=require('node:test');
const assert=require('node:assert/strict');
const loadRoute=require('./helpers/load-route.cjs');

test('connection check reports the daily template language, status and category read-only',async t=>{
  const saved={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);});
  Object.assign(process.env,{WHATSAPP_ACCESS_TOKEN:'x'.repeat(150),WHATSAPP_PHONE_NUMBER_ID:'111',WHATSAPP_BUSINESS_ACCOUNT_ID:'222',
    WHATSAPP_DAILY_TEMPLATE_NAME:'content_entwurf',WHATSAPP_DAILY_TEMPLATE_LANGUAGE:'de'});
  const {checkWhatsAppConnection}=loadRoute('lib/whatsapp/connection.ts');
  const calls=[];
  const transport=async(url,init)=>{
    calls.push({url:String(url),method:init.method});
    const path=new URL(url).pathname;
    const body=path==='/v25.0/111'?{id:'111'}:path.endsWith('/me/permissions')?{data:[{permission:'whatsapp_business_messaging',status:'granted'}]}
      :path.endsWith('/222/phone_numbers')?{data:[{id:'111'}]}
      :path.endsWith('/222/message_templates')?{data:[{name:'content_entwurf',language:'de',status:'APPROVED',category:'MARKETING'}]}:{};
    return {ok:true,status:200,json:async()=>body};
  };
  const report=await checkWhatsAppConnection(transport);
  assert.equal(report.status,'connected');
  assert.deepEqual(report.diagnostics.dailyTemplate,{configuredLanguage:'de',found:true,matches:[{language:'de',status:'APPROVED',category:'MARKETING'}]});
  assert.ok(calls.every(call=>call.method==='GET'));
  assert.ok(!JSON.stringify(report).includes('xxxx'));
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');

test('WhatsApp status explains a saved review failure without starting another job',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const id='e6ad1a01-4793-46c4-a77c-2c7059c41210';
  await pg.query("INSERT INTO products(id,name,source_url) VALUES('robot','MEDION Saugroboter','https://www.amazon.de/dp/B000000001')");
  const opportunity={product:{name:'MEDION Saugroboter'}};
  await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
    VALUES($1,'robot','household','cleaning','education','facebook','', $2,'needs_input',$3,now(),now())`,
    [id,JSON.stringify(opportunity),JSON.stringify({opportunity,review:{passed:false,issues:['Bild zeigt ein unpassendes Werkzeug.']}})]);
  await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status) VALUES('2026-09-29','manual:test',$1,'needs_input')",[id]);
  const status=loadRoute('lib/reporting/whatsapp-status.ts',{
    '../memory/ensure-automation-schema':{ensureAutomationSchema:async()=>{}},
  });
  const text=await status.latestImagePostsStatus({query:(q,v)=>pg.query(q,v)});
  assert.match(text,/MEDION Saugroboter: needs_input \(redaktionelle Prüfung: Bild zeigt ein unpassendes Werkzeug\.\)/);
});

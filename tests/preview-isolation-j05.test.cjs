// J-05: the preview isolation check knows every credential the code reads, and the before/after check of production
// detects writes into quiet tables and new migrations while only reporting activity in tables production writes itself.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const C=require('../scripts/check-preview-isolation.cjs');
const U=require('../scripts/check-production-untouched.cjs');

// Read by the code but not secret: an expiry time and a public OAuth client id.
const NOT_CREDENTIALS=['PINTEREST_ACCESS_TOKEN_EXPIRES_AT','TIKTOK_CLIENT_KEY'];

function credentialNamesInCode(){
  const names=new Set();
  const scan=file=>{for(const m of fs.readFileSync(file,'utf8').matchAll(/(?:process\.env\.|env\.|["'`])([A-Z][A-Z0-9_]{3,})\b/g))names.add(m[1]);};
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules')walk(full);}else if(/\.(ts|tsx)$/.test(full))scan(full);
  }};
  walk('lib');walk('app');
  for(const file of ['proxy.ts','instrumentation.ts'])if(fs.existsSync(file))scan(file);
  return [...names].filter(name=>/(TOKEN|SECRET|PASSWORD|API_KEY|_KEY$|DATABASE_URL|POSTGRES_URL)/.test(name)).sort();
}

test('every credential read by the code is checked by the preview isolation script (no drift)',()=>{
  const covered=new Set([...Object.values(C.RESOURCES).flat(),...C.ACCESS,...NOT_CREDENTIALS]);
  const missing=credentialNamesInCode().filter(name=>!covered.has(name));
  assert.deepEqual(missing,[],'neue Zugangsdaten in scripts/check-preview-isolation.cjs einer Ressource zuordnen');
  for(const name of ['PINTEREST_ACCESS_TOKEN','PINTEREST_CLIENT_SECRET','YOUTUBE_CLIENT_SECRET','TIKTOK_CLIENT_SECRET','X_API_SECRET'])
    assert.ok(C.RESOURCES.publishing.includes(name),name);
  assert.ok(C.ACCESS.includes('ADMIN_SESSION_SECRET'));
});

test('a shared Pinterest token or session secret is now reported',()=>{
  const prod={PINTEREST_ACCESS_TOKEN:'p1',ADMIN_SESSION_SECRET:'s1'};
  const result=C.compare(prod,{...prod});
  assert.equal(result.resources.publishing,false);
  assert.equal(result.accessShared,true);
});

test('production before/after: quiet tables and new migrations are findings, active tables only activity',async()=>{
  const db=await pgliteDatabase();
  const before=await U.takeSnapshot(db);
  assert.ok(before.migrations.length>0);
  assert.equal(before.tables.model_calls,0);
  for(const name of U.QUIET)assert.ok(name in before.tables);
  // Production's own activity: a model call. Not a finding.
  await db.query(`INSERT INTO model_calls(agent,model,provider,ok,latency_ms,created_at) VALUES('content_text','m','p',true,1,now())`);
  let diff=U.diffSnapshots(before,await U.takeSnapshot(db));
  assert.deepEqual(diff.findings,[]);
  assert.deepEqual(diff.activity,['model_calls: 0 → 1']);
  // A preview writing into production: a new migration is a finding; so is any change of a quiet table.
  await db.query("INSERT INTO schema_migrations(name) VALUES('999_preview_leak.sql')");
  diff=U.diffSnapshots(before,await U.takeSnapshot(db));
  assert.ok(diff.findings.some(line=>/neue Migrationen verzeichnet: 999_preview_leak\.sql/.test(line)));
  const absent={...before,tables:{...before.tables,enterprise_tasks:0}};
  const present={...before,tables:{...before.tables,enterprise_tasks:2}};
  assert.deepEqual(U.diffSnapshots(absent,present).findings,['enterprise_tasks: 0 → 2']);
  await db.close();
});

test('the before/after script is read-only and never prints the connection string',()=>{
  const source=fs.readFileSync('scripts/check-production-untouched.cjs','utf8');
  assert.match(source,/BEGIN READ ONLY/);
  assert.doesNotMatch(source,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b(?![^\n]*\/\/)/);
  assert.doesNotMatch(source,/console\.\w+\([^)]*DATABASE_URL\)/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildDevelopmentView,readDevelopmentView,developmentViewSchema,DEVELOPMENT_SOURCE}=require('../.test-build/lib/architecture/development');

// A hand-over file as on the coordination branch, with fields that must never reach the Command Center.
const file=(id,status,extra={})=>({folder:id,content:JSON.stringify({schema_version:1,task_id:id,phase:id[0],status,title:'GEHEIMER TITEL',
  log:[{summary:'interne Notiz'}],changed_files:['lib/x.ts'],pr:{url:'https://github.com/x/y/pull/1'},...extra})});
const tmp=files=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'d06-'));for(const [folder,content] of Object.entries(files)){fs.mkdirSync(path.join(dir,folder));if(content!==null)fs.writeFileSync(path.join(dir,folder,'task.json'),content);}return dir;};

test('only id, phase and status leave a hand-over file; counts per status (D-06 AC-1)',()=>{
  const view=buildDevelopmentView([file('B-03','merged'),file('H-03','waiting_review'),file('E-04','waiting_review')]);
  assert.equal(view.available,true);
  assert.deepEqual(view.tasks,[{id:'B-03',phase:'B',status:'merged'},{id:'E-04',phase:'E',status:'waiting_review'},{id:'H-03',phase:'H',status:'waiting_review'}]);
  assert.deepEqual(view.byStatus,{merged:1,waiting_review:2});
  assert.equal(view.source,DEVELOPMENT_SOURCE);
  const json=JSON.stringify(view);
  for(const secret of ['GEHEIMER TITEL','interne Notiz','lib/x.ts','github.com','schema_version'])assert.ok(!json.includes(secret),secret);
  assert.deepEqual(Object.keys(view.tasks[0]).sort(),['id','phase','status']);
  developmentViewSchema.parse(view);
});

test('nothing is guessed: unknown status, wrong folder, phase mismatch, broken JSON and duplicates are skipped (D-06 AC-2)',()=>{
  const view=buildDevelopmentView([file('B-01','merged'),file('B-02','done'),{folder:'B-04',content:file('B-05','merged').content},
    file('C-01','merged',{phase:'B'}),{folder:'D-01',content:'{kaputt'},file('B-01','planned'),{folder:'X-99',content:'{}'}]);
  assert.deepEqual(view.tasks.map(t=>t.id),['B-01']);
  assert.equal(view.skipped,6);
  const none=buildDevelopmentView([{folder:'A-01',content:'[]'}]);
  assert.deepEqual([none.available,none.reason,none.tasks.length],[false,'keine lesbare Übergabedatei',0]);
  const missing=buildDevelopmentView(null);
  assert.deepEqual([missing.available,missing.reason],[false,'Übergabedateien nicht im Build enthalten']);
});

test('reading the folder: missing folder, missing or oversized files, never throws (D-06 AC-3)',()=>{
  assert.equal(readDevelopmentView(path.join(os.tmpdir(),'gibt-es-nicht-d06')).reason,'Übergabedateien nicht im Build enthalten');
  const dir=tmp({'B-01':file('B-01','merged').content,'B-02':null,'B-03':JSON.stringify({task_id:'B-03',phase:'B',status:'merged',pad:'x'.repeat(70*1024)})});
  const view=readDevelopmentView(dir);
  assert.deepEqual(view.tasks.map(t=>t.id),['B-01']);
  assert.equal(view.skipped,2,'missing and oversized file');
  // More folders than the limit: the rest is counted as skipped, not silently dropped (review #110).
  const many=Object.fromEntries(Array.from({length:203},(_,i)=>{const id=`B-${String(i%100).padStart(2,'0')}`;return [`${String(i).padStart(3,'0')}-${id}`,file(id,'merged').content];}));
  const big=readDevelopmentView(tmp(many));
  assert.equal(big.tasks.length+big.skipped,203,'every folder is either read or counted');
  assert.ok(big.skipped>=3);
  const notADir=path.join(dir,'B-01','task.json');
  assert.equal(readDevelopmentView(notADir).available,false);
});

test('wired read-only into /api/architecture, traced into the deployment, shown for Engineering only (D-06 AC-4)',()=>{
  const route=fs.readFileSync('app/api/architecture/route.ts','utf8');
  assert.match(route,/const development = readDevelopmentView\(\);/);
  assert.match(route,/runtime: state, enterprise, development, missing/);
  assert.match(fs.readFileSync('next.config.ts','utf8'),/"\/api\/architecture": \["\.\/docs\/ai-business\/coordination\/tasks\/\*\/task\.json"\]/);
  const source=fs.readFileSync('lib/architecture/development.ts','utf8');
  assert.doesNotMatch(source,/writeFile|appendFile|mkdir|unlink|rm\(|fetch\(|process\.env|child_process/);
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const {DepartmentDetail}=require('../.test-build/app/architecture/enterprise-panel');
  const {buildEnterpriseView}=require('../.test-build/lib/architecture/enterprise');
  const view=buildEnterpriseView({now:new Date('2026-10-20T12:00:00Z'),health:null,tasks:null,decisions:null,controlling:null});
  const development=buildDevelopmentView([file('H-03','waiting_review'),file('B-03','merged')]);
  const render=(id,dev)=>renderToStaticMarkup(React.createElement(DepartmentDetail,{department:view.departments.find(d=>d.id===id),development:dev}));
  const engineering=render('engineering',development);
  assert.match(engineering,/Entwicklungsstand/);
  assert.match(engineering,/wartet auf Review: <b>1<\/b>/);
  assert.match(engineering,/B-03 gemergt · H-03 wartet auf Review/);
  assert.match(render('engineering',buildDevelopmentView(null)),/Übergabedateien nicht im Build enthalten/);
  assert.match(render('engineering',buildDevelopmentView([{folder:'B-01',content:'{kaputt'}])),/keine lesbare Übergabedatei · 1 Datei\(en\) nicht lesbar und ausgelassen/,'skipped files are shown even when nothing is readable');
  assert.match(render('engineering',undefined),/Entwicklungsstand[^]*keine Daten/);
  assert.doesNotMatch(render('affiliate',development),/Entwicklungsstand/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const loadRoute=require('./helpers/load-route.cjs');
const W=require('../.test-build/lib/enterprise/executive-weekly');
const {formatWeeklyReport}=require('../.test-build/lib/reporting/weekly');

// Week of the report: Monday 12.10.2026 00:00 UTC up to Monday 19.10.2026 00:00 UTC (as previousWeek computes it).
const START=new Date('2026-10-12T00:00:00Z'),END=new Date('2026-10-19T00:00:00Z');
const IN='2026-10-14T10:00:00Z',BEFORE='2026-10-05T10:00:00Z',AFTER='2026-10-19T10:00:00Z';
const id=()=>crypto.randomUUID();

const insert=(db,table,row)=>{const k=Object.keys(row);return db.query(`INSERT INTO ${table}(${k.join(',')}) VALUES(${k.map((_,i)=>`$${i+1}`).join(',')})`,k.map(x=>row[x]));};
const task=(db,status,created_at,extra={})=>{const r={id:id(),department:'affiliate',task_kind:'affiliate.status_report',handler_id:'affiliate.statusReport',status,
  permission_level:'L0',correlation_id:'c',idempotency_key:id(),created_by:'executive',created_at,...extra};
  if(status==='succeeded')r.output=JSON.stringify({});
  if(['failed','dead'].includes(status))r.failure_class='provider_error';
  if(status==='outcome_unknown')r.failure_class='outcome_unknown';
  return insert(db,'enterprise_tasks',r).then(()=>r.id);};
const decision=(db,extra)=>insert(db,'enterprise_decisions',{id:id(),subject_key:id(),version:1,level:'L3b',department:'affiliate',task_kind:'affiliate.publication_request',
  subject:'Beitrag veröffentlichen',fingerprint:'a'.repeat(64),created_at:BEFORE,expires_at:'2026-10-25T10:00:00Z',...extra});
const decided=(status,at)=>({status,authority:'whatsapp_operator',request_message_id:`wamid.req.${id()}`,decided_message_id:`wamid.dec.${id()}`,decided_at:at});
const cost=(db,extra)=>insert(db,'cost_entries',{id:id(),occurred_at:IN,department:'affiliate',provider:'beispiel',category:'other',quantity:1,unit:'stueck',
  value_kind:'measured',source:'manual',source_ref:id(),...extra});

async function scenario(){
  const db=await pgliteDatabase();
  for(const status of ['succeeded','succeeded','failed','dead','outcome_unknown','queued','needs_decision','cancelled'])await task(db,status,IN);
  const old=await task(db,'outcome_unknown',BEFORE);   // outside the week: counted only as "unknown overall"
  await task(db,'succeeded',AFTER);                     // after the week: not counted
  await insert(db,'budget_reservations',{id:id(),task_id:old,department:'affiliate',period:'2026-10',amount_cents:100,status:'disputed'});
  await insert(db,'budget_reservations',{id:id(),task_id:old,department:'affiliate',period:'2026-10',amount_cents:100,status:'released',settled_at:IN});
  // Seven open requests (five listed, earliest expiry first), one with a long multi-line subject.
  for(let i=0;i<6;i++)await decision(db,{subject:`Vorlage ${i+1}`,expires_at:`2026-10-2${i}T10:00:00Z`});
  await decision(db,{subject:`Zeile eins\n\nZeile zwei ${'x'.repeat(300)}`,level:'L4',department:'executive',task_kind:'executive.budget_change',expires_at:'2026-10-19T12:30:00Z'});
  await decision(db,decided('approved',IN));
  await decision(db,decided('rejected',IN));
  await decision(db,decided('rejected',BEFORE));       // decided before the week
  await decision(db,{status:'expired',expires_at:IN});
  // Still 'pending' but past expiry (expireDecisions runs only in the switched-off cycle): never listed as open; counted as
  // expired in the week it expired, and not at all when it expired before the week.
  await decision(db,{subject:'Abgelaufen in der Woche',expires_at:'2026-10-15T10:00:00Z'});
  await decision(db,{subject:'Abgelaufen vor der Woche',created_at:'2026-09-20T10:00:00Z',expires_at:'2026-10-01T10:00:00Z'});
  await cost(db,{amount_micros:1_234_567,currency:'EUR'});
  await cost(db,{amount_micros:500_000,currency:'EUR',value_kind:'estimated'});
  await cost(db,{amount_micros:9_000_000,currency:'EUR',value_kind:'forecast'});   // no cost: left out entirely
  await cost(db,{amount_micros:700_000,currency:'USD'});
  await cost(db,{source:'model_calls',category:'model',unit:'input_token',quantity:100});   // no price: amount unknown
  await cost(db,{amount_micros:5_000_000,currency:'EUR',occurred_at:BEFORE});
  return db;
}

test('the section reads only the report week and lists open decisions as a reminder (AC-1)',async()=>{
  const db=await scenario();
  const section=await W.readExecutiveWeekly(db,START,END,END);
  assert.equal(section.readable,true);
  assert.deepEqual(section.tasks,{created:8,succeeded:2,failed:2,unknown:1,open:2,cancelled:1});
  assert.equal(section.unknownOpen,2);
  assert.equal(section.decisions.pendingTotal,7);
  assert.equal(section.decisions.pending.length,W.MAX_LISTED_DECISIONS);
  assert.deepEqual([section.decisions.approved,section.decisions.rejected,section.decisions.expired],[1,1,2]);
  assert.equal(section.disputedReservations,1);
  assert.deepEqual(section.costs,{entries:4,measuredEurMicros:1_234_567,estimatedEurMicros:500_000,withoutPrice:1,otherCurrency:1});
  const text=W.formatExecutiveWeekly(section);
  const lines=text.replace(/\u00a0/g,' ').split('\n');
  assert.equal(lines[0],'Executive-Ebene (nur Bericht, keine Wirkung)');
  assert.equal(lines[1],'Aufgaben neu: 8, davon heute: erledigt 2 · fehlgeschlagen 2 · Wirkung unbekannt 1 · offen 2 · abgebrochen 1');
  assert.match(lines[2],/^Aufgaben mit unbekannter Wirkung insgesamt: 2 – bitte prüfen/);
  assert.equal(lines[3],'Offene Entscheidungsvorlagen: 7');
  // Earliest expiry first, in Berlin time; the multi-line subject is one bounded line.
  assert.match(lines[4],/^– Zeile eins Zeile zwei x+… \(L4, gültig bis 19\.10\., 14:30\)$/);
  assert.ok(lines[4].length<=160,lines[4]);
  assert.equal(lines[5],'– Vorlage 1 (L3b, gültig bis 20.10., 12:00)');
  assert.equal(lines[9],'– und 2 weitere');
  assert.equal(lines[10],'Freigeben oder Ablehnen nur als Antwort auf die jeweilige Anfrage-Nachricht, nicht auf diesen Bericht.');
  assert.equal(lines[11],'Entschieden diese Woche: freigegeben 1 · abgelehnt 1 · abgelaufen 2');
  assert.equal(lines[12],'Strittige Budgetreservierungen: 1');
  assert.equal(lines[13],'Kostenbuch diese Woche: gemessen 1,23 € + geschätzt 0,50 €, 1 Eintrag ohne Preis (Betrag unbekannt), 1 in anderer Währung');
  assert.equal(lines.length,14);
  assert.doesNotMatch(text,/9,00|5,00|Abgelaufen/);   // forecast and last week's cost are not in the report
  await db.close();
});

test('empty tables say "keine" instead of inventing zeros; tiny amounts are not rounded to zero (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const text=W.formatExecutiveWeekly(await W.readExecutiveWeekly(db,START,END));
  assert.equal(text,['Executive-Ebene (nur Bericht, keine Wirkung)','Aufgaben neu: keine','Offene Entscheidungsvorlagen: keine',
    'Entschieden diese Woche: freigegeben 0 · abgelehnt 0 · abgelaufen 0','Strittige Budgetreservierungen: keine','Kostenbuch diese Woche: keine Einträge'].join('\n'));
  await cost(db,{amount_micros:42,currency:'EUR'});
  assert.match(W.formatExecutiveWeekly(await W.readExecutiveWeekly(db,START,END)).replace(/\u00a0/g,' '),/Kostenbuch diese Woche: gemessen unter 0,01 €$/);
  await db.close();
});

test('missing tables or a failing database give an unreadable section, never an exception (AC-3)',async()=>{
  const pg=new PGlite();   // no migrations: none of the tables exists
  const bare={query:(q,v)=>pg.query(q,v),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v)}))};
  assert.deepEqual(await W.readExecutiveWeekly(bare,START,END),{readable:false});
  await pg.close();
  const broken={query:async()=>{throw new Error('down');},transaction:async()=>{throw new Error('down');}};
  const section=await W.readExecutiveWeekly(broken,START,END);
  assert.deepEqual(section,{readable:false});
  assert.equal(W.formatExecutiveWeekly(section),'Executive-Ebene: nicht lesbar (Tabellen fehlen oder Datenbankfehler) – keine Angaben.');
});

test('the reader runs in a READ ONLY transaction and the module cannot send or decide anything (AC-4)',async()=>{
  const db=await pgliteDatabase();const seen=[];
  const spy={...db,transaction:fn=>db.transaction(sql=>fn({query:(q,v)=>{seen.push(q);return sql.query(q,v);}}))};
  await W.readExecutiveWeekly(spy,START,END);
  assert.equal(seen[0],'SET TRANSACTION READ ONLY');
  for(const q of seen.slice(1))assert.match(q.trim(),/^SELECT/);
  await db.close();
  const source=fs.readFileSync('lib/enterprise/executive-weekly.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]),['../memory/db']);
  assert.doesNotMatch(source,/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b|fetch\(|process\.env|sendWhatsApp|require\(|import\(/);
  // Only the weekly report uses it.
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/enterprise\/executive-weekly/.test(fs.readFileSync(full,'utf8')))users.push(full);}};
  walk('app');walk('lib');
  assert.deepEqual(users,[path.join('lib','reporting','weekly.ts')]);
});

const weeklyWith=(db,sent)=>loadRoute('lib/reporting/weekly.ts',{
  '../memory/db':{getDatabase:()=>db},
  '../meta/connection':{cachedMetaConnection:async()=>({resolved:false}),metaConfig:()=>({})},
  '../whatsapp/client':{sendWhatsAppText:async body=>{sent.push(body);return `wamid.weekly.${sent.length}`;},sendWeeklyNotificationTemplate:async()=>'wamid.wt',weeklyNotificationTemplateConfigured:()=>false},
});
async function withEnv(values,fn){const old={};for(const k of Object.keys(values)){old[k]=process.env[k];if(values[k]===undefined)delete process.env[k];else process.env[k]=values[k];}
  try{return await fn();}finally{for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}}

test('switch EXECUTIVE_WEEKLY_REPORT: off (default) leaves the weekly report unchanged, only exactly "true" adds the section (AC-5)',async()=>{
  const reference=new Date('2026-10-19T08:15:00Z');
  for(const [value,expected] of [[undefined,false],['1',false],['TRUE',false],['true',true]]){
    const db=await scenario();const sent=[];
    await withEnv({EXECUTIVE_WEEKLY_REPORT:value,WHATSAPP_APPROVER_WA_ID:undefined},async()=>{
      const result=await weeklyWith(db,sent).createWeeklyReport(reference,db);
      assert.equal(result.weekStart,'2026-10-12');
    });
    assert.deepEqual(sent,[]);
    const row=(await db.query("SELECT report_text,metrics FROM weekly_reports WHERE week_start='2026-10-12'")).rows[0];
    const base=formatWeeklyReport(START,END,typeof row.metrics==='string'?JSON.parse(row.metrics):row.metrics);
    if(expected){
      assert.ok(row.report_text.startsWith(`${base}\n\nExecutive-Ebene (nur Bericht, keine Wirkung)\n`),String(value));
      assert.match(row.report_text,/Offene Entscheidungsvorlagen: 7/);
    }else{
      assert.equal(row.report_text,base,String(value));
    }
    await db.close();
  }
});

test('a broken executive level never breaks the weekly report (AC-6)',async()=>{
  const db=await pgliteDatabase();const sent=[];
  await db.query('DROP TABLE enterprise_decisions');   // test-only: simulates a missing table
  await withEnv({EXECUTIVE_WEEKLY_REPORT:'true',WHATSAPP_APPROVER_WA_ID:undefined},async()=>{
    const result=await weeklyWith(db,sent).createWeeklyReport(new Date('2026-10-19T08:15:00Z'),db);
    assert.equal(result.status,'not_configured');
  });
  const row=(await db.query("SELECT status,report_text FROM weekly_reports WHERE week_start='2026-10-12'")).rows[0];
  assert.equal(row.status,'ready');
  assert.match(row.report_text,/\n\nExecutive-Ebene: nicht lesbar \(Tabellen fehlen oder Datenbankfehler\) – keine Angaben\.$/);
  await db.close();
});

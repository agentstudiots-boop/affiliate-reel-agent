const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const M=require('../.test-build/lib/enterprise/controlling/manual-entries');
const {readControllingSnapshot}=require('../.test-build/lib/enterprise/controlling/snapshot');

// Synthetic data only: the repository is public, no real receipts or revenue.
const cost=(extra={})=>({day:'2026-10-05',department:'affiliate',category:'subscription',provider:'beispiel-hosting',amount:'20,00',receiptRef:'RE-TEST-1',...extra});
const costs=async db=>(await db.query(`SELECT department,category,amount_micros AS m,currency,value_kind,source,source_ref FROM cost_entries ORDER BY source_ref`)).rows.map(row=>({...row,m:Number(row.m)}));
const revenues=async db=>(await db.query(`SELECT department,channel,amount_cents AS c,value_kind,source,to_char(period_start,'YYYY-MM-DD') AS s FROM revenue_entries ORDER BY period_start,source_ref`)).rows.map(row=>({...row,c:Number(row.c)}));

test('amounts are parsed exactly or rejected, never guessed (AC-1)',()=>{
  assert.equal(M.parseDecimal('20,00',2,false),2000);
  assert.equal(M.parseDecimal('1.234,56',2,false),123456);
  assert.equal(M.parseDecimal('0,000125',6,false),125);
  assert.equal(M.parseDecimal('-12,3',2,true),-1230);
  assert.equal(M.parseDecimal('-0',2,true),0);
  for(const bad of ['12.50','1,234.56','12,345',' ','abc','1e3','-5','12,5 €',null,12.5])assert.equal(M.parseDecimal(bad,2,false),null,String(bad));
  assert.equal(M.parseDecimal('9007199254740993',2,false),null,'outside the safe range');
  assert.equal(M.parseDay('19.10.2026'),'2026-10-19');
  assert.equal(M.parseDay('2026-10-19'),'2026-10-19');
  for(const bad of ['31.02.2026','2026-13-01','19/10/2026','',null])assert.equal(M.parseDay(bad),null,String(bad));
});

test('manual costs: measured only with a receipt, estimate otherwise; idempotent, conflicts are not overwritten (AC-2)',async()=>{
  const db=await pgliteDatabase();
  assert.deepEqual(await M.recordManualCost(db,cost()),{status:'recorded'});
  assert.deepEqual(await M.recordManualCost(db,cost()),{status:'duplicate'});
  assert.deepEqual(await M.recordManualCost(db,cost({amount:'25,00'})),{status:'rejected',reason:'Referenz bereits mit anderem Inhalt erfasst – nicht überschrieben'});
  assert.deepEqual(await M.recordManualCost(db,cost({receiptRef:null,entryRef:'schaetzung-strom-10',amount:'3,50',category:'infra'})),{status:'recorded'});
  assert.deepEqual(await costs(db),[
    {department:'affiliate',category:'subscription',m:20000000,currency:'EUR',value_kind:'measured',source:'invoice',source_ref:'invoice:RE-TEST-1'},
    {department:'affiliate',category:'infra',m:3500000,currency:'EUR',value_kind:'estimated',source:'manual',source_ref:'manual:schaetzung-strom-10'}]);
  for(const [extra,pattern] of [[{department:'marketing'},/Register/],[{department:'toString'},/Register/],[{category:'werbung'},/Kategorie/],
    [{amount:'-5,00'},/Betrag/],[{amount:'20.00'},/Betrag/],[{day:'2026-02-30'},/Datum/],[{receiptRef:null},/Belegnummer/],[{provider:' '},/Anbieter/],[{quantity:-1},/Menge/]])
    assert.match((await M.recordManualCost(db,cost(extra))).reason,pattern,JSON.stringify(extra));
  await db.close();
});

test('manual revenue: period, kind and amount checked; negative amounts allowed (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const revenue=(extra={})=>({periodStart:'2026-10-01',periodEnd:'2026-10-31',department:'affiliate',channel:'amazon_partnernet',amount:'-4,20',kind:'measured',entryRef:'retoure-10',...extra});
  assert.deepEqual(await M.recordManualRevenue(db,revenue()),{status:'recorded'});
  assert.deepEqual(await M.recordManualRevenue(db,revenue()),{status:'duplicate'});
  assert.equal((await M.recordManualRevenue(db,revenue({amount:'-4,30'}))).status,'rejected');
  for(const [extra,pattern] of [[{periodEnd:'2026-09-30'},/Zeitraum/],[{kind:'forecast'},/Werteart/],[{amount:''},/Betrag/],[{amount:'1,005'},/Betrag/],[{channel:''},/Kanal/],[{entryRef:''},/Referenz/]])
    assert.match((await M.recordManualRevenue(db,revenue(extra))).reason,pattern,JSON.stringify(extra));
  assert.deepEqual(await revenues(db),[{department:'affiliate',channel:'amazon_partnernet',c:-420,value_kind:'measured',source:'manual',s:'2026-10-01'}]);
  await db.close();
});

// A synthetic report in the shape of a manual export: the column names are test data, not a claim about PartnerNet.
const MAPPING={day:'Datum',amount:'Provision',key:['Datum','Tracking-ID'],currency:'Waehrung',ignore:['Klicks','Bestellte Artikel']};
const CSV=['﻿Datum;Tracking-ID;Klicks;Bestellte Artikel;Provision;Waehrung',
  '01.10.2026;test-21;12;1;"1,23";EUR',
  '02.10.2026;test-21;8;0;0,00;EUR',
  '02.10.2026;other-21;3;1;"-0,50";EUR',
  '03.10.2026;test-21;5;1;2.50;EUR',
  '04.10.2026;test-21;4;1;;EUR',
  '05.10.2026;test-21;4;1;1,00;USD',
  '06.10.2026;;4;1;1,00;EUR',
  '07.10.2026;dup-21;1;1;1,00;EUR',
  '07.10.2026;dup-21;1;1;2,00;EUR',
  '31.09.2026;test-21;1;1;1,00;EUR',
  '08.10.2026;test-21;1;1,00;EUR',
  ''].join('\r\n');

test('CSV: header mapping is strict, every row gets a result, nothing is guessed (AC-4)',()=>{
  const parsed=M.parseRevenueCsv(CSV,MAPPING);
  assert.equal(parsed.ok,true,parsed.reason);
  assert.deepEqual(parsed.rows.map(row=>[row.line,row.day,row.cents]),[[2,'2026-10-01',123],[3,'2026-10-02',0],[4,'2026-10-02',-50]]);
  assert.deepEqual(parsed.rejected.map(row=>[row.line,row.reason]),[
    [5,'Betrag ungültig oder leer'],[6,'Betrag ungültig oder leer'],[7,'Währung nicht EUR'],[8,'Schlüsselspalte leer'],
    [9,'Schlüssel mehrfach in der Datei'],[10,'Schlüssel mehrfach in der Datei'],[11,'Datum ungültig'],[12,'Spaltenanzahl passt nicht zur Kopfzeile']]);
  // Fail-closed on the file level: unknown or missing columns, duplicate headers, broken quotes, empty file.
  assert.match(M.parseRevenueCsv(CSV,{...MAPPING,ignore:['Klicks']}).reason,/Unbekannte Spalten: Bestellte Artikel/);
  assert.match(M.parseRevenueCsv(CSV,{...MAPPING,amount:'Umsatz'}).reason,/Spalten fehlen: Umsatz/);
  assert.match(M.parseRevenueCsv('Datum;Datum;Provision\n',{day:'Datum',amount:'Provision',key:['Datum']}).reason,/doppelte Spalten/);
  assert.match(M.parseRevenueCsv('"Datum;Provision\n',{day:'Datum',amount:'Provision',key:['Datum']}).reason,/Kopfzeile/);
  assert.match(M.parseRevenueCsv('   ',MAPPING).reason,/leer/);
  assert.match(M.parseRevenueCsv(CSV,{...MAPPING,key:[]}).reason,/Schlüsselspalten/);
});

test('CSV import is idempotent across exports and shows up in the ControllingSnapshot as measured revenue (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const parsed=M.parseRevenueCsv(CSV,MAPPING);
  const target={department:'affiliate',channel:'amazon_partnernet'};
  assert.deepEqual((await M.importRevenueCsv(db,parsed.rows,target)).map(row=>[row.line,row.status]),[[2,'recorded'],[3,'recorded'],[4,'recorded']]);
  // A later export repeats the first rows: recognised, never counted twice; a changed amount is a conflict, not an update.
  const later=M.parseRevenueCsv(['Datum;Tracking-ID;Klicks;Bestellte Artikel;Provision;Waehrung','01.10.2026;test-21;12;1;1,23;EUR','02.10.2026;other-21;3;1;-0,60;EUR'].join('\n'),MAPPING);
  assert.deepEqual((await M.importRevenueCsv(db,later.rows,target)).map(row=>row.status),['duplicate','rejected']);
  assert.equal((await M.importRevenueCsv(db,parsed.rows,{department:'marketing',channel:'x'}))[0].status,'rejected');
  const snapshot=await readControllingSnapshot(db,new Date('2026-10-20T12:00:00Z'));
  assert.deepEqual(snapshot.departments.find(d=>d.department==='affiliate').revenue.measured,{amountCents:73,entries:3,unknownAmountEntries:0,complete:true});
  await db.close();
});

test('module is isolated: only db type, crypto and the register; no clock, env or network; not used outside lib/enterprise (AC-6)',()=>{
  const source=fs.readFileSync('lib/enterprise/controlling/manual-entries.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','../registry','node:crypto']);
  assert.match(source,/import type \{ Database \} from "\.\.\/\.\.\/memory\/db"/);
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|Date\.now|new Date\(\)|require\(|import\(|UPDATE |DELETE /);
  const users=[];
  const scan=full=>{if(/\.(ts|tsx|js|mjs|cjs)$/.test(full)&&/enterprise\/controlling\/manual-entries/.test(fs.readFileSync(full,'utf8')))users.push(full);};
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&full!==path.join('lib','enterprise'))walk(full);}else scan(full);
  }};
  walk('app');walk('lib');if(fs.existsSync('scripts'))walk('scripts');
  for(const file of fs.readdirSync('.'))if(/\.(ts|tsx)$/.test(file))scan(file);
  assert.deepEqual(users,[]);
});

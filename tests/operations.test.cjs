const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {getOperationsSnapshot}=require('../.test-build/lib/reporting/operations');
const {formatWeeklyReport}=require('../.test-build/lib/reporting/weekly');

test('operations distinguishes a saved morning draft, publication and missing PartnerNet measurements',async()=>{
  const pg=new PGlite();
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  try{
    for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
    const jobId=crypto.randomUUID(),publicationId=crypto.randomUUID();
    await pg.query("INSERT INTO products(id,name,source_url) VALUES('test','Kuscheldecke','https://example.org')");
    await pg.query(`INSERT INTO content_jobs(id,content_id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,content_type,snapshot,created_at,updated_at)
      VALUES($1,$3,'test','household','test','education','facebook','', '{}','approved','image',$2,now(),now())`,
      [jobId,JSON.stringify({opportunity:{product:{name:'Kuscheldecke'}}}),`cnt_legacy_${jobId.replaceAll('-','')}`]);
    await pg.query("INSERT INTO daily_drafts(day,job_id,status,whatsapp_message_id) VALUES('2026-09-24',$1,'content_approved','wamid.test')",[jobId]);
    await pg.query("INSERT INTO publications(id,job_id,platform,status,url,published_at) VALUES($1,$2,'facebook','published','https://facebook.com/test',now())",[publicationId,jobId]);
    const missing=await getOperationsSnapshot(db);
    assert.equal(missing.days[0].status,'content_approved');
    assert.equal(missing.days[0].contentApprovalSent,true);
    assert.equal(missing.posts[0].measurement,null,'published does not imply clicks or sales');
    await pg.query(`INSERT INTO performance_observations(id,publication_id,revision,window_days,clicks,conversions,affiliate_revenue_cents,source)
      VALUES($1,$2,1,14,13,1,220,'PartnerNet export 2026-09-24')`,[crypto.randomUUID(),publicationId]);
    const measured=await getOperationsSnapshot(db);
    assert.equal(measured.posts[0].measurement.clicks,13);
    assert.equal(measured.posts[0].measurement.revenueCents,220);
    assert.equal(measured.posts[0].measurement.costCents,null);
    assert.equal(measured.posts[0].measurement.source,'PartnerNet export 2026-09-24');
    assert.equal('password' in measured.readiness,false);
  }finally{await pg.close();}
});

test('weekly report says unknown when no measurements exist',()=>{
  const metrics={publishedTotal:1,publishedFacebook:1,publishedInstagram:0,measuredPublications:0,
    clicks:0,conversions:0,revenueCents:0,knownCostCents:0,unknownCostPublications:0,
    facelessPaidStarts:0,facelessCredits:0,facebookFollowers:null,instagramFollowers:null,
    facebookFollowerDelta:null,instagramFollowerDelta:null};
  const report=formatWeeklyReport(new Date('2026-09-14T00:00:00Z'),new Date('2026-09-21T00:00:00Z'),metrics);
  assert.match(report,/keine Messwerte erfasst/);
  assert.match(report,/Ergebnis: ohne Messwerte nicht berechenbar/);
  assert.doesNotMatch(report,/Affiliate-Erlös: 0,00/);
});

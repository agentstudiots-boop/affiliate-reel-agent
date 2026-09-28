const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const loadRoute=require('./helpers/load-route.cjs');

test('Berlin morning and afternoon slots survive both DST transitions',()=>{
  const schedules=JSON.parse(fs.readFileSync('vercel.json','utf8')).crons
    .filter(cron=>cron.path==='/api/cron/daily-draft').map(cron=>cron.schedule);
  assert.deepEqual(schedules,['0 7 * * *','0 8 * * *','0 16 * * *','0 17 * * *']);
  const {berlinSlot}=loadRoute('app/api/cron/daily-draft/route.ts',{
    '@/lib/daily/draft':{createDailyDraft:async()=>({status:'already_claimed'})},
  });
  const slot=s=>berlinSlot(new Date(s));
  assert.equal(slot('2026-03-28T08:00:00Z'),'morning');
  assert.equal(slot('2026-03-29T07:00:00Z'),'morning');
  assert.equal(slot('2026-03-29T08:00:00Z'),'morning');
  assert.equal(slot('2026-10-24T16:00:00Z'),'afternoon');
  assert.equal(slot('2026-10-25T17:00:00Z'),'afternoon');
  assert.equal(slot('2026-10-25T16:00:00Z'),null);
  assert.equal(slot('2026-10-25T18:00:00Z'),'afternoon');
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const loadRoute=require('./helpers/load-route.cjs');

test('Berlin morning and afternoon slots survive both DST transitions',()=>{
  const {berlinSlot}=loadRoute('app/api/cron/daily-draft/route.ts',{
    '@/lib/daily/draft':{createDailyDraft:async()=>({status:'already_claimed'})},
  });
  const slot=s=>berlinSlot(new Date(s));
  assert.equal(slot('2026-03-28T08:00:00Z'),'morning');
  assert.equal(slot('2026-03-29T07:00:00Z'),'morning');
  assert.equal(slot('2026-03-29T08:00:00Z'),null);
  assert.equal(slot('2026-10-24T16:00:00Z'),'afternoon');
  assert.equal(slot('2026-10-25T17:00:00Z'),'afternoon');
  assert.equal(slot('2026-10-25T16:00:00Z'),null);
});

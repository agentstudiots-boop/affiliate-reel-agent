const { test } = require('node:test');
const assert = require('node:assert/strict');
const connection = require('../.test-build/lib/meta/connection');
const { reconcileFacebookPhoto } = require('../.test-build/lib/meta/reconcile');

test('read-only reconciliation matches the exact caption without publishing', async t => {
  const old = process.env.META_SYSTEM_USER_TOKEN;
  process.env.META_SYSTEM_USER_TOKEN = 'test-token';
  t.after(() => { if (old === undefined) delete process.env.META_SYSTEM_USER_TOKEN; else process.env.META_SYSTEM_USER_TOKEN = old; });
  t.mock.method(connection, 'cachedMetaConnection', async () => ({ status: 'connected', resolved: { pageId: '123' } }));
  const timestamp = '2026-09-25T10:15:46Z';
  let calls = 0;
  const transport = async (url, options) => {
    calls++;
    assert.equal(options.method, 'GET');
    assert.equal(url.pathname, '/v25.0/123/photos');
    assert.equal(url.searchParams.get('limit'), '100');
    return new Response(JSON.stringify({data:[{id:'456',name:'Kuscheldecke\n\nAffiliate-Link',created_time:timestamp}]}),{status:200});
  };
  assert.deepEqual(await reconcileFacebookPhoto('Kuscheldecke\n\nAffiliate-Link', timestamp, transport),
    {status:'found',permalink:'https://www.facebook.com/photo.php?fbid=456'});
  assert.equal(calls, 1);
});

test('empty, incomplete, and rejected reads cannot authorize a retry', async t => {
  const old = process.env.META_SYSTEM_USER_TOKEN;
  process.env.META_SYSTEM_USER_TOKEN = 'test-token';
  t.after(() => { if (old === undefined) delete process.env.META_SYSTEM_USER_TOKEN; else process.env.META_SYSTEM_USER_TOKEN = old; });
  t.mock.method(connection, 'cachedMetaConnection', async () => ({ status: 'connected', resolved: { pageId: '123' } }));
  const at = '2026-09-25T10:15:46Z';
  const run = body => reconcileFacebookPhoto('Expected', at, async () => new Response(JSON.stringify(body),{status:200}));
  assert.deepEqual(await run({data:[]}), {status:'not_found',reason:'no_matching_photo_in_time_window'});
  assert.deepEqual(await run({data:[],paging:{next:'https://example.org/untrusted'}}), {status:'incomplete',reason:'additional_pages'});
  assert.deepEqual(await run({error:{code:10,error_subcode:200}}),
    {status:'unavailable',reason:'graph_error',httpStatus:200,code:10,subcode:200});
});

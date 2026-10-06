const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interpretTopicMessage, topicRouteSchema } = require('../.test-build/lib/whatsapp/topic-route');
const { withEnv } = require('./helpers/live-env.cjs');

const route = { domain: 'topic', content_id: 'tc_1', intent: 'change', format: 'CAROUSEL', slides: 4, exclude_formats: ['AVATAR_VIDEO'], tone: [], new_hook: false, cheaper: false,
  product_wish: null, answer: null, clarification_question: null, confidence: 0.9, ambiguity: 'none' };
const context = { replying_to: { kind: 'none', content_id: null }, topic_drafts: [{ content_id: 'tc_1', title: 'Fenster', stage: 'proposed', format: 'SINGLE_IMAGE', product: null }],
  product_drafts: [{ draft_id: 'job-1', product: 'Silbermatte', stage: 'content_approval' }] };
const fake = output => { const calls = []; return { calls, request: async (url, init) => { calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ id: 'abcdefghijkl1', status: 'succeeded', output: typeof output === 'string' ? output : JSON.stringify(output) }), { status: 200 }); } }; };

test('topic interpretation uses the existing router transport with its own instruction and schema', async () => {
  const restore = withEnv({ REPLICATE_API_TOKEN: 'router-token' });
  try {
    const { calls, request } = fake(route);
    const result = await interpretTopicMessage('Mach daraus ein Karussell mit vier Slides, kein Avatar', context, request);
    assert.deepEqual(result, route);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/models\/.+\/predictions$/);
    const body = JSON.parse(calls[0].init.body);
    assert.match(body.input.system_prompt, /Themen-Pipeline/);
    assert.match(body.input.system_prompt, /Produkt-Pipeline/);
    const prompt = JSON.parse(body.input.prompt);
    assert.equal(prompt.operator_message, 'Mach daraus ein Karussell mit vier Slides, kein Avatar');
    assert.deepEqual(prompt.context.product_drafts, context.product_drafts);
    assert.ok(!JSON.stringify(body).includes('router-token'));
    assert.equal(calls[0].init.headers.Authorization, 'Bearer router-token');
  } finally { restore(); }
});

test('invalid model output, a missing token or provider errors are reported, never guessed', async () => {
  const restore = withEnv({ REPLICATE_API_TOKEN: 'router-token' });
  try {
    await assert.rejects(interpretTopicMessage('x', context, fake({ ...route, intent: 'publish_now' }).request), /router_schema_invalid/);
    await assert.rejects(interpretTopicMessage('x', context, fake('kein json').request), /router_failed|router_schema_invalid/);
    await assert.rejects(interpretTopicMessage('x', context, async () => new Response('{}', { status: 503 })), /router_http_503/);
  } finally { restore(); }
  const none = withEnv({ REPLICATE_API_TOKEN: undefined });
  try { await assert.rejects(interpretTopicMessage('x', context, async () => { throw new Error('no call expected'); }), /router_auth_missing/); }
  finally { none(); }
  assert.equal(topicRouteSchema.safeParse({ ...route, extra: 1 }).success, false, 'strict schema');
});

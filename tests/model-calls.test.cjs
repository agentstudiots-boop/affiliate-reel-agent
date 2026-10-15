const { test } = require('node:test');
const assert = require('node:assert/strict');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { withEnv } = require('./helpers/live-env.cjs');
const L = '../.test-build/lib';
const { recordModelCall, setModelCallStore, modelCallSummary, predictionMetrics } = require(`${L}/observability/model-calls`);
const { routerModelCall, RouterUnavailable } = require(`${L}/whatsapp/route-llm`);
const { setEventSink } = require(`${L}/observability/events`);
const { z } = require('zod');

// P7: every paid model call is recorded per agent with outcome, latency and provider metrics; recording never breaks a call
// and never stores prompts, outputs or secrets.
test('ledger stores agent, model, outcome, latency, tokens; the summary aggregates per agent and model', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  const lines = []; setEventSink(line => lines.push(line)); t.after(() => setEventSink(null));
  setModelCallStore(async call => { await db.query(`INSERT INTO model_calls(agent,model,provider,ok,error_class,latency_ms,prediction_id,input_tokens,output_tokens,predict_time_s)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [call.agent, call.model, call.provider ?? 'replicate', call.ok, call.errorClass ?? null, call.latencyMs, call.predictionId ?? null, call.inputTokens ?? null, call.outputTokens ?? null, call.predictTimeS ?? null]); });
  t.after(() => setModelCallStore(null));
  t.after(withEnv({ REPLICATE_API_TOKEN: 'r8_test' }));
  const prediction = { id: 'abcdefghijkl1234', status: 'succeeded', output: '{"ok":true}', metrics: { input_token_count: 812, output_token_count: 37, predict_time: 1.25 } };
  const request = async url => new Response(JSON.stringify(prediction), { status: String(url).includes('/predictions/') ? 200 : 201, headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await routerModelCall('System', z.object({ ok: z.boolean() }), 'Geheimer Prompt-Inhalt', request, async () => {}, { agent: 'image_quality_vision', model: 'openai/gpt-5.6-terra' }), { ok: true });
  const failing = async () => new Response('busy', { status: 503 });
  await assert.rejects(routerModelCall('System', z.object({ ok: z.boolean() }), 'x', failing, async () => {}), RouterUnavailable);
  const rows = (await db.query('SELECT agent,model,ok,error_class,input_tokens,output_tokens,predict_time_s,prediction_id FROM model_calls ORDER BY id')).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0], predict_time_s: Number(rows[0].predict_time_s) }, { agent: 'image_quality_vision', model: 'openai/gpt-5.6-terra', ok: true, error_class: null,
    input_tokens: 812, output_tokens: 37, predict_time_s: 1.25, prediction_id: 'abcdefghijkl1234' });
  assert.equal(rows[1].agent, 'whatsapp_router'); assert.equal(rows[1].ok, false); assert.equal(rows[1].error_class, 'router_http_503');
  const summary = await modelCallSummary(db, 7);
  assert.equal(summary.length, 2);
  assert.equal(summary.find(row => row.agent === 'whatsapp_router').failureRate, 1);
  // Events carry usage counts but never the prompt or a token value.
  const events = lines.filter(line => line.includes('"model_call"'));
  assert.equal(events.length, 2);
  assert.match(events[0], /"usageIn":812/);
  assert.doesNotMatch(lines.join('\n'), /Geheimer Prompt-Inhalt|r8_test/);
});

test('a failing ledger never breaks or delays the model call; malformed metrics are ignored', async t => {
  setModelCallStore(async () => { throw new Error('relation "model_calls" does not exist'); }); t.after(() => setModelCallStore(null));
  setEventSink(() => {}); t.after(() => setEventSink(null));
  await recordModelCall({ agent: 'x', model: 'm', ok: true, latencyMs: 5 });
  assert.deepEqual(predictionMetrics({ id: 'bad id!', metrics: { input_token_count: -1, output_token_count: 'many', predict_time: NaN } }),
    { predictionId: null, inputTokens: null, outputTokens: null, predictTimeS: null });
  assert.deepEqual(predictionMetrics(null), { predictionId: null, inputTokens: null, outputTokens: null, predictTimeS: null });
});

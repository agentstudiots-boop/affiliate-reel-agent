const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { runContentJob, inspectContent } = require('../.test-build/lib/content/orchestrator');
const { restoreHistory, parseJob } = require('../.test-build/lib/content/history');
const { createGenerator } = require('../.test-build/lib/content/model');
const { creativeSchema } = require('../.test-build/lib/content/schema');
const { z } = require('zod');
const opportunity = {
  product: { name: 'Vakuumiergerät für Lebensmittel', sourceUrl: 'https://www.amazon.de/s?k=Vakuumierer', affiliateUrl: '', price: '', targetGroup: 'Familien und Hobbyköche', benefits: 'Portionieren und Sous-vide vorbereiten', notes: 'Zusätzlicher Garer notwendig' },
  useCase: 'Oma staunt beim Familienessen über das Steak. Papa erklärt die Zubereitung.',
  trend: '', goal: 'conversion', budget: 'balanced', verifiedFacts: [],
};

test('routes video, carousel and text by objective and economics without calling a provider', async () => {
  const original = global.fetch;
  global.fetch = () => { throw new Error('Reference mode must not access network'); };
  try {
    for (const [changes, format] of [[{}, 'video'], [{ budget: 'low' }, 'image'], [{ goal: 'community' }, 'text']]) {
      const job = await runContentJob({ ...opportunity, ...changes });
      assert.equal(job.status, 'awaiting_approval', JSON.stringify(job.review));
      assert.equal(job.content.format, format);
      assert.equal(job.modelCalls, 0);
      assert.equal(job.revisions, 0);
      assert.ok(job.ideas.every(i => i.crossSell.length >= 2));
      assert.equal(job.events.filter(e => ['video', 'image', 'text'].includes(e.agent)).length, 1);
      assert.ok(job.events.findIndex(e => e.agent === 'marketing') > job.events.findIndex(e => e.kind === 'decision' && e.data?.passed));
      assert.deepEqual(parseJob(job), job);
      if (format === 'video') {
        assert.equal(job.content.durationSeconds, 37);
        assert.match(job.content.scenes.map(s => s.visual).join(' '), /Pfanne/);
        assert.match(job.content.scenes[0].visual, /rosa/);
      }
    }
  } finally { global.fetch = original; }
});

test('allows two revisions, sends feedback through orchestrator and stops at eight model calls', async () => {
  let reviews = 0;
  const briefs = [];
  const generate = async (agent, instruction, input, schema, reference) => {
    if (agent === 'orchestrator') return { passed: ++reviews === 3, score: reviews === 3 ? 90 : 30, issues: reviews === 3 ? [] : ['Hook konkreter machen'] };
    if (agent === 'video') briefs.push(input);
    return reference();
  };
  const job = await runContentJob(opportunity, { mode: 'ai', generate });
  assert.equal(job.status, 'awaiting_approval');
  assert.equal(job.revisions, 2);
  assert.equal(job.modelCalls, 8);
  assert.equal(briefs.length, 3);
  assert.ok(briefs[1].previous);
  assert.deepEqual(briefs[1].feedback.issues, ['Hook konkreter machen']);
});

test('quality failure at revision limit blocks marketing', async () => {
  const agents = [];
  const job = await runContentJob(opportunity, { mode: 'ai', generate: async (agent, instruction, input, schema, reference) => {
    agents.push(agent);
    return agent === 'orchestrator' ? { passed: false, score: 20, issues: ['Unbelegte Behauptung'] } : reference();
  } });
  assert.equal(job.status, 'needs_input');
  assert.equal(job.revisions, 2);
  assert.equal(job.modelCalls, 7);
  assert.ok(!agents.includes('marketing'));
});

test('invalid specialist output fails closed without retry or marketing', async () => {
  let calls = 0;
  const job = await runContentJob(opportunity, { generate: async () => { calls++; return { ideas: [] }; } });
  assert.equal(job.status, 'failed');
  assert.equal(calls, 1);
  assert.equal(job.content, undefined);
});

test('abort after creative does not dispatch production or marketing', async () => {
  const controller = new AbortController();
  const job = await runContentJob(opportunity, { signal: controller.signal, onUpdate: state => {
    if (state.events.at(-1)?.agent === 'creative') controller.abort();
  } });
  assert.equal(job.status, 'interrupted');
  assert.equal(job.content, undefined);
  assert.equal(job.marketing, undefined);
});

test('incompatible marketing recommendation cannot reach approval', async () => {
  const job = await runContentJob(opportunity, { generate: async (agent, instruction, input, schema, reference) => {
    const result = reference();
    if (agent === 'marketing') result.primary = 'Instagram Carousel';
    return result;
  } });
  assert.equal(job.status, 'needs_input');
});

test('timing, unsupported guarantees and layout errors block review', async () => {
  const job = await runContentJob(opportunity);
  assert.equal(inspectContent({ ...job.content, durationSeconds: 10 }, job.decision).passed, false);
  assert.equal(inspectContent({ ...job.content, hook: 'Garantiert immer perfekt' }, job.decision).passed, false);
});

test('reload preserves completed job and marks interrupted work without restarting', async () => {
  const job = await runContentJob(opportunity);
  assert.deepEqual(restoreHistory(JSON.stringify([job])), [job]);
  const [restored] = restoreHistory(JSON.stringify([{ ...job, status: 'producing' }]));
  assert.equal(restored.status, 'interrupted');
  assert.equal(restored.events.at(-1).kind, 'error');
  assert.throws(() => restoreHistory('{bad json'));
  assert.throws(() => restoreHistory(JSON.stringify([{ ...job, content: { format: 'text' } }])));
});

test('specialists cannot import each other or an orchestrator', () => {
  for (const file of readdirSync('lib/content/agents')) {
    const source = readFileSync(`lib/content/agents/${file}`, 'utf8');
    for (const match of source.matchAll(/from\s+["']([^"']+)/g)) {
      assert.ok(['../schema', '../agent'].includes(match[1]), `${file} has an unauthorized dependency: ${match[1]}`);
    }
  }
});

test('JSON contract is serializable and reference generator rejects malformed output', async () => {
  assert.ok(z.toJSONSchema(creativeSchema).properties.ideas);
  const generate = createGenerator({ mode: 'reference' });
  await assert.rejects(generate('creative', '', {}, creativeSchema, () => ({ ideas: [] })));
});

test('removed generative transport fails closed without a network request', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => { calls++; throw new Error('unexpected'); };
    const generate = createGenerator({ mode: 'ai' });
    await assert.rejects(generate('creative', 'Test', {}, z.object({ ok: z.boolean() }), () => ({ ok: false })), /Tavily bleibt auf Recherche begrenzt/);
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('technical explanation can beat video even for conversion; storage brief favors carousel', async () => {
  const technical = await runContentJob({ ...opportunity, product: { ...opportunity.product, name: 'Netzwerkswitch', targetGroup: 'IT-Fachleute' }, useCase: 'Fachliche Kaufberatung zur Kompatibilität von Netzwerkgeräten.' });
  assert.equal(technical.content.format, 'text');
  assert.equal(technical.status, 'awaiting_approval');
  const storage = await runContentJob({ ...opportunity, useCase: 'Nach dem Einkauf Vorräte portionsweise vorbereiten und passend lagern.' });
  assert.equal(storage.content.format, 'image');
  assert.equal(storage.status, 'awaiting_approval');
});

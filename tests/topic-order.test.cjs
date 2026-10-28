// P1a: explicit topic orders over WhatsApp („Mach etwas über X“). Recognition is deliberately narrow; the operator's wish
// overrides the editorial selection only, never the protective checks. Real parser, gate and scout, no I/O.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { topicOrderCommand, operatorTopicCandidate, operatorTopicCluster, dailyTopicOrderLimit, topicOrdersEnabled } = require(`${L}/topic-pipeline/topic-order`);
const { manualOrderCommand } = require(`${L}/whatsapp/manual-order`);
const { topicCandidateSchema } = require(`${L}/topics/schema`);

const NOW = new Date('2026-10-05T07:00:00Z');

test('clear topic phrasings are recognised and the topic is extracted; product orders stay with manual-order', () => {
  const cases = {
    'Mach etwas über Herbstmüdigkeit': 'Herbstmüdigkeit',
    'Thema: Laub im Garten': 'Laub im Garten',
    'Themenvorschlag – Fenster putzen ohne Schlieren': 'Fenster putzen ohne Schlieren',
    'Erstelle einen Beitrag zum Thema Lüften': 'Lüften',
    'Schreib was zum Thema Zeitumstellung': 'Zeitumstellung',
    'Bitte mach mal was rund um Wäsche trocknen im Winter!': 'Wäsche trocknen im Winter',
    'Erstelle einen Themenbeitrag über Stromsparen im Homeoffice.': 'Stromsparen im Homeoffice',
    'mach uns doch mal was zu „Brotdosen packen“': 'Brotdosen packen',
  };
  for (const [body, topic] of Object.entries(cases)) {
    assert.deepEqual(topicOrderCommand(body), { topic }, body);
    assert.equal(manualOrderCommand(body), null, `${body}: never a product order`);
  }
});

test('questions, approval words, product orders, follow-ups, links and odd lengths are not topic orders', () => {
  for (const body of ['Erstelle einen Beitrag zum Roborock S8', 'Mach einen Beitrag über Kaffeemaschinen', 'Kannst du etwas über Herbst machen?',
    'Mach etwas über Herbst?', 'Freigeben', 'Ablehnen', 'Status', 'Mach es trotzdem', 'Mach das bitte weniger werblich', 'Neues Thema',
    'Mach etwas über https://example.com/x', 'Mach etwas über www.example.com', 'Mach etwas über ab', 'Thema:',
    `Mach etwas über ${'sehr '.repeat(16)}langes Thema`, `Thema: ${'x'.repeat(130)}`, 'Mach etwas über <script>']) {
    assert.equal(topicOrderCommand(body), null, body);
  }
});

test('the order becomes a valid candidate without external claims; editorial thresholds are waived, not hidden', () => {
  const result = operatorTopicCandidate('Laub im Garten', { now: NOW });
  assert.equal(result.status, 'accepted');
  assert.equal(topicCandidateSchema.safeParse(result.candidate).success, true);
  assert.equal(result.candidate.title, 'Laub im Garten');
  assert.equal(result.candidate.fact_status, 'not_applicable');
  assert.equal(result.candidate.why_now, 'Dein Themenauftrag per WhatsApp.');
  assert.deepEqual(result.candidate.source_signals.map(signal => signal.source), ['operator_request']);
  assert.equal(operatorTopicCluster('laub', NOW).signals[0].url, null, 'no invented source');
  // A weak topic is still produced on request, but the waived check is listed for the operator.
  const weak = operatorTopicCandidate('Zahnseide', { now: NOW });
  assert.equal(weak.status, 'accepted');
  assert.ok(Array.isArray(weak.waived));
});

test('protective checks bind the operator too: gossip, sensitive topics without sources, unsupported claims in the title', () => {
  const reasons = topic => { const result = operatorTopicCandidate(topic, { now: NOW }); assert.equal(result.status, 'rejected', topic); return result.reasons.join(' '); };
  assert.match(reasons('Promi-Hochzeit von Helene Fischer'), /Klatsch/);
  assert.match(reasons('Wundermittel gegen Krebs'), /Sensibles Thema.*belegte Quellen/);
  assert.match(reasons('Abnehmen ohne Sport'), /Sensibles Thema/);
  assert.match(reasons('Bundestagswahl'), /Sensibles Thema/);
  assert.match(reasons('Testsieger unter den Staubsaugern'), /Unbelegte Aussage/);
});

test('daily order limit: default 5, bounded to 1..10', () => {
  assert.equal(dailyTopicOrderLimit({}), 5);
  assert.equal(dailyTopicOrderLimit({ TOPIC_ORDERS_PER_DAY: '2' }), 2);
  assert.equal(dailyTopicOrderLimit({ TOPIC_ORDERS_PER_DAY: '50' }), 10);
  assert.equal(dailyTopicOrderLimit({ TOPIC_ORDERS_PER_DAY: '0' }), 5);
  assert.equal(dailyTopicOrderLimit({ TOPIC_ORDERS_PER_DAY: 'viel' }), 5);
});

test('own switch TOPIC_ORDERS_ENABLED: off unless exactly "true"', () => {
  assert.equal(topicOrdersEnabled({}), false);
  assert.equal(topicOrdersEnabled({ TOPIC_ORDERS_ENABLED: '1' }), false);
  assert.equal(topicOrdersEnabled({ TOPIC_ORDERS_ENABLED: 'false' }), false);
  assert.equal(topicOrdersEnabled({ TOPIC_ORDERS_ENABLED: 'true' }), true);
});

test('rollout: TOPIC_ORDERS_ENABLED and TOPIC_EDITORIAL_STYLE are read through lib/config/rollout.ts, both off', () => {
  const { ROLLOUT, switchSource } = require(`${L}/config/rollout`);
  const { editorialStyleEnabled } = require(`${L}/topics/editorial`);
  assert.equal(ROLLOUT.TOPIC_ORDERS_ENABLED, 'false');
  assert.equal(ROLLOUT.TOPIC_EDITORIAL_STYLE, 'false');
  assert.equal(switchSource('TOPIC_ORDERS_ENABLED', {}), 'rollout');
  assert.equal(topicOrdersEnabled({}), false);
  assert.equal(editorialStyleEnabled({}), false);
  assert.equal(editorialStyleEnabled({ TOPIC_EDITORIAL_STYLE: 'true' }), true, 'environment switches on early');
});

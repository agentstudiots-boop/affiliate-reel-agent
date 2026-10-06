const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideFormat } = require('../.test-build/lib/formats/router');
const { emptyOverride, mergeOverrides } = require('../.test-build/lib/formats/override');
const { overrideFromTopicRoute } = require('../.test-build/lib/topic-pipeline/instructions');
// Structured operator wishes (as produced by the semantic router mapping).
const wish = over => ({ ...emptyOverride(), matched: ['test'], ...over });
const { setEventSink } = require('../.test-build/lib/observability/events');

setEventSink(() => {});
const all = { image: { available: true }, standardVideo: { available: true }, avatarVideo: { available: true, quotaRemaining: 10 } };
const none = { image: { available: false, reason: 'REPLICATE_API_TOKEN fehlt' }, standardVideo: { available: false }, avatarVideo: { available: false, quotaRemaining: null } };
const topic = (over = {}, scores = {}) => ({ topic_id: 'tp_0000000000000001', trend_type: 'PRACTICAL_LIFE', suggested_format: 'CAROUSEL', relevance_score: 65, virality_score: 45,
  visual_potential: 50, suitable_for_video: false, suitable_for_avatar: false, risk_score: 10,
  scores: { utility: { score: 50 }, video_fit: { score: 30 }, interaction: { score: 40 }, emotionality: { score: 20 }, ...scores }, ...over });
const decide = (t, over = {}) => decideFormat({ topic: t, platforms: ['instagram', 'facebook'], availability: all, ...over });

test('TEXT: a news explanation for X/Facebook with low visual potential', () => {
  const d = decideFormat({ topic: topic({ trend_type: 'BREAKING_NEWS', suggested_format: 'TEXT', visual_potential: 10 }, { utility: { score: 20 }, interaction: { score: 60 } }), platforms: ['x', 'facebook'], availability: all });
  assert.equal(d.format, 'TEXT');
});

test('SINGLE_IMAGE: strong visual, little to explain', () => {
  const d = decide(topic({ trend_type: 'SEASONAL', suggested_format: 'SINGLE_IMAGE', visual_potential: 90, virality_score: 55 }, { utility: { score: 20 }, interaction: { score: 20 } }));
  assert.equal(d.format, 'SINGLE_IMAGE');
});

test('CAROUSEL: practical topic with several useful points', () => {
  const d = decide(topic({}, { utility: { score: 85 }, interaction: { score: 60 } }));
  assert.equal(d.format, 'CAROUSEL');
  assert.ok(d.fallbacks.includes('SINGLE_IMAGE') && d.fallbacks.includes('TEXT'));
});

test('STANDARD_VIDEO: viral, demonstrable topic for TikTok/YouTube', () => {
  const d = decideFormat({ topic: topic({ suggested_format: 'STANDARD_VIDEO', suitable_for_video: true, virality_score: 80, relevance_score: 75, visual_potential: 80 }, { video_fit: { score: 85 } }),
    platforms: ['tiktok', 'youtube'], availability: { ...all, avatarVideo: { available: false, quotaRemaining: null } } });
  assert.equal(d.format, 'STANDARD_VIDEO');
});

test('AVATAR_VIDEO: strong explanatory reach topic with avatar quota', () => {
  const d = decideFormat({ topic: topic({ suggested_format: 'AVATAR_VIDEO', suitable_for_avatar: true, suitable_for_video: false, virality_score: 85, relevance_score: 80 },
    { utility: { score: 80 }, interaction: { score: 70 }, video_fit: { score: 40 } }), platforms: ['tiktok', 'youtube', 'instagram'], availability: all, goal: 'reach' });
  assert.equal(d.format, 'AVATAR_VIDEO');
});

test('manual WhatsApp instruction overrides router and scout; unfeasible wish falls back with a reason', () => {
  const base = topic({ suggested_format: 'SINGLE_IMAGE' }, { utility: { score: 85 } });
  const carousel = decide(base, { override: wish({ format: 'CAROUSEL', slides: 4 }) });
  assert.equal(carousel.format, 'CAROUSEL');
  assert.equal(carousel.source, 'manual');
  assert.equal(carousel.slides, 4);
  const textOnly = decide(base, { override: wish({ format: 'TEXT' }) });
  assert.equal(textOnly.format, 'TEXT');
  const avatar = decide(base, { availability: { ...all, avatarVideo: { available: false, quotaRemaining: null, reason: 'HEYGEN_API_KEY fehlt' } }, override: wish({ format: 'AVATAR_VIDEO' }) });
  assert.equal(avatar.source, 'manual');
  assert.equal(avatar.format, 'STANDARD_VIDEO');
  assert.match(avatar.manualNotHonoured, /HEYGEN_API_KEY/);
  const noAvatar = decideFormat({ topic: topic({ suitable_for_avatar: true, virality_score: 90, relevance_score: 85 }, { utility: { score: 90 } }), platforms: ['tiktok'], availability: all, override: wish({ exclude: ['AVATAR_VIDEO'] }) });
  assert.notEqual(noAvatar.format, 'AVATAR_VIDEO');
});

test('executive directive ranks below the operator and above the router', () => {
  const base = topic({}, { utility: { score: 85 } });
  assert.equal(decide(base, { executive: { source: 'executive_agent', format: 'SINGLE_IMAGE', reason: 'Wochenplan' } }).source, 'executive');
  assert.equal(decide(base, { executive: { source: 'executive_agent', format: 'SINGLE_IMAGE', reason: 'Wochenplan' }, override: wish({ format: 'STANDARD_VIDEO' }) }).format, 'STANDARD_VIDEO');
});

test('budget: cheap affiliate product never triggers a video; "zu teuer" means an image; equal value prefers cheaper', () => {
  const viral = topic({ suitable_for_video: true, suitable_for_avatar: true, virality_score: 85, relevance_score: 80, visual_potential: 80 }, { video_fit: { score: 85 }, utility: { score: 80 } });
  assert.ok(['TEXT', 'SINGLE_IMAGE', 'CAROUSEL'].includes(decideFormat({ topic: viral, platforms: ['instagram'], availability: all, productPriceClass: 'low' }).format));
  assert.equal(decide(viral, { override: wish({ format: 'SINGLE_IMAGE', cheaper: true }) }).format, 'SINGLE_IMAGE');
  const capped = decideFormat({ topic: viral, platforms: ['tiktok'], availability: all, budget: { maxCostUnits: 4 } });
  assert.ok(capped.options.find(option => option.format === 'AVATAR_VIDEO').reasons.includes('über Budget'));
  assert.equal(capped.format, 'CAROUSEL');
});

test('provider unavailable: alternative format is chosen, TEXT always remains possible', () => {
  const visual = topic({ suggested_format: 'SINGLE_IMAGE', visual_potential: 95 }, { utility: { score: 10 } });
  const d = decideFormat({ topic: visual, platforms: ['instagram'], availability: { ...all, image: { available: false, reason: 'REPLICATE_API_TOKEN fehlt' } } });
  assert.notEqual(d.format, 'SINGLE_IMAGE');
  assert.match(d.options.find(option => option.format === 'SINGLE_IMAGE').reasons.join(' '), /REPLICATE_API_TOKEN fehlt/);
  const nothing = decideFormat({ topic: visual, platforms: ['instagram'], availability: none, override: wish({ exclude: ['CAROUSEL'] }) });
  assert.equal(nothing.format, 'TEXT');
});

test('semantic router output is mapped to structured wishes (no pattern parsing of free text)', () => {
  const route = over => ({ domain: 'topic', content_id: 'tc_1', intent: 'change', format: null, slides: null, exclude_formats: [], tone: [], new_hook: false, cheaper: false,
    product_wish: null, answer: null, clarification_question: null, confidence: 0.9, ambiguity: 'none', ...over });
  assert.deepEqual(overrideFromTopicRoute(route({ slides: 4 })).format, 'CAROUSEL');
  assert.equal(overrideFromTopicRoute(route({ slides: 12 })).slides, 7);
  assert.equal(overrideFromTopicRoute(route({ slides: 1 })).slides, 3);
  const noAvatar = overrideFromTopicRoute(route({ exclude_formats: ['AVATAR_VIDEO'], format: 'AVATAR_VIDEO' }));
  assert.equal(noAvatar.format, null);
  assert.deepEqual(noAvatar.exclude, ['AVATAR_VIDEO']);
  assert.deepEqual(overrideFromTopicRoute(route({ tone: ['less_promotional', 'more_humor'] })).matched, ['weniger werblich', 'mehr Humor']);
  assert.equal(overrideFromTopicRoute(route({ new_hook: true })).newHook, true);
  assert.equal(overrideFromTopicRoute(route({ intent: 'new_topic' })).newTopic, true);
  assert.equal(overrideFromTopicRoute(route({ intent: 'no_product' })).noProduct, true);
  assert.equal(overrideFromTopicRoute(route({ intent: 'other', format: 'TEXT' })).matched.length, 0);
  const merged = mergeOverrides(wish({ exclude: ['AVATAR_VIDEO'] }), wish({ format: 'STANDARD_VIDEO' }));
  assert.equal(merged.format, 'STANDARD_VIDEO');
  assert.deepEqual(merged.exclude, ['AVATAR_VIDEO']);
  // The pattern parser for free wishes no longer exists.
  assert.equal(require('../.test-build/lib/formats/override').parseFormatInstruction, undefined);
});

test('layering: the router never imports providers or renderers; the visual engine never imports scout, publishing or WhatsApp', () => {
  const fs = require('node:fs'), path = require('node:path');
  const scan = (dir, forbidden) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full, forbidden); continue; }
      const imports = [...fs.readFileSync(full, 'utf8').matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
      for (const target of imports) assert.doesNotMatch(target, forbidden, `${full} imports ${target}`);
    }
  };
  scan(path.join(__dirname, '..', 'lib', 'formats'), /visual|providers|replicate|heygen|distribution|publishing|whatsapp|topics\//);
  scan(path.join(__dirname, '..', 'lib', 'visual'), /topics\/|distribution|publishing|whatsapp|meta\//);
});

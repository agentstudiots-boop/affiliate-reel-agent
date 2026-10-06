const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { instagramPublisher, facebookPublisher, tiktokPublisher, youtubePublisher, xPublisher, defaultPublishers } = require(`${L}/distribution/publishers`);
const { oauth1Header } = require(`${L}/distribution/publishers/x`);
const { InstagramPublishFailure } = require(`${L}/meta/instagram-publisher`);
const { FacebookPublishFailure } = require(`${L}/meta/publisher`);
const { PlatformPublishError } = require(`${L}/distribution/publish`);
const { buildMasterContent } = require(`${L}/distribution/master-content`);
const { renderForPlatform } = require(`${L}/distribution/platforms/adapters`);
const { setEventSink } = require(`${L}/observability/events`);
const { withEnv } = require('./helpers/live-env.cjs');

setEventSink(() => {});
const BLOB = 'https://x.public.blob.vercel-storage.com/generated/topics/tc_demo';
const img = n => ({ kind: 'image', url: `${BLOB}/slide-${n}.png`, sha256: 'a'.repeat(64), mediaType: 'image/png', provider: 'replicate' });
const vid = { kind: 'video', url: `${BLOB}/video.mp4`, sha256: 'f'.repeat(64), mediaType: 'video/mp4', provider: 'runway' };
const copy = { hook: 'Beschlagene Fenster? So geht es besser', coreMessage: 'Kurz lüften', body: 'Text', cta: 'Speichern', caption: 'c', hashtags: ['#alltagstipps'], videoScript: 's' };
const master = (format, assets) => buildMasterContent({ contentId: 'tc_demo', topic: { topic_id: 'tp_0000000000000001', title: 'Fenster', trend_type: 'PRACTICAL_LIFE' }, format, copy,
  assets, carousel: null, sources: [], runId: null, origin: 'test' });
const carousel = master('CAROUSEL', [1, 2, 3].map(n => ({ role: `slide-${n}`, asset: img(n) })));
const single = master('SINGLE_IMAGE', [{ role: 'main-image', asset: img(1) }]);
const video = master('STANDARD_VIDEO', [{ role: 'video', asset: vid }]);
const context = () => { const ids = []; return { ids, ctx: { permit: {}, onRemoteId: async id => { ids.push(id); } } }; };
const media = { request: async () => new Response(Buffer.from('png'), { status: 200 }), toJpeg: async bytes => bytes,
  upload: async path => ({ url: `https://x.public.blob.vercel-storage.com/${path}` }) };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeInstagram(over = {}) {
  const calls = [];
  let container = 100;
  const api = {
    createTopicImage: async (url, caption, item) => { calls.push(['image', url, item]); if (over.containerError) throw over.containerError; return String(++container); },
    createTopicCarousel: async (children, caption) => { calls.push(['carousel', children]); return String(++container); },
    createTopicReel: async url => { calls.push(['reel', url]); return String(++container); },
    status: async id => { calls.push(['status', id]); return over.statuses?.length ? over.statuses.shift() : 'FINISHED'; },
    publish: async id => { calls.push(['publish', id]); if (over.publishError) throw over.publishError; return '999'; },
    permalink: async () => 'https://www.instagram.com/p/xyz/',
  };
  return { calls, publisher: instagramPublisher({ ...media, graph: async () => api, sleep: async () => {}, pollAttempts: over.pollAttempts ?? 3 }) };
}

test('Instagram image: JPEG copy → container → publish once → permalink; container id recorded first', async () => {
  const { calls, publisher } = fakeInstagram();
  const { ids, ctx } = context();
  const variant = renderForPlatform(single, 'instagram');
  const result = await publisher.publish(variant, single, ctx);
  assert.deepEqual(result, { state: 'published', externalId: '999', url: 'https://www.instagram.com/p/xyz/' });
  assert.match(calls[0][1], /\/generated\/topics\/tc_demo\/main-image-[a-f0-9]{32}\.jpg$/);
  assert.deepEqual(ids, ['container:101']);
  assert.equal(calls.filter(call => call[0] === 'publish').length, 1);
});

test('Instagram carousel: one container per slide, a parent carousel, one publish', async () => {
  const { calls, publisher } = fakeInstagram();
  const result = await publisher.publish(renderForPlatform(carousel, 'instagram'), carousel, context().ctx);
  assert.equal(result.state, 'published');
  assert.equal(calls.filter(call => call[0] === 'image' && call[2] === true).length, 3);
  assert.deepEqual(calls.find(call => call[0] === 'carousel')[1], ['101', '102', '103']);
  assert.equal(calls.filter(call => call[0] === 'publish').length, 1);
});

test('Instagram reel still processing → "processing"; status() later publishes the SAME container exactly once', async () => {
  const { calls, publisher } = fakeInstagram({ statuses: ['PROCESSING', 'PROCESSING'], pollAttempts: 2 });
  const result = await publisher.publish(renderForPlatform(video, 'instagram'), video, context().ctx);
  assert.deepEqual(result, { state: 'processing', externalId: 'container:101', url: null });
  assert.equal(calls.filter(call => call[0] === 'publish').length, 0);
  const done = await publisher.status('container:101');
  assert.deepEqual(done, { state: 'published', externalId: '999', url: 'https://www.instagram.com/p/xyz/' });
  assert.equal(calls.filter(call => call[0] === 'reel').length, 1);
});

test('Instagram errors: before publish → definite (retry allowed); 5xx/timeout on the final publish → unknown (no retry)', async () => {
  const container = fakeInstagram({ containerError: new InstagramPublishFailure('container', 'network_or_timeout') });
  await assert.rejects(container.publisher.publish(renderForPlatform(single, 'instagram'), single, context().ctx), error => error instanceof PlatformPublishError && error.definite);
  const final = fakeInstagram({ publishError: new InstagramPublishFailure('publish', 'graph_error', 500) });
  await assert.rejects(final.publisher.publish(renderForPlatform(single, 'instagram'), single, context().ctx), error => error instanceof PlatformPublishError && !error.definite);
  const rejected = fakeInstagram({ publishError: new InstagramPublishFailure('publish', 'graph_error', 400, 9007) });
  await assert.rejects(rejected.publisher.publish(renderForPlatform(single, 'instagram'), single, context().ctx), error => error.definite && /code 9007/.test(error.detail));
});

test('Facebook: photo reuses publishFacebookPhoto; text, album (unpublished photos + one feed post) and video use the page client', async () => {
  const calls = [];
  const graph = async () => ({ pageId: '123',
    textPost: async (message, link) => { calls.push(['text', link]); return { id: '123_1', permalink: 'https://www.facebook.com/123_1' }; },
    uploadUnpublishedPhoto: async url => { calls.push(['photo', url]); return String(500 + calls.length); },
    albumPost: async (message, ids) => { calls.push(['album', ids]); return { id: '123_2', permalink: 'https://www.facebook.com/123_2' }; },
    videoPost: async url => { calls.push(['video', url]); return { id: '77', permalink: 'https://www.facebook.com/123/videos/77' }; } });
  const photo = async (url, text) => { calls.push(['single', url, text]); return { id: '1_2', permalink: 'https://www.facebook.com/1_2' }; };
  const publisher = facebookPublisher({ graph, photo });
  assert.equal((await publisher.publish(renderForPlatform(single, 'facebook'), single, context().ctx)).externalId, '1_2');
  const { ids, ctx } = context();
  const album = await publisher.publish(renderForPlatform(carousel, 'facebook'), carousel, ctx);
  assert.equal(album.url, 'https://www.facebook.com/123_2');
  assert.equal(ids.length, 3);
  assert.equal(calls.filter(call => call[0] === 'album').length, 1);
  assert.equal((await publisher.publish(renderForPlatform(video, 'facebook'), video, context().ctx)).externalId, '77');
  const text = master('TEXT', []);
  assert.equal((await publisher.publish(renderForPlatform(text, 'facebook'), text, context().ctx)).externalId, '123_1');
  const failing = facebookPublisher({ graph, photo: async () => { throw new FacebookPublishFailure('request', 'network_or_timeout'); } });
  await assert.rejects(failing.publish(renderForPlatform(single, 'facebook'), single, context().ctx), error => !error.definite);
});

function scripted(responses) {
  const calls = [];
  const request = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (String(url).includes('public.blob.vercel-storage.com')) return new Response(Buffer.from('media'), { status: 200 });
    const next = responses.shift(); if (!next) throw new Error(`unexpected ${url}`); return typeof next === 'function' ? next(init) : next; };
  return { calls, request };
}
const TIKTOK_ENV = { TIKTOK_REFRESH_TOKEN: 'rt', TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs' };

test('TikTok: refresh token → creator info → video init (PULL_FROM_URL) → processing; status → published with link', async () => {
  const { calls, request } = scripted([json({ access_token: 'at' }), json({ data: { creator_username: 'alltag', privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'] }, error: { code: 'ok' } }),
    json({ data: { publish_id: 'v_pub_1' }, error: { code: 'ok' } }), json({ access_token: 'at' }),
    json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['7300'] }, error: { code: 'ok' } })]);
  const publisher = tiktokPublisher({ ...media, request, env: TIKTOK_ENV });
  const { ids, ctx } = context();
  const result = await publisher.publish(renderForPlatform(video, 'tiktok'), video, ctx);
  assert.deepEqual(result, { state: 'processing', externalId: 'v_pub_1', url: null });
  assert.deepEqual(ids, ['v_pub_1']);
  const init = JSON.parse(calls[2].body);
  assert.equal(init.source_info.source, 'PULL_FROM_URL');
  assert.equal(init.post_info.privacy_level, 'SELF_ONLY');
  assert.equal(calls[1].headers.Authorization, 'Bearer at');
  assert.deepEqual(await publisher.status('v_pub_1'), { state: 'published', externalId: '7300', url: 'https://www.tiktok.com/@alltag/video/7300' });
});

test('TikTok: disallowed privacy level and auth errors stop before any post; init 5xx after acceptance is unclear', async () => {
  const privacy = scripted([json({ data: { creator_username: 'a', privacy_level_options: ['PUBLIC_TO_EVERYONE'] }, error: { code: 'ok' } })]);
  await assert.rejects(tiktokPublisher({ ...media, request: privacy.request, env: { TIKTOK_ACCESS_TOKEN: 't' } }).publish(renderForPlatform(video, 'tiktok'), video, context().ctx),
    error => error.definite && /SELF_ONLY/.test(error.detail));
  const auth = scripted([json({ error: { code: 'access_token_invalid', message: 'token t' } }, 401)]);
  await assert.rejects(tiktokPublisher({ ...media, request: auth.request, env: { TIKTOK_ACCESS_TOKEN: 't' } }).publish(renderForPlatform(video, 'tiktok'), video, context().ctx),
    error => error.definite && /Zugang abgelehnt/.test(error.detail) && !/token t/.test(error.detail));
  const down = scripted([json({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } }), json({ error: { code: 'internal_error' } }, 503)]);
  await assert.rejects(tiktokPublisher({ ...media, request: down.request, env: { TIKTOK_ACCESS_TOKEN: 't' } }).publish(renderForPlatform(video, 'tiktok'), video, context().ctx), error => !error.definite);
  const photos = scripted([json({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } }), json({ data: { publish_id: 'p_1' }, error: { code: 'ok' } })]);
  await tiktokPublisher({ ...media, request: photos.request, env: { TIKTOK_ACCESS_TOKEN: 't' } }).publish(renderForPlatform(carousel, 'tiktok'), carousel, context().ctx);
  const body = JSON.parse(photos.calls.at(-1).body);
  assert.equal(body.media_type, 'PHOTO');
  assert.ok(body.source_info.photo_images.every(url => url.endsWith('.jpg')));
});

const YT_ENV = { YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret', YOUTUBE_REFRESH_TOKEN: 'rt' };
test('YouTube: token → resumable session → upload → processing; status processed → published Short link', async () => {
  const { calls, request } = scripted([json({ access_token: 'at' }),
    new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=U1' } }),
    json({ id: 'dQw4w9WgXcQ' }), json({ access_token: 'at' }), json({ items: [{ status: { uploadStatus: 'processed' } }] })]);
  const publisher = youtubePublisher({ ...media, request, env: YT_ENV });
  const { ids, ctx } = context();
  const result = await publisher.publish(renderForPlatform(video, 'youtube'), video, ctx);
  assert.deepEqual(result, { state: 'processing', externalId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' });
  assert.deepEqual(ids, ['session:U1', 'dQw4w9WgXcQ']);
  const metadata = JSON.parse(calls.find(call => call.url.includes('uploadType=resumable')).body);
  assert.match(metadata.snippet.title, /#Shorts$/);
  assert.equal(metadata.status.privacyStatus, 'private');
  assert.deepEqual(await publisher.status('dQw4w9WgXcQ'), { state: 'published', externalId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' });
});

test('YouTube: revoked refresh token is definite; a lost upload answer is unclear (never re-uploaded)', async () => {
  const revoked = scripted([json({ error: 'invalid_grant' }, 400)]);
  await assert.rejects(youtubePublisher({ ...media, request: revoked.request, env: YT_ENV }).publish(renderForPlatform(video, 'youtube'), video, context().ctx),
    error => error.definite && /widerrufen/.test(error.detail));
  const lost = scripted([json({ access_token: 'at' }), new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U2' } }),
    () => { throw new TypeError('fetch failed'); }]);
  await assert.rejects(youtubePublisher({ ...media, request: lost.request, env: YT_ENV }).publish(renderForPlatform(video, 'youtube'), video, context().ctx), error => !error.definite);
});

test('X: OAuth 1.0a signature matches the official reference example', () => {
  const header = oauth1Header('POST', 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
    { consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw', token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' },
    { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' }, 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', 1318622958);
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

const X_ENV = { X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_TOKEN_SECRET: 'ts' };
test('X: images uploaded first (max 4), then exactly one post; post 5xx is unclear, media 403 definite', async () => {
  const ok = scripted([json({ data: { id: 'm1' } }), json({ data: { id: 'm2' } }), json({ data: { id: 'm3' } }), json({ data: { id: '1800' } })]);
  const { ids, ctx } = context();
  const result = await xPublisher({ ...media, request: ok.request, env: X_ENV }).publish(renderForPlatform(carousel, 'x'), carousel, ctx);
  assert.deepEqual(result, { state: 'published', externalId: '1800', url: 'https://x.com/i/web/status/1800' });
  assert.deepEqual(ids, ['media:m1', 'media:m2', 'media:m3']);
  const tweet = ok.calls.find(call => call.url.endsWith('/2/tweets'));
  assert.deepEqual(JSON.parse(tweet.body).media.media_ids, ['m1', 'm2', 'm3']);
  assert.match(tweet.headers.Authorization, /^OAuth oauth_consumer_key="k"/);
  const down = scripted([json({ data: { id: 'm1' } }), json({ data: { id: 'm2' } }), json({ data: { id: 'm3' } }), json({ title: 'x' }, 503)]);
  await assert.rejects(xPublisher({ ...media, request: down.request, env: X_ENV }).publish(renderForPlatform(carousel, 'x'), carousel, context().ctx), error => !error.definite);
  const forbidden = scripted([json({ title: 'Forbidden' }, 403)]);
  await assert.rejects(xPublisher({ ...media, request: forbidden.request, env: X_ENV }).publish(renderForPlatform(carousel, 'x'), carousel, context().ctx),
    error => error.definite && /Schreibrechte/.test(error.detail));
});

test('X: video goes through initialize → append → finalize → status before the post', async () => {
  const { calls, request } = scripted([json({ data: { id: 'v1' } }), json({}), json({ data: { processing_info: { state: 'pending', check_after_secs: 1 } } }),
    json({ data: { processing_info: { state: 'succeeded' } } }), json({ data: { id: '1801' } })]);
  const result = await xPublisher({ ...media, request, env: X_ENV, sleep: async () => {} }).publish(renderForPlatform(video, 'x'), video, context().ctx);
  assert.equal(result.externalId, '1801');
  assert.deepEqual(calls.filter(call => call.url.includes('api.x.com')).map(call => new URL(call.url).pathname),
    ['/2/media/upload/initialize', '/2/media/upload/v1/append', '/2/media/upload/v1/finalize', '/2/media/upload', '/2/tweets']);
});

test('publishers report missing credentials by variable name and make no call without them', async () => {
  const restore = withEnv({ TIKTOK_ACCESS_TOKEN: undefined, TIKTOK_REFRESH_TOKEN: undefined, YOUTUBE_REFRESH_TOKEN: undefined, X_ACCESS_TOKEN: undefined, META_INSTAGRAM_USER_ID: undefined });
  try {
    const by = Object.fromEntries(defaultPublishers().map(publisher => [publisher.platform, publisher.configured()]));
    assert.equal(by.tiktok.ok, false);
    assert.match(by.tiktok.missing[0], /TIKTOK_ACCESS_TOKEN/);
    assert.deepEqual(by.youtube.missing, ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'].filter(name => !process.env[name]));
    assert.ok(by.x.missing.includes('X_ACCESS_TOKEN'));
    assert.ok(by.instagram.missing.includes('META_INSTAGRAM_USER_ID'));
    const calls = [];
    await assert.rejects(tiktokPublisher({ request: async url => { calls.push(url); return json({}); }, env: {} }).publish(renderForPlatform(video, 'tiktok'), video, context().ctx), error => error.definite);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatPublishReport, publishHeadline, reliablePostUrl } = require('../.test-build/lib/publishing/report');

test('headline always names content category and content format', () => {
  assert.equal(publishHeadline('topic', 'STANDARD_VIDEO', [{ platform: 'instagram', status: 'published' }]), 'Themen-Post, Video veröffentlicht');
  assert.equal(publishHeadline('affiliate', 'SINGLE_IMAGE', [{ platform: 'facebook', status: 'published' }]), 'Affiliate-Post, Bild veröffentlicht');
  assert.equal(publishHeadline('topic', 'CAROUSEL', [{ platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed' }]), 'Themen-Post, Karussell teilweise veröffentlicht');
  assert.equal(publishHeadline('affiliate', 'CAROUSEL', [{ platform: 'x', status: 'failed' }]), 'Affiliate-Post, Karussell nicht veröffentlicht');
  assert.equal(publishHeadline('topic', 'AVATAR_VIDEO', [{ platform: 'youtube', status: 'processing' }]), 'Themen-Post, Video (Avatar) noch nicht bestätigt veröffentlicht');
});

test('one line per live platform with name, status and direct link; missing or unreliable links are marked, never invented', () => {
  const text = formatPublishReport({ category: 'topic', format: 'STANDARD_VIDEO', outcomes: [
    { platform: 'instagram', status: 'published', url: 'https://www.instagram.com/reel/abc/' },
    { platform: 'youtube', status: 'published', url: null },
    { platform: 'facebook', status: 'published', url: 'https://evil.example/facebook.com/post' },
  ] });
  assert.equal(text, ['Themen-Post, Video veröffentlicht', '', 'Live:',
    '• Instagram – veröffentlicht – https://www.instagram.com/reel/abc/',
    '• YouTube Shorts – veröffentlicht – Link nicht verfügbar',
    '• Facebook – veröffentlicht – Link nicht verfügbar'].join('\n'));
});

test('partial success separates successful from failed platforms', () => {
  const text = formatPublishReport({ category: 'topic', format: 'CAROUSEL', outcomes: [
    { platform: 'instagram', status: 'published', url: 'https://www.instagram.com/p/xyz/' },
    { platform: 'tiktok', status: 'failed', detail: 'HTTP 503 https://api.tiktok.com/secret?token=1' },
    { platform: 'x', status: 'unknown' },
    { platform: 'facebook', status: 'blocked', detail: 'approval_pending' },
  ] });
  const [live, failed] = text.split('Nicht erfolgreich (nicht live):');
  assert.match(live, /Erfolgreich \(live\):\n• Instagram – veröffentlicht – https:\/\/www\.instagram\.com\/p\/xyz\//);
  assert.match(failed, /• TikTok – fehlgeschlagen \(HTTP 503 \[URL\]\)/);
  assert.match(failed, /• X – Ergebnis unklar – bitte auf der Plattform prüfen, es wird nicht erneut gepostet/);
  assert.match(failed, /• Facebook – blockiert \(keine gültige Freigabe für diese Fassung\)/);
  assert.doesNotMatch(text, /token=1/);
});

test('reliable post URLs: https, own platform domain, a real path, no credentials', () => {
  assert.equal(reliablePostUrl('x', 'https://x.com/user/status/1'), 'https://x.com/user/status/1');
  assert.equal(reliablePostUrl('youtube', 'https://youtu.be/abc'), 'https://youtu.be/abc');
  assert.equal(reliablePostUrl('instagram', 'http://www.instagram.com/p/a/'), null);
  assert.equal(reliablePostUrl('instagram', 'https://www.instagram.com/'), null);
  assert.equal(reliablePostUrl('tiktok', 'https://instagram.com/p/a'), null);
  assert.equal(reliablePostUrl('facebook', 'https://user:pw@facebook.com/p/1'), null);
  assert.equal(reliablePostUrl('facebook', 'not a url'), null);
});

test('an affiliate reel sends "Affiliate-Post, Video veröffentlicht" with the Instagram link; an unclear result is reported as not live', async () => {
  const { advanceInstagram } = require('../.test-build/lib/meta/advance-instagram');
  const make = (publishError) => {
    let state = { id: 'p1', status: 'processing', containerId: 'c1', mediaId: null, permalink: null };
    const repo = { get: async () => state, claimMediaPublish: async () => state,
      markPublished: async (id, mediaId) => (state = { ...state, status: 'published', mediaId }),
      setPermalink: async (id, permalink) => (state = { ...state, permalink }), markUnknown: async () => (state = { ...state, status: 'unknown' }) };
    const graph = async () => ({ status: async () => 'FINISHED', publish: async () => { if (publishError) throw publishError; return 'm1'; }, permalink: async () => 'https://www.instagram.com/reel/r1/' });
    const sent = [];
    return { run: () => advanceInstagram('job', 'poll', repo, graph, {}, async text => { sent.push(text); return 'wamid'; }, () => true, async () => ({ ok: true })), sent };
  };
  const ok = make();
  await ok.run();
  assert.equal(ok.sent.at(-1), 'Affiliate-Post, Video veröffentlicht\n\nLive:\n• Instagram – veröffentlicht – https://www.instagram.com/reel/r1/');
  const unclear = make(new Error('timeout'));
  await assert.rejects(unclear.run());
  assert.match(unclear.sent.at(-1), /^Affiliate-Post, Video noch nicht bestätigt veröffentlicht\n\nNicht live:\n• Instagram – Ergebnis unklar/);
});

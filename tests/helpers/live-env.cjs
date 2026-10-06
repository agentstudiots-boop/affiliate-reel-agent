// Switches the topic pipeline's live publishing on for a test with dummy credential NAMES set (values are fakes;
// every network call in these tests goes to injected fakes). Returns a restore function.
const LIVE = {
  TOPIC_LIVE_PUBLISHING: 'true', TOPIC_PLATFORMS: 'instagram,facebook,tiktok,youtube,x',
  META_SYSTEM_USER_TOKEN: 'test', META_PAGE_ID: '123', META_INSTAGRAM_USER_ID: '456', BLOB_READ_WRITE_TOKEN: 'test',
  TIKTOK_ACCESS_TOKEN: 'test', YOUTUBE_CLIENT_ID: 'test', YOUTUBE_CLIENT_SECRET: 'test', YOUTUBE_REFRESH_TOKEN: 'test',
  X_API_KEY: 'test', X_API_SECRET: 'test', X_ACCESS_TOKEN: 'test', X_ACCESS_TOKEN_SECRET: 'test',
};
function withEnv(values) {
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  return () => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}
module.exports = { LIVE, withEnv, liveEnv: (over = {}) => withEnv({ ...LIVE, ...over }) };

// Same as strictSslConnectionString in lib/memory/db.ts, for the operator scripts (plain Node, no TypeScript).
function strictSslConnectionString(url) {
  try {
    const parsed = new URL(url);
    if (['prefer', 'require', 'verify-ca'].includes(parsed.searchParams.get('sslmode') ?? '')) parsed.searchParams.set('sslmode', 'verify-full');
    return parsed.toString();
  } catch { return url; }
}
module.exports = { strictSslConnectionString };

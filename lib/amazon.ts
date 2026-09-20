const AMAZON_HOSTS = new Set([
  "amazon.de",
  "www.amazon.de",
  "amzn.to",
  "www.amzn.to",
]);

export function associateTag() {
  return process.env.AMAZON_ASSOCIATE_TAG?.trim() || "alltaeglichle-21";
}

export function amazonSearchUrls(searchQuery: string) {
  const query = searchQuery.trim();
  const plain = new URL("https://www.amazon.de/s");
  plain.searchParams.set("k", query);

  const affiliate = new URL(plain);
  affiliate.searchParams.set("tag", associateTag());

  return { amazonUrl: plain.toString(), affiliateUrl: affiliate.toString() };
}

export function createAmazonAffiliateUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (!AMAZON_HOSTS.has(parsed.hostname.toLowerCase())) return rawUrl;

  // Amazon-Kurzlinks enthalten das Tracking intern und werden nicht umgeschrieben.
  if (parsed.hostname.toLowerCase().endsWith("amzn.to")) return rawUrl;

  parsed.searchParams.set("tag", associateTag());
  return parsed.toString();
}

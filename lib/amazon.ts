import type { Product } from "./types";

export const PRODUCT_UNRESOLVED = "product_unresolved";
export function associateTag() {
  // Existing configured tracking ID and existing project default; never mint an ID.
  return process.env.AMAZON_ASSOCIATE_TAG?.trim() || "alltaeglichle-21";
}

export function amazonProduct(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !["amazon.de", "www.amazon.de"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})(?:\/ref=[^/]+)?\/?$/)
      || url.pathname.match(/^\/gp\/product\/([A-Z0-9]{10})(?:\/ref=[^/]+)?\/?$/);
    if (!match) return null;
    // Ignore tracking/display parameters, but never accept redirect or variant targets.
    if ([...url.searchParams.keys()].some(key => /url|redirect|asin|path/i.test(key))) return null;
    return { asin: match[1], productUrl: `https://www.amazon.de/dp/${match[1]}` };
  } catch { return null; }
}

export function createAmazonAffiliateUrl(raw: string) {
  const product = amazonProduct(raw);
  if (!product) return "";
  const url = new URL(product.productUrl);
  url.searchParams.set("tag", associateTag());
  return url.href;
}

export function bindAmazonProduct(product: Product): Product {
  const source = amazonProduct(product.sourceUrl);
  if (!source || (product.asin && product.asin !== source.asin)
    || (product.productUrl && product.productUrl !== source.productUrl)
    || (product.affiliateUrl && amazonProduct(product.affiliateUrl)?.asin !== source.asin)) {
    throw new Error(PRODUCT_UNRESOLVED);
  }
  return { ...product, ...source, sourceUrl: source.productUrl,
    affiliateUrl: createAmazonAffiliateUrl(source.productUrl), trackingId: associateTag() };
}

export function productIdentityError(product: Product, copy = ""): string | null {
  const source = amazonProduct(product.sourceUrl);
  if (!source || product.asin !== source.asin || product.productUrl !== source.productUrl
    || product.sourceUrl !== source.productUrl || !product.productVerifiedAt
    || !Number.isFinite(Date.parse(product.productVerifiedAt))
    || product.productVerifiedName !== product.name || !product.name.trim()
    || !product.trackingId || product.affiliateUrl !== `${source.productUrl}?tag=${encodeURIComponent(product.trackingId)}`) return PRODUCT_UNRESOLVED;
  // All public destinations must be exactly this product and this tracking ID.
  const links = copy.match(/https?:\/\/[^\s<>"\\]+/g) || [];
  if (links.some(link => link.replace(/[.,;!?)]+$/, "") !== product.affiliateUrl)) return PRODUCT_UNRESOLVED;
  if ([...copy.matchAll(/\bASIN\s*[:#]?\s*([A-Z0-9]{10})\b/gi)].some(match => match[1] !== source.asin)) return PRODUCT_UNRESOLVED;
  if (/Shoppen.{0,15}Button|Shopping[- ]Button|Jetzt shoppen|Link in (?:der )?Bio|Profil[- ]Link/i.test(copy)) return "unsupported_shopping_cta";
  return null;
}

export function requireProduct(product: Product, copy = "") {
  const error = productIdentityError(product, copy);
  if (error) throw new Error(error);
}

import { amazonProduct, bindAmazonProduct, requireProduct, PRODUCT_UNRESOLVED } from "./amazon";
import { tavilySearch } from "./tavily";
import type { Product } from "./types";
import type { Database } from "./memory/db";
import { parseJob } from "./content/history";

// Search indexes may retain deleted listings. A live detail page with its own
// title and ASIN must be readable before an affiliate draft can be proposed.
export async function verifyAmazonProductPage(asin: string, request: typeof fetch = fetch): Promise<string> {
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error(PRODUCT_UNRESOLVED);
  const diagnostic = (stage: string, status?: number) => console.info(JSON.stringify({
    event: "amazon_live_verification", stage, ...(status === undefined ? {} : { status }),
  }));
  try {
    const response = await request(`https://www.amazon.de/dp/${asin}`, {
      method: "GET", redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12000),
      headers: { Accept: "text/html", "Accept-Language": "de-DE,de;q=0.9" },
    });
    if (response.status === 429 || response.status === 403) {
      diagnostic("http_blocked", response.status);
      throw new Error("amazon_verification_blocked");
    }
    if (response.url && /(?:captcha|robot.?check|validatecaptcha)/i.test(response.url)) {
      diagnostic("challenge_redirect", response.status);
      throw new Error("amazon_verification_blocked");
    }
    if (!response.ok) { diagnostic("http_unavailable", response.status); throw new Error(PRODUCT_UNRESOLVED); }
    if (response.url && amazonProduct(response.url)?.asin !== asin) {
      diagnostic("identity_redirect", response.status);
      throw new Error(PRODUCT_UNRESOLVED);
    }
    const html = (await response.text()).slice(0, 2_000_000);
    if (/Robot Check|Enter the characters you see below|captcha/i.test(html)) {
      diagnostic("challenge_html", response.status);
      throw new Error("amazon_verification_blocked");
    }
    if (/Derzeit nicht verfügbar|Currently unavailable|Seite wurde nicht gefunden/i.test(html)
      || !new RegExp(`(?:data-asin=["']${asin}["']|/dp/${asin}(?:[/?"']))`, "i").test(html)) {
      diagnostic("identity_html_missing", response.status);
      throw new Error(PRODUCT_UNRESOLVED);
    }
    const rawTitle = html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]
      || html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const title = rawTitle?.replace(/<[^>]*>/g, " ").replace(/&(?:amp|quot|#39);/g, " ").replace(/\s+/g, " ").trim();
    if (!title || title.length < 6 || /^Amazon(?:\.de)?\b/i.test(title)) {
      diagnostic("product_title_missing", response.status);
      throw new Error(PRODUCT_UNRESOLVED);
    }
    return title.slice(0, 160);
  } catch (error) {
    if (error instanceof Error && error.message !== PRODUCT_UNRESOLVED && error.message !== "amazon_verification_blocked")
      diagnostic("request_failed");
    throw error instanceof Error && error.message === "amazon_verification_blocked"
      ? error : new Error(PRODUCT_UNRESOLVED);
  }
}

// Indexed title suggests a candidate; current Amazon HTML confirms identity.
// Neither source on its own verifies model features, price or stock.
export async function resolveAmazonProduct(product: Product, search = tavilySearch,
  verify: (asin: string) => Promise<string> = verifyAmazonProductPage): Promise<Product> {
  const source = amazonProduct(product.sourceUrl);
  if (!source) throw new Error(PRODUCT_UNRESOLVED);
  bindAmazonProduct(product); // Reject a supplied link to a different ASIN before any search.
  let results: Awaited<ReturnType<typeof tavilySearch>>;
  try { results = await search({ query: `site:amazon.de "${source.asin}"`, maxResults: 5 }); }
  catch { throw new Error(PRODUCT_UNRESOLVED); }
  const result = results.find(item => amazonProduct(item.url)?.asin === source.asin
    && item.title.trim().length > 5 && !/captcha|robot\s*check|^Amazon\.de\s*[:|-]?\s*$/i.test(item.title.trim()));
  if (!result) {
    console.info(JSON.stringify({event:"amazon_resolution",stage:"indexed_asin_missing"}));
    throw new Error(PRODUCT_UNRESOLVED);
  }
  let name: string;
  try { name = (await verify(source.asin)).trim().slice(0, 160); }
  catch (error) {
    console.info(JSON.stringify({event:"amazon_resolution",stage:error instanceof Error && error.message === "amazon_verification_blocked" ? "live_blocked" : "live_unavailable"}));
    throw error instanceof Error && error.message === "amazon_verification_blocked"
      ? error : new Error(PRODUCT_UNRESOLVED);
  }
  if (name.length < 5) throw new Error(PRODUCT_UNRESOLVED);
  // Reject a different product family supplied in the briefing; never silently redirect A to B.
  const words = product.name.toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]{4,}/gu) || [];
  if (!words.length || !words.some(word => name.toLocaleLowerCase("de-DE").includes(word))) {
    console.info(JSON.stringify({event:"amazon_resolution",stage:"indexed_live_title_mismatch"}));
    throw new Error(PRODUCT_UNRESOLVED);
  }
  const verified = bindAmazonProduct({ ...product, name, productVerifiedName: name,
    productVerifiedAt: new Date().toISOString(), asin: source.asin, productUrl: source.productUrl });
  requireProduct(verified);
  return verified;
}

// A recent server-verified title for this exact ASIN survives intermittent search failures.
// Reuse neither model claims nor prices; the prior proof must still pass identity checks.
export async function reuseRecentProductIdentity(product: Product, db: Pick<Database,"query">,
  verify: (asin: string) => Promise<string> = verifyAmazonProductPage): Promise<Product> {
  const source=amazonProduct(product.sourceUrl);
  if (!source) throw new Error(PRODUCT_UNRESOLVED);
  bindAmazonProduct(product);
  const rows=await db.query("SELECT snapshot FROM content_jobs WHERE created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 100");
  const words=product.name.toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]{4,}/gu) || [];
  if (!words.length) throw new Error(PRODUCT_UNRESOLVED);
  for(const row of rows.rows) {
    try {
      const prior=parseJob(row.snapshot).opportunity.product;
      requireProduct(prior);
      if (prior.asin!==source.asin || prior.sourceUrl!==source.productUrl || !prior.productVerifiedAt
        || Date.now()-Date.parse(prior.productVerifiedAt)>24*60*60*1000
        || !words.every(word=>prior.name.toLocaleLowerCase("de-DE").includes(word))) continue;
      const liveName=(await verify(source.asin)).trim().slice(0,160);
      if (!liveName || !words.some(word=>liveName.toLocaleLowerCase("de-DE").includes(word))) continue;
      const verified=bindAmazonProduct({...product,name:liveName,productVerifiedName:liveName,productVerifiedAt:new Date().toISOString(),
        asin:source.asin,productUrl:source.productUrl});
      requireProduct(verified);
      return verified;
    } catch { /* A malformed old job is not identity evidence. */ }
  }
  throw new Error(PRODUCT_UNRESOLVED);
}

export async function findAmazonProduct(categoryName: string, query: string, targetGroup: string,
  search = tavilySearch, verify: (asin: string) => Promise<string> = verifyAmazonProductPage) {
  // Category and bestseller hits often precede detail pages in the index.
  const results = await search({ query: `site:amazon.de ${query}`, maxResults: 10 });
  // A scout seed is a category idea, not yet an identified product. Bind its actual result title.
  const categoryWords = categoryName.toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]{4,}/gu) || [];
  let blocked = false;
  const details=results.filter(item=>amazonProduct(item.url));
  const relevant=details.filter(item=>categoryWords.some(word=>item.title.toLocaleLowerCase("de-DE").includes(word)));
  for (const found of relevant) {
    const name = found.title.replace(/\s*[:|–-]\s*Amazon\.de(?:\s*:.*)?$/i, "").trim().slice(0,160);
    try {
      const product = await resolveAmazonProduct({ name, sourceUrl: found.url, affiliateUrl: "", price: "", targetGroup,
        benefits: "Eignung und Eigenschaften am konkreten Modell prüfen.", notes: "Produktidentität anhand der aktuellen Amazon-Produktseite geprüft; keine Eigenschaften oder Preise verifiziert." }, async () => results, verify);
      if (categoryWords.some(word => product.name.toLocaleLowerCase("de-DE").includes(word))) return product;
      console.info(JSON.stringify({event:"amazon_resolution",stage:"category_live_title_mismatch"}));
    } catch (error) { if (error instanceof Error && error.message === "amazon_verification_blocked") blocked = true; }
  }
  console.info(JSON.stringify({event:"amazon_resolution",stage:blocked?"live_blocked":relevant.length?"no_verified_category_match":"no_indexed_category_match",indexed:results.length,details:details.length,relevant:relevant.length}));
  if (blocked) throw new Error("amazon_verification_blocked");
  throw new Error(PRODUCT_UNRESOLVED);
}

// A supplied exact ASIN needs a current Amazon detail-page title, not an
// additional paid index search that may not have indexed this listing yet.
export async function findAmazonProductByAsin(asin: string,
  verify: (asin: string) => Promise<string> = verifyAmazonProductPage) {
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error(PRODUCT_UNRESOLVED);
  const name = (await verify(asin)).trim().slice(0,160);
  if (name.length < 6) throw new Error(PRODUCT_UNRESOLVED);
  const product = bindAmazonProduct({ name, productVerifiedName:name, productVerifiedAt:new Date().toISOString(),
    sourceUrl: `https://www.amazon.de/dp/${asin}`, affiliateUrl: "", price: "",
    targetGroup: "Menschen mit passender Alltagssituation", benefits: "Eignung und Lieferumfang vor dem Kauf prüfen.",
    notes: "Identität durch aktuelle Amazon-Seite belegt; Merkmale und Preis nicht belegt." });
  requireProduct(product);
  return product;
}

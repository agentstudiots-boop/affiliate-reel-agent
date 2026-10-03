import type { Sql } from "../memory/db";
import { amazonProduct } from "../amazon";
import { cleanAmazonTitle } from "../product-resolver";
import { BUILT_IN_CATEGORIES, labelFor, type Registry } from "../content/taxonomy";
import { loadRegistry } from "../content/category-store";
import { describeProduct, type ProductDescription } from "./description";

// Read-only view over what already exists: a Facebook publication that is `published`, its stored image,
// the verified product data (title, ASIN), the saved affiliate link and the job category.
// The Facebook caption is social copy and is never used as product description. Nothing is written.
export type PublishedProduct = {
  id: string; contentId: string; asin: string; name: string; imageUrl: string; description: ProductDescription; affiliateUrl: string;
  category: string; categoryLabel: string; publishedAt: string;
};

// The label comes from the controlled taxonomy (built-in names + operator-created categories); the key is what is stored.
export const categoryLabel = (key: string, registry: Registry = BUILT_IN_CATEGORIES) => labelFor(key, registry);

// Short heading: decoded Amazon title shortened at a word boundary.
export function shortName(value: unknown, length = 64) {
  const name = cleanAmazonTitle(String(value ?? ""));
  if (name.length <= length) return name;
  const cut = name.slice(0, length), space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 28 ? space : length).replace(/[\s,;:–-]+$/, "")} …`;
}

function validImage(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch { return false; }
}
// Only a real Amazon.de product detail link with the stored tracking tag becomes a button, and it must
// point to exactly the stored ASIN of this product (no search, category or other Amazon page).
function affiliateAsin(value: unknown, expected: unknown) {
  try {
    const url = new URL(String(value));
    const product = amazonProduct(url.href);
    if (!product || !url.searchParams.get("tag")) return null;
    return expected && String(expected) !== product.asin ? null : product.asin;
  } catch { return null; }
}

export async function loadPublishedProducts(db: Sql, category?: string | null) {
  const result = await db.query(`
    SELECT p.id,p.job_id,p.image_url,j.category,
      COALESCE(pub.published_at,p.updated_at) AS published_at,
      j.snapshot->'opportunity'->'product'->>'name' AS name,
      j.snapshot->'opportunity'->'product'->>'productVerifiedName' AS verified_name,
      j.snapshot->'opportunity'->'product'->>'asin' AS asin,
      j.snapshot->'opportunity'->'product'->>'affiliateUrl' AS affiliate_url,
      j.snapshot->'opportunity'->'verifiedFacts' AS verified_facts
    FROM publication_requests p
    JOIN content_jobs j ON j.id=p.job_id
    LEFT JOIN publications pub ON pub.job_id=p.job_id AND pub.platform='facebook'
    WHERE p.status='published' AND p.platform='facebook' AND p.image_url IS NOT NULL AND p.caption<>''
    ORDER BY COALESCE(pub.published_at,p.updated_at) DESC
    LIMIT 120`);
  const registry = await loadRegistry(db).catch(() => BUILT_IN_CATEGORIES);
  const all: PublishedProduct[] = [];
  for (const row of result.rows) {
    const asin = affiliateAsin(row.affiliate_url, row.asin);
    if (!validImage(row.image_url) || !asin) continue;
    const name = shortName(row.name);
    if (!name) continue;
    all.push({ id: String(row.id), contentId: String(row.job_id), asin, name, imageUrl: String(row.image_url),
      description: describeProduct({ name: row.name, verifiedName: row.verified_name, verifiedFacts: row.verified_facts }), affiliateUrl: String(row.affiliate_url),
      category: String(row.category), categoryLabel: categoryLabel(String(row.category), registry), publishedAt: new Date(String(row.published_at)).toISOString() });
  }
  const categories = [...new Map(all.map(item => [item.category, item.categoryLabel])).entries()].map(([value, label]) => ({ value, label }));
  const items = category ? all.filter(item => item.category === category) : all;
  return { items, categories };
}

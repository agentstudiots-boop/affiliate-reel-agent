import type { Sql } from "../memory/db";
import { amazonProduct } from "../amazon";
import { cleanAmazonTitle } from "../product-resolver";

// Read-only view over what already exists: a Facebook publication that is `published`,
// its stored image, the final approved caption, the saved affiliate link and the job category.
// Nothing is written, nothing is duplicated.
export type PublishedProduct = {
  id: string; contentId: string; name: string; imageUrl: string; excerpt: string; affiliateUrl: string;
  category: string; categoryLabel: string; publishedAt: string;
};

export const CATEGORY_LABELS: Record<string, string> = {
  general: "Allgemein", kitchen: "Küche", household: "Haushalt", home_living: "Home & Living", technology: "Technik", leisure: "Freizeit",
};
export const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category;

// Excerpt = a truncation of the approved caption (link and disclosure lines removed, nothing added or reworded).
export function excerpt(caption: string, length = 180) {
  const text = caption.split(/\n+/).map(line => line.trim())
    .filter(line => line && !/^werbung\b/i.test(line) && !/^produkt direkt ansehen/i.test(line) && !/https?:\/\//i.test(line)).join(" ");
  if (text.length <= length) return text;
  const window = text.slice(0, length);
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentence >= 60) return window.slice(0, sentence + 1);
  const space = window.lastIndexOf(" ");
  return `${window.slice(0, space > 60 ? space : length).replace(/[\s,;:–-]+$/, "")} …`;
}

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
// Only a real Amazon.de product link that carries the stored tracking tag becomes a button.
function validAffiliate(value: unknown) {
  try {
    const url = new URL(String(value));
    return !!amazonProduct(url.href) && !!url.searchParams.get("tag");
  } catch { return false; }
}

export async function loadPublishedProducts(db: Sql, category?: string | null) {
  const result = await db.query(`
    SELECT p.id,p.job_id,p.image_url,p.caption,j.category,
      COALESCE(pub.published_at,p.updated_at) AS published_at,
      j.snapshot->'opportunity'->'product'->>'name' AS name,
      j.snapshot->'opportunity'->'product'->>'affiliateUrl' AS affiliate_url
    FROM publication_requests p
    JOIN content_jobs j ON j.id=p.job_id
    LEFT JOIN publications pub ON pub.job_id=p.job_id AND pub.platform='facebook'
    WHERE p.status='published' AND p.platform='facebook' AND p.image_url IS NOT NULL AND p.caption<>''
    ORDER BY COALESCE(pub.published_at,p.updated_at) DESC
    LIMIT 120`);
  const all: PublishedProduct[] = [];
  for (const row of result.rows) {
    if (!validImage(row.image_url) || !validAffiliate(row.affiliate_url)) continue;
    const name = shortName(row.name);
    if (!name) continue;
    all.push({ id: String(row.id), contentId: String(row.job_id), name, imageUrl: String(row.image_url), excerpt: excerpt(String(row.caption)), affiliateUrl: String(row.affiliate_url),
      category: String(row.category), categoryLabel: categoryLabel(String(row.category)), publishedAt: new Date(String(row.published_at)).toISOString() });
  }
  const categories = [...new Map(all.map(item => [item.category, item.categoryLabel])).entries()].map(([value, label]) => ({ value, label }));
  const items = category ? all.filter(item => item.category === category) : all;
  return { items, categories };
}

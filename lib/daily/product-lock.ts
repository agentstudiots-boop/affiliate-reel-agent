import type { Database, Sql } from "../memory/db";
import type { Product } from "../types";
import { amazonProduct } from "../amazon";

// Deliberately small taxonomy. Unknown products are blocked by ASIN only,
// rather than collapsing unrelated products into an arbitrary broad category.
export function productFamily(name: string): string | null {
  const s = name.toLocaleLowerCase("de-DE").normalize("NFKD").replace(/\p{M}/gu, "");
  if (/kurbis|kuerbis|pumpkin/.test(s) && /schnitz|carv/.test(s)) return "pumpkin_carving_kit";
  if (/vakuumier|vacuum.seal/.test(s)) return "vacuum_sealer";
  if (/saugroboter|robot.*(saug|vacuum)|robot.vacuum/.test(s)) return "robot_vacuum";
  if (/kuscheldecke|throw.blanket/.test(s)) return "throw_blanket";
  return null;
}

export async function productOnCooldown(db: Sql, product: Product, jobId = "00000000-0000-0000-0000-000000000000"): Promise<boolean> {
  const asin = product.asin || amazonProduct(product.sourceUrl)?.asin;
  if (!asin) return true;
  const keys = [`asin:${asin}`, ...(productFamily(product.name) ? [`family:${productFamily(product.name)}`] : [])];
  const locked = await db.query(
    "SELECT 1 FROM product_selection_locks WHERE key=ANY($1::text[]) AND expires_at>now() AND job_id<>$2 LIMIT 1",
    [keys, jobId],
  );
  if (locked.rows.length) return true;
  const recent = await db.query(
    `SELECT j.opportunity->'product' AS product FROM content_jobs j
     WHERE j.id<>$1 AND (
       j.status='awaiting_approval'
       OR (j.created_at>now()-interval '7 days' AND j.status NOT IN ('failed','rejected','needs_input'))
       OR EXISTS(SELECT 1 FROM publications p WHERE p.job_id=j.id AND p.status='published'
         AND p.published_at>now()-interval '7 days')
       OR EXISTS(SELECT 1 FROM publication_requests r WHERE r.job_id=j.id
         AND r.status='published' AND r.updated_at>now()-interval '7 days')
       OR EXISTS(SELECT 1 FROM publication_requests r WHERE r.job_id=j.id
         AND r.status IN ('preparing','pending','approved','publishing','unknown'))
     )`, [jobId],
  );
  return recent.rows.some(row => {
    const prior = row.product as { asin?: string; name?: string } | null;
    return prior?.asin === asin || !!(prior?.name && productFamily(product.name)
      && productFamily(prior.name) === productFamily(product.name));
  });
}

export async function reserveProduct(db: Database, product: Product, jobId: string): Promise<boolean> {
  const asin = product.asin || amazonProduct(product.sourceUrl)?.asin;
  if (!asin) return false;
  const keys = [`asin:${asin}`, ...(productFamily(product.name) ? [`family:${productFamily(product.name)}`] : [])];
  return db.transaction(async sql => {
    // Serialize selection across workers, including two daily slots and manual searches.
    await sql.query("SELECT pg_advisory_xact_lock($1)", [83624002]);
    if (await productOnCooldown(sql,product,jobId)) return false;
    for (const key of keys) {
      await sql.query(
        `INSERT INTO product_selection_locks(key,job_id,expires_at) VALUES($1,$2,now()+interval '7 days')
         ON CONFLICT(key) DO UPDATE SET job_id=excluded.job_id,expires_at=excluded.expires_at`,
        [key, jobId],
      );
    }
    return true;
  });
}

export async function releaseProduct(db: Database, jobId: string) {
  await db.query("DELETE FROM product_selection_locks WHERE job_id=$1", [jobId]);
}

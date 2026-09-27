import { getDatabase, type Database } from "../memory/db";
import { parseJob } from "../content/history";
import { requireProduct } from "../amazon";
import { sendWhatsAppText } from "../whatsapp/client";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";

// Link stickers cannot be added by the Instagram publishing API. Hand over the
// already approved original image and exact product URL for app-side posting.
export async function sendStoryHandoff(publicationId: string, db: Database = getDatabase(), send = sendWhatsAppText) {
  await ensureAutomationSchema(db);
  const claimed = await db.query(`INSERT INTO story_handoffs(publication_id)
    SELECT id FROM publication_requests WHERE id=$1 AND status='published' AND platform='facebook'
    ON CONFLICT DO NOTHING RETURNING publication_id`, [publicationId]);
  if (!claimed.rows.length) return false;
  const data = await db.query(`SELECT p.image_url,j.snapshot
    FROM publication_requests p JOIN content_jobs j ON j.id=p.job_id WHERE p.id=$1`, [publicationId]);
  const row = data.rows[0];
  if (!row?.image_url) throw new Error("Kein freigegebenes Originalbild für Story vorhanden.");
  const product = parseJob(row.snapshot).opportunity.product;
  requireProduct(product);
  const messageId = await send(`Story-Vorlage für Facebook und Instagram zum freigegebenen Bildpost:\nBild herunterladen: ${row.image_url}\nProduktlink für den Link-Sticker: ${product.affiliateUrl}\n\nIn der Facebook- und Instagram-App jeweils eine Story mit diesem Bild anlegen, Link-Sticker einfügen, diese Produkt-URL einsetzen und den Link vor dem Teilen antippen und prüfen. Erst dann die jeweilige Story in der App veröffentlichen. Keine Story wurde automatisch gepostet; es fallen keine weiteren Bildgenerierungen an.`);
  await db.query("UPDATE story_handoffs SET whatsapp_message_id=$2 WHERE publication_id=$1", [publicationId, messageId]);
  return true;
}

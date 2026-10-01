import type { Database } from "../memory/db";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { CategoryChangeError, createCategory, loadRegistry, setJobCategory } from "../content/category-store";
import { resolveCategory, validNewName, labelFor } from "../content/taxonomy";

type Message = IncomingWhatsAppMessage & { payload: unknown };
export type CategoryRequest = { draftId: string; name: string | null; create: boolean; forceNew: boolean };

const list = (labels: string[]) => labels.join(", ");

// Deterministic execution of an understood category wish for ONE content record.
// Existing category: set it. Unknown name: only created on an explicit „neue Kategorie“ instruction.
// Similar name: ask instead of guessing. The product, ASIN, link, image and caption are never touched.
export async function changeCategory(input: Message, request: CategoryRequest, deps: {
  db: Database; send?: typeof sendWhatsAppText; sendApproval: (jobId: string) => Promise<boolean>;
}) {
  const { db, sendApproval } = deps;
  const send = deps.send ?? sendWhatsAppText;
  await ensureAutomationSchema(db);
  const claim = await db.query("INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)]);
  if (!claim.rows.length) return true;
  const registry = await loadRegistry(db);
  const available = `Vorhandene Kategorien: ${list(registry.map(item => item.label))}.`;
  const log = (outcome: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ event: "category_change", jobId: request.draftId, outcome, requested: request.name?.slice(0, 40), ...extra }));

  if (!request.name) { log("no_name"); await send(`Welche Kategorie soll es sein? ${available} Es wurde nichts geändert.`); return true; }
  const known = resolveCategory(request.name, registry);
  let target = known.kind === "match" ? known.category : null;

  if (!target && known.kind === "similar" && !request.forceNew) {
    log("similar_ask", { similar: known.category.key });
    await send(`Meinst du die bestehende Kategorie „${known.category.label}“? Dann schreibe „Kategorie ${known.category.label}“. Soll „${request.name.slice(0, 30)}“ wirklich eine eigene, neue Kategorie werden, schreibe „Ja, neue Kategorie ${request.name.slice(0, 30)} anlegen“. Es wurde nichts geändert.`);
    return true;
  }
  if (!target) {
    if (!request.create && !request.forceNew) {
      log("unknown_not_created");
      await send(`Die Kategorie „${request.name.slice(0, 30)}“ gibt es nicht. ${available} Soll ich sie neu anlegen, schreibe „Mach dafür eine neue Kategorie ${request.name.slice(0, 30)}“. Es wurde nichts geändert.`);
      return true;
    }
    if (!validNewName(request.name)) { log("invalid_name"); await send("Dieser Kategoriename ist nicht geeignet (zwei bis 30 Zeichen, höchstens drei Wörter, nur Buchstaben und Ziffern). Bitte nenne einen kurzen Namen. Es wurde nichts geändert."); return true; }
    const created = await createCategory(db, request.name, input.id);
    if ("error" in created) { log("invalid_name"); await send("Diese Kategorie konnte ich nicht sauber anlegen; bitte nenne einen anderen Namen. Es wurde nichts geändert."); return true; }
    target = created.category;
    log(created.created ? "created" : "existing_after_normalization", { key: target.key });
  }

  try {
    const result = await setJobCategory(db, request.draftId, target.key);
    if (!result.changed) {
      log("unchanged", { key: target.key });
      await send(`Die Kategorie bleibt „${target.label}“. Es wurde nichts geändert, deine Freigabenachricht gilt weiter.`);
      return true;
    }
    log("changed", { key: target.key, from: result.previous });
    await send(`Kategorie ${result.previous === target.key ? "" : `von „${labelFor(result.previous, registry)}“ `}auf „${target.label}“ gesetzt. Produkt, ASIN, Link, Bild und Text sind unverändert. Du bekommst gleich die aktualisierte Inhaltsfreigabe; noch nichts ist veröffentlicht.`);
    try { await sendApproval(request.draftId); } catch { console.error(JSON.stringify({ event: "category_change_approval_unsent", jobId: request.draftId })); }
  } catch (error) {
    if (error instanceof CategoryChangeError) {
      log("blocked", { reason: error.message });
      await send("Dieser Entwurf wartet nicht mehr auf die Inhaltsfreigabe; die Kategorie wurde nicht geändert.");
      return true;
    }
    throw error;
  }
  return true;
}

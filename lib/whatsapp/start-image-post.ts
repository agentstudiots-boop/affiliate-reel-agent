import type { Database } from "../memory/db";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { amazonProduct } from "../amazon";
import { createHash } from "node:crypto";
import { asinFromOperatorLink, operatorProductLink } from "./product-link";
import { replacementRequest, supersedeOpenDraft } from "./replace-draft";
import { startActiveOrder } from "./active-context";
import { orderFailureText, settleOrderFromDraft } from "./manual-order";

// The active context must never stop an order that is already claimed: a failed context write is logged, the order runs.
async function remember(step: () => Promise<unknown>) {
  try { await step(); } catch { console.error(JSON.stringify({ event: "whatsapp_active_order_unsaved" })); }
}

// Only standalone, unambiguous requests start a new search. Replies always
// remain corrections or decisions for the message they reference.
type ImagePostCommand={product?:string;search?:string;link?:string;pending?:boolean;invalid:boolean};
const wantsNewProduct = (text:string) => /\b(?:neue[nsr]?\s+auftrag|keinen\s+bestehenden\s+auftrag|dieses\s+produkt\s+bewerben|neue[nrs]?\s+produkt(?:post|beitrag)|erstelle\s+(?:mir\s+)?(?:einen\s+)?(?:neuen\s+)?(?:auftrag|affiliate[- ]?link))\b/i.test(text);
export function imagePostCommand(body: string):ImagePostCommand|null {
  if (body.trim().endsWith("?")) return null; // Questions never start a paid search; URL query strings are valid.
  const text = body.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  const link=operatorProductLink(text);
  if (link && wantsNewProduct(text)) return {link,invalid:false};
  if (link && text === link) return {link,pending:true,invalid:false};
  if (wantsNewProduct(text) && !link) return {invalid:true};
  if (/^(?:artikel|produkt|trend)suche$/i.test(text)
    || /^(?:bitte )?(?:(?:starte|mach|mache) )?(?:eine )?neue (?:artikel|produkt|trend)suche$/i.test(text)
    || /^(?:bitte )?(?:suche|such|finde) (?:mir )?(?:einen neuen artikel|ein neues produkt)$/i.test(text)
    || /^(?:bitte )?(?:einen neuen artikel|ein neues produkt) suchen$/i.test(text)) {
    return { product: undefined, invalid: false };
  }
  const targeted=text.match(/^(?:bitte\s+)?(?:(?:starte|mach|mache)\s+)?(?:eine?\s+)?(?:neue?\s+)?(?:artikel|produkt)suche(?:\s*[:–-]\s*|\s+)(.+)$/i);
  const natural=text.match(/^(?:bitte\s+)?(?:such|suche|finde)\s+mir\s+eine[nm]?\s+(.+)$/i);
  if(targeted || natural){
    const search=(targeted?.[1] || natural![1]).trim().replace(/^\(/,'').replace(/^produktname\s*[:–-]?\s*/i,'').replace(/^für\s+/i,'').replace(/\)$/, '').trim();
    if(/\b(?:freigabe\w*|freigegeben\w*|bestehend\w*|änderung\w*|korrektur\w*|post|bild|beitrag|entwurf)\b/i.test(search))return null;
    return search.length>=3 && search.length<=90 && search.split(' ').length<=8
      && /^[\p{L}\p{N}][\p{L}\p{N}\s.,+&-]*$/u.test(search)
      ? {product:undefined,search,invalid:false}:{product:undefined,invalid:true};
  }
  const match = text.match(/^bildpost(?:\s+(.*))?$/i);
  if (!match) return null;
  if (!match[1]) return { product: undefined, invalid: false };
  const arg = match[1].trim();
  if (/^[A-Z0-9]{10}$/i.test(arg)) return { product: arg.toUpperCase(), invalid: false };
  const product = amazonProduct(arg);
  return product ? { product: product.asin, invalid: false }
    : link ? {link,invalid:false} : { product: undefined, invalid: true };
}

export async function startImagePostFromWhatsApp(input: IncomingWhatsAppMessage & { payload: unknown },
  database: () => Database, start: typeof import("../daily/draft").createDailyDraft, send = sendWhatsAppText,
  resolveLink: typeof asinFromOperatorLink = asinFromOperatorLink): Promise<boolean> {
  let command = input.replyToMessageId ? null : imagePostCommand(input.body);
  const replacement = command ? null : replacementRequest(input.body);
  // A forwarded Amazon link (with preview text) is a product link, not a correction of an open draft.
  const bareLink = !command && !replacement && !input.replyToMessageId && !input.body.trim().endsWith("?") ? operatorProductLink(input.body) : null;
  if (bareLink) command = { link: bareLink, pending: true, invalid: false };
  const quotedNewProduct = !!input.replyToMessageId && !input.body.includes("?") && wantsNewProduct(input.body);
  if (quotedNewProduct) command = imagePostCommand(input.body) || {invalid:true};
  if (!command && !replacement) return false;
  const trusted = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!trusted || input.from.replace(/\D/g, "") !== trusted) return true;
  const db=database();
  if (!command && replacement) return startProductSearch(input, { search: replacement.search, replace: true, replyToMessageIdForReplace: input.replyToMessageId }, db, start, send);
  if (!command) return false;
  let sourceId=input.id;
  if (quotedNewProduct && !command?.link) {
    const quote=await db.query(`SELECT body FROM whatsapp_events
      WHERE message_id=$1 AND wa_id=$2 AND received_at>now()-interval '30 minutes'`,[input.replyToMessageId,input.from]);
    const link=quote.rows[0] ? operatorProductLink(String(quote.rows[0].body)) : null;
    if (link) { command={link,invalid:false};sourceId=input.replyToMessageId!; }
  }
  // „Neuer Auftrag“ shortly before a link means: this link starts the new job.
  if (bareLink) {
    const recent = await db.query(`SELECT body FROM whatsapp_events WHERE wa_id=$1 AND message_id<>$2
      AND received_at>now()-interval '15 minutes' ORDER BY received_at DESC LIMIT 3`, [input.from, input.id]);
    if (recent.rows.some(row => wantsNewProduct(String(row.body || "").replace(/[.!?]+$/, "").trim()) && !operatorProductLink(String(row.body || "")))) command = { link: bareLink, invalid: false };
  }
  const claim = await db.query(
    "INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)],
  );
  if (!claim.rows.length) return true;
  if (command.invalid) {
    await send("Was soll ich bewerben? Schreibe „Artikelsuche <Produkt>“, zum Beispiel „Artikelsuche Silpat Backmatte“, oder sende einen Amazon-Link mit „Neuer Auftrag“. Es wurde nichts gestartet.");
    return true;
  }
  if (command.pending) {
    await send("Produktlink erhalten. Antworte direkt auf deine Link-Nachricht mit „Ich möchte dieses Produkt bewerben“ für einen neuen, getrennten Auftrag. Noch keine Suche oder Produktion gestartet.");
    return true;
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const slot = `manual:${createHash("sha256").update(sourceId).digest("hex")}`;
  if (sourceId !== input.id) {
    const existing=await db.query("SELECT status FROM daily_drafts WHERE day=$1 AND slot=$2",[day,slot]);
    if (existing.rows.length) { await send(`Dieser Produktlink hat bereits einen Auftrag (${existing.rows[0].status}). Sende „Status“ für den aktuellen Stand; es wurde nichts erneut gestartet.`); return true; }
  }
  let product=command.product;
  if (command.link) {
    try { product=await resolveLink(command.link); }
    catch {
      console.info(JSON.stringify({event:"whatsapp_product_link_unresolved"}));
      await send("Der Kurzlink ließ sich keiner eindeutigen Amazon-Produktdetailseite und ASIN zuordnen. Bitte sende die konkrete ASIN oder den direkten Amazon.de/dp/-Link. Keine Suche, kein Bild und keine Veröffentlichung gestartet.");
      return true;
    }
  }
  // An explicitly named product (ASIN, link, product search) is an operator order: it becomes the active WhatsApp context
  // and overrides the TrendScout cooldown (never duplicate protection, content review or approvals).
  const named = !!(product || command.search);
  if (named) await remember(() => startActiveOrder(db, { waId: input.from, messageId: input.id, productLabel: command.search ?? `ASIN ${product}`, asin: product ?? null, searchTerm: command.search ?? null }));
  const result = await start(day, slot, product, command.search, named ? { mandate: true } : {});
  if (named) await remember(() => settleOrderFromDraft(db, input.from, input.id, result));
  if (result.status === "failed" || result.status === "needs_input") {
    const subject = command.search ? `Trendscout-Suche nach „${command.search}“`
      : `${command.link ? "Produktlink" : command.product ? "Bildpost" : "Artikelsuche"} (Auftrag ${result.jobId})`;
    const reason = result.reason === "product_unresolved"
      ? command.link || command.product
        ? "Die Amazon-Produktdetailseite und ASIN konnten nicht sicher verifiziert werden. Bitte die konkrete Amazon.de/dp/-Seite prüfen."
        : "Der Trendscout konnte keine passende Amazon-Produktseite sicher verifizieren. Bitte eine Produktart oder eine konkrete ASIN nennen."
      : result.reason === "amazon_identity_missing"
        ? "Amazon antwortete, aber die Seite enthielt keinen eindeutigen Nachweis für diese ASIN. Derselbe Link wird nicht automatisch erneut geprüft. Bitte die Produktseite und ASIN im Browser prüfen; noch kein sicher gebundener Artikel."
      : result.reason === "amazon_verification_blocked"
        ? "Amazon hat die automatische Prüfung der Produktseite blockiert. Der Artikel bleibt ungeprüft und es wird kein Content produziert."
      : result.reason === "product_already_open"
        ? orderFailureText("product_already_open")
      : result.reason === "product_repeat_blocked"
        ? "Dieses Produkt oder seine Produktfamilie ist bereits in einem offenen Entwurf oder wurde innerhalb der letzten sieben Tage verwendet. Bitte wähle eine andere Produktart."
      : result.reason === "product_data_uncertain"
        ? "Die Produktdaten dieses Artikels belegen die geplanten Aussagen nicht. Ich rate nicht und erzeuge keine Freigabe. Nenne ein anderes Produkt oder sende den Amazon-Link eines genauer passenden Artikels."
      : result.reason === "missing_caption"
        ? "Der Beitragstext fehlt. Die Inhaltsfreigabe wurde nicht versendet; bitte den Entwurf prüfen."
      : result.reason === "editorial_rate_limited"
        ? "Replicate hat die redaktionelle Anfrage auch nach einer kurzen Wartezeit gedrosselt. Der Auftrag bleibt angehalten. Ein neuer Versuch kann später mit einer neuen Artikelsuche gestartet werden."
      : result.reason === "editorial_model_failed"
        ? "Das redaktionelle Sprachmodell hat keinen sicher prüfbaren Bildentwurf geliefert. Bitte den Modellzugang und das Guthaben prüfen; dieser Auftrag startet nicht automatisch erneut."
        : result.reason === "content_review_failed"
          ? `Auch nach Überarbeitung liegt kein freigabefähiger Bildentwurf vor. ${result.reviewIssues?.length ? `Konkrete Gründe: ${result.reviewIssues.join(" ")}` : "Bitte starte mit „Artikelsuche <Produkt>“ neu."} Für eine neue Produktsuche sende „Artikelsuche“; kein Auftrag wird stillschweigend freigegeben.`
          : "Die Planung wurde durch einen technischen Fehler unterbrochen. Schreibe „Status“ für Details oder starte mit „Artikelsuche <Produkt>“ neu.";
    await send(`${subject}: ${reason} Kein Bild gekauft und nichts veröffentlicht.`);
  } else if (result.status === "awaiting_approval" && result.whatsapp !== "approval_sent") {
    await send(`Bildpost-Entwurf ${result.jobId} ist gespeichert, die Freigabenachricht konnte noch nicht zugestellt werden. Kein Bild gekauft und nichts veröffentlicht.`);
  }
  return true;
}

// Product search, optionally replacing an open draft (stop it like „Ablehnen“, then search).
// A missing search term starts the open TrendScout search; the system chooses the product.
export async function startProductSearch(input: IncomingWhatsAppMessage & { payload: unknown },
  request: { search?: string | null; replaceDraftId?: string | null; replace?: boolean; replyToMessageIdForReplace?: string | null; note?: string | null },
  db: Database, start: typeof import("../daily/draft").createDailyDraft, send: typeof sendWhatsAppText) {
  const claim = await db.query(
    "INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)]);
  if (!claim.rows.length) return true;
  const search = request.search?.trim() || undefined;
  // A named search is an operator order (cooldown override, active context); an open search stays automatic.
  if (search) await remember(() => startActiveOrder(db, { waId: input.from, messageId: input.id, productLabel: search, searchTerm: search }));
  const replaced = request.replace || request.replaceDraftId ? await supersedeOpenDraft(db, request.replyToMessageIdForReplace ?? null, request.replaceDraftId ?? null) : null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const slot = `manual:${createHash("sha256").update(input.id).digest("hex")}`;
  await send(`${replaced ? `Alten Entwurf${replaced.name ? ` („${replaced.name.slice(0, 60)}“)` : ""} gestoppt. ` : ""}Ich suche jetzt ${search ? `„${search}“` : "ein neues Produkt"} und schicke dir danach eine neue Inhaltsfreigabe.${request.note ? ` ${request.note}` : ""} Das dauert einen Moment; es wurde nichts produziert oder veröffentlicht.`);
  const result = await start(day, slot, undefined, search, search ? { mandate: true } : {});
  if (search) await remember(() => settleOrderFromDraft(db, input.from, input.id, result));
  if (result.status === "failed" || result.status === "needs_input") {
    const reason = result.reason === "product_already_open" ? orderFailureText("product_already_open")
      : result.reason === "product_unresolved" ? "Ich konnte dazu keine passende, sicher geprüfte Amazon-Produktseite finden. Nenne bitte eine genauere Produktart oder sende einen Amazon-Link."
      : result.reason === "product_repeat_blocked" ? "Dieses Produkt oder seine Produktfamilie wurde in den letzten sieben Tagen schon verwendet oder gerade abgelehnt."
      : result.reason === "amazon_verification_blocked" ? "Amazon hat die automatische Prüfung blockiert."
      : result.reason === "product_data_uncertain" ? "Die Produktdaten dieses Artikels belegen die geplanten Aussagen nicht; ich rate nicht und erzeuge keine Freigabe. Nenne ein anderes Produkt oder sende den Amazon-Link eines genauer passenden Artikels."
      : "Die Planung konnte nicht abgeschlossen werden. Schreibe „Status“ für den Grund.";
    await send(`Suche${search ? ` nach „${search}“` : ""}: ${reason} Nichts veröffentlicht.`);
  } else if (result.status === "awaiting_approval" && result.whatsapp !== "approval_sent") {
    await send("Der neue Entwurf ist gespeichert, die Freigabenachricht konnte noch nicht zugestellt werden. Schreibe „Status“, dann sende ich sie.");
  }
  return true;
}

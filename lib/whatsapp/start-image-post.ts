import type { Database } from "../memory/db";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { amazonProduct } from "../amazon";
import { createHash } from "node:crypto";
import { asinFromOperatorLink, operatorProductLink } from "./product-link";

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
  const quotedNewProduct = !!input.replyToMessageId && !input.body.includes("?") && wantsNewProduct(input.body);
  if (quotedNewProduct) command = imagePostCommand(input.body) || {invalid:true};
  if (!command) return false;
  const trusted = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!trusted || input.from.replace(/\D/g, "") !== trusted) return true;
  const db=database();
  let sourceId=input.id;
  if (quotedNewProduct && !command?.link) {
    const quote=await db.query(`SELECT body FROM whatsapp_events
      WHERE message_id=$1 AND wa_id=$2 AND received_at>now()-interval '30 minutes'`,[input.replyToMessageId,input.from]);
    const link=quote.rows[0] ? operatorProductLink(String(quote.rows[0].body)) : null;
    if (link) { command={link,invalid:false};sourceId=input.replyToMessageId!; }
  }
  const claim = await db.query(
    "INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)],
  );
  if (!claim.rows.length) return true;
  if (command.invalid) {
    await send("Bitte sende „Neuer Auftrag“ mit einem Amazon-Produktlink oder „Bildpost B0…“ mit einer konkreten ASIN. Es wurde nichts gestartet.");
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
  const result = await start(day, slot, product, command.search);
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
      : result.reason === "product_repeat_blocked"
        ? "Dieses Produkt oder seine Produktfamilie ist bereits in einem offenen Entwurf oder wurde innerhalb der letzten sieben Tage verwendet. Bitte wähle eine andere Produktart."
      : result.reason === "missing_caption"
        ? "Der Beitragstext fehlt. Die Inhaltsfreigabe wurde nicht versendet; bitte den Entwurf prüfen."
      : result.reason === "editorial_rate_limited"
        ? "Replicate hat die redaktionelle Anfrage auch nach einer kurzen Wartezeit gedrosselt. Der Auftrag bleibt angehalten. Ein neuer Versuch kann später mit einer neuen Artikelsuche gestartet werden."
      : result.reason === "editorial_model_failed"
        ? "Das redaktionelle Sprachmodell hat keinen sicher prüfbaren Bildentwurf geliefert. Bitte den Modellzugang und das Guthaben prüfen; dieser Auftrag startet nicht automatisch erneut."
        : result.reason === "content_review_failed"
          ? `Auch nach Überarbeitung liegt kein freigabefähiger Bildentwurf vor. ${result.reviewIssues?.length ? `Konkrete Gründe: ${result.reviewIssues.join(" ")}` : "Bitte den Entwurf und die Prüfpunkte im Content Studio ansehen."} Für eine neue Produktsuche sende „Artikelsuche“; kein Auftrag wird stillschweigend freigegeben.`
          : "Die Planung wurde durch einen technischen Fehler unterbrochen. Bitte den Auftrag im Content Studio prüfen.";
    await send(`${subject}: ${reason} Kein Bild gekauft und nichts veröffentlicht.`);
  } else if (result.status === "awaiting_approval" && result.whatsapp !== "approval_sent") {
    await send(`Bildpost-Entwurf ${result.jobId} ist gespeichert, die Freigabenachricht konnte noch nicht zugestellt werden. Kein Bild gekauft und nichts veröffentlicht.`);
  }
  return true;
}

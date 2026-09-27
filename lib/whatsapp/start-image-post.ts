import type { Database } from "../memory/db";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { amazonProduct } from "../amazon";
import { createHash } from "node:crypto";

// Only standalone, unambiguous requests start a new search. Replies always
// remain corrections or decisions for the message they reference.
type ImagePostCommand={product?:string;search?:string;invalid:boolean};
export function imagePostCommand(body: string):ImagePostCommand|null {
  const text = body.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  if (/^(?:artikel|produkt|trend)suche$/i.test(text)
    || /^(?:bitte )?(?:(?:starte|mach|mache) )?(?:eine )?neue (?:artikel|produkt|trend)suche$/i.test(text)
    || /^(?:bitte )?(?:suche|such|finde) (?:mir )?(?:einen neuen artikel|ein neues produkt)$/i.test(text)
    || /^(?:bitte )?(?:einen neuen artikel|ein neues produkt) suchen$/i.test(text)) {
    return { product: undefined, invalid: false };
  }
  const targeted=text.match(/^(?:bitte\s+)?(?:(?:starte|mach|mache)\s+)?(?:eine?\s+)?(?:neue?\s+)?(?:artikel|produkt)suche(?:\s*[:–-]\s*|\s+)(.+)$/i);
  if(targeted){
    const search=targeted[1].trim().replace(/^\(/,'').replace(/^produktname\s*[:–-]?\s*/i,'').replace(/^für\s+/i,'').replace(/\)$/, '').trim();
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
  return product ? { product: product.asin, invalid: false } : { product: undefined, invalid: true };
}

export async function startImagePostFromWhatsApp(input: IncomingWhatsAppMessage & { payload: unknown },
  database: () => Database, start: typeof import("../daily/draft").createDailyDraft, send = sendWhatsAppText): Promise<boolean> {
  const command = input.replyToMessageId ? null : imagePostCommand(input.body);
  if (!command) return false;
  const trusted = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  if (!trusted || input.from.replace(/\D/g, "") !== trusted) return true;
  const claim = await database().query(
    "INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
    [input.id, input.from, null, input.body, JSON.stringify(input.payload)],
  );
  if (!claim.rows.length) return true;
  if (command.invalid) {
    await send("Bitte sende „Artikelsuche Saugroboter“ mit einer Produktart oder „Bildpost B0…“ mit einer konkreten ASIN. Es wurde nichts gestartet.");
    return true;
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const slot = `manual:${createHash("sha256").update(input.id).digest("hex")}`;
  const result = await start(day, slot, command.product, command.search);
  if (result.status === "failed" || result.status === "needs_input") {
    await send(command.search
      ? `Trendscout-Suche nach „${command.search}“: Es konnte noch kein eindeutig passendes Amazon-Produkt verifiziert und als Bildpost geplant werden. Bitte mit einem genaueren Produktnamen oder einer ASIN erneut suchen. Kein Bild gekauft und nichts veröffentlicht.`
      : `Bildpost-Auftrag ${result.jobId} konnte noch nicht freigabefähig geplant werden. Bitte Produkt und verifizierte Amazon-ASIN prüfen. Es wurde kein Bild gekauft und nichts veröffentlicht.`);
  } else if (result.status === "awaiting_approval" && result.whatsapp !== "approval_sent") {
    await send(`Bildpost-Entwurf ${result.jobId} ist gespeichert, die Freigabenachricht konnte noch nicht zugestellt werden. Kein Bild gekauft und nichts veröffentlicht.`);
  }
  return true;
}

import type { Database } from "../memory/db";
import { sendWhatsAppText } from "./client";
import type { IncomingWhatsAppMessage } from "./security";
import { amazonProduct } from "../amazon";
import { createHash } from "node:crypto";

// Exact command, not a conversational guess: a reply always remains a correction
// or decision for the message it references.
export function imagePostCommand(body: string) {
  const match = body.trim().match(/^bildpost(?:\s+(.*))?$/i);
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
    await send("Bitte sende „Bildpost“ für eine Produktauswahl oder „Bildpost B0…“ mit einer konkreten ASIN beziehungsweise „Bildpost https://www.amazon.de/dp/ASIN“. Es wurde nichts gestartet.");
    return true;
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const slot = `manual:${createHash("sha256").update(input.id).digest("hex")}`;
  const result = await start(day, slot, command.product);
  if (result.status === "failed" || result.status === "needs_input") {
    await send(`Bildpost-Auftrag ${result.jobId} konnte noch nicht freigabefähig geplant werden. Bitte Produkt und verifizierte Amazon-ASIN prüfen. Es wurde kein Bild gekauft und nichts veröffentlicht.`);
  } else if (result.status === "awaiting_approval" && result.whatsapp !== "approval_sent") {
    await send(`Bildpost-Entwurf ${result.jobId} ist gespeichert, die Freigabenachricht konnte noch nicht zugestellt werden. Kein Bild gekauft und nichts veröffentlicht.`);
  }
  return true;
}

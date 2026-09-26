import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWhatsAppChallenge(token: string) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  return !!expected && safeEqual(token, expected);
}

export function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  return safeEqual(signatureHeader, expected);
}

export type IncomingWhatsAppMessage = {
  id: string;
  from: string;
  body: string;
  replyToMessageId: string | null;
};

export function extractIncomingWhatsAppMessages(payload: unknown, expectedPhoneNumberId: string): IncomingWhatsAppMessage[] {
  if (!/^\d+$/.test(expectedPhoneNumberId)) return [];
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return [];
  const result: IncomingWhatsAppMessage[] = [];
  for (const entry of root.entry) {
    if (!entry || typeof entry !== "object") continue;
    const changes = (entry as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      const metadata = (value as Record<string, unknown>).metadata;
      if (!metadata || typeof metadata !== "object" || (metadata as Record<string, unknown>).phone_number_id !== expectedPhoneNumberId) continue;
      const messages = (value as Record<string, unknown>).messages;
      if (!Array.isArray(messages)) continue;
      for (const item of messages) {
        if (!item || typeof item !== "object") continue;
        const message = item as Record<string, unknown>;
        if (message.type !== "text" || typeof message.id !== "string" || typeof message.from !== "string") continue;
        const text = message.text;
        if (!text || typeof text !== "object" || typeof (text as Record<string, unknown>).body !== "string") continue;
        const context = message.context;
        result.push({
          id: message.id,
          from: message.from,
          body: String((text as Record<string, unknown>).body),
          replyToMessageId: context && typeof context === "object" && typeof (context as Record<string, unknown>).id === "string"
            ? String((context as Record<string, unknown>).id)
            : null,
        });
      }
    }
  }
  return result;
}

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
  // Voice/audio message: `body` is empty until the audio has been transcribed by the voice layer.
  audio?: { mediaId: string; mimeType: string };
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
        if (typeof message.id !== "string" || typeof message.from !== "string") continue;
        const context = message.context;
        const replyTo = context && typeof context === "object" && typeof (context as Record<string, unknown>).id === "string"
          ? String((context as Record<string, unknown>).id) : null;
        if (message.type === "audio") {
          const audio = message.audio as Record<string, unknown> | undefined;
          if (audio && typeof audio.id === "string" && /^[A-Za-z0-9_-]{5,100}$/.test(audio.id))
            result.push({ id: message.id, from: message.from, body: "", replyToMessageId: replyTo,
              audio: { mediaId: audio.id, mimeType: typeof audio.mime_type === "string" ? audio.mime_type.slice(0, 80) : "audio/ogg" } });
          continue;
        }
        if (message.type !== "text") continue;
        const text = message.text;
        if (!text || typeof text !== "object" || typeof (text as Record<string, unknown>).body !== "string") continue;
        result.push({
          id: message.id,
          from: message.from,
          body: String((text as Record<string, unknown>).body),
          replyToMessageId: replyTo,
        });
      }
    }
  }
  return result;
}

// Delivery statuses Meta reports for messages this number sent (value.statuses[]). Ids, status and provider error codes
// only; the recipient number is deliberately not kept.
export type WhatsAppDeliveryStatus = { messageId: string; status: "sent" | "delivered" | "read" | "failed"; providerAt: string | null; errorCode: number | null; errorTitle: string | null };
export function extractWhatsAppDeliveryStatuses(payload: unknown, expectedPhoneNumberId: string): WhatsAppDeliveryStatus[] {
  if (!/^\d+$/.test(expectedPhoneNumberId) || !payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return [];
  const result: WhatsAppDeliveryStatus[] = [];
  for (const entry of root.entry) {
    const changes = entry && typeof entry === "object" ? (entry as Record<string, unknown>).changes : null;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change && typeof change === "object" ? (change as Record<string, unknown>).value as Record<string, unknown> | undefined : undefined;
      const metadata = value?.metadata as Record<string, unknown> | undefined;
      if (!value || metadata?.phone_number_id !== expectedPhoneNumberId || !Array.isArray(value.statuses)) continue;
      for (const item of value.statuses) {
        if (!item || typeof item !== "object") continue;
        const status = item as Record<string, unknown>;
        if (typeof status.id !== "string" || !/^[A-Za-z0-9._=:-]{5,200}$/.test(status.id)) continue;
        if (!["sent", "delivered", "read", "failed"].includes(String(status.status))) continue;
        const seconds = Number(status.timestamp);
        const error = Array.isArray(status.errors) && status.errors[0] && typeof status.errors[0] === "object" ? status.errors[0] as Record<string, unknown> : null;
        result.push({ messageId: status.id, status: status.status as WhatsAppDeliveryStatus["status"],
          providerAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
          errorCode: error && Number.isFinite(Number(error.code)) ? Number(error.code) : null,
          errorTitle: error && typeof error.title === "string" ? error.title.replace(/https?:\/\/\S+/g, "[URL]").slice(0, 160) : null });
      }
    }
  }
  return result;
}

const graphVersion = () => process.env.META_GRAPH_API_VERSION || "v25.0";
// Legacy Vercel secrets have a doubled T in WHATTSAPP; Vercel secret keys cannot be renamed in place.
const accessToken = () => process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATTSAPP_ACCESS_TOKEN;
const phoneNumberId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATTSAPP_PHONE_NUMBER_ID;
const businessAccountId = () => process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WHATTSAPP_BUSINESS_ACCOUNT_ID;

export function whatsappConfig() {
  return {
    accessToken: !!accessToken(),
    phoneNumberId: !!phoneNumberId(),
    businessAccountId: !!businessAccountId(),
    verifyToken: !!process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: !!process.env.META_APP_SECRET,
    approver: !!process.env.WHATSAPP_APPROVER_WA_ID,
  };
}

export function whatsappApprovalReady() {
  const config = whatsappConfig();
  return config.accessToken && config.phoneNumberId && config.verifyToken && config.appSecret && config.approver;
}

export async function sendWhatsAppText(body: string, to = process.env.WHATSAPP_APPROVER_WA_ID) {
  const token = accessToken();
  const sender = phoneNumberId();
  if (!token || !sender || !to) throw new Error("WhatsApp-Freigabe ist noch nicht vollständig konfiguriert.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(sender)}/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
    });
    const data = await response.json() as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || `WhatsApp HTTP ${response.status}`);
    const id = data.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp hat keine Message-ID bestätigt.");
    return id;
  } finally {
    clearTimeout(timeout);
  }
}

const graphVersion = () => process.env.META_GRAPH_API_VERSION || "v25.0";

export function whatsappConfig() {
  return {
    accessToken: !!process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
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
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId || !to) throw new Error("WhatsApp-Freigabe ist noch nicht vollständig konfiguriert.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}/messages`, {
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

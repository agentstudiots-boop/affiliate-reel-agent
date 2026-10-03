// Speech-to-text for operator voice messages. The result is plain text that enters the normal message pipeline;
// nothing here interprets commands.
export type TranscriptionFailure = "not_configured" | "too_large" | "provider_failed" | "timeout" | "unintelligible";
export class TranscriptionError extends Error {
  constructor(readonly code: TranscriptionFailure, readonly detail: string | null = null) { super(code); this.name = "TranscriptionError"; }
}

// Provider refusals are logged with provider, HTTP status and a short sanitized reason (never keys, never audio or text).
async function refusal(provider: string, response: Response): Promise<TranscriptionError> {
  let reason = "";
  try {
    const body = await response.json() as { error?: unknown; detail?: unknown; title?: unknown };
    const nested = body.error && typeof (body.error as { message?: unknown }).message === "string" ? (body.error as { message: string }).message : "";
    const raw = typeof body.detail === "string" ? body.detail : typeof body.title === "string" ? body.title : nested;
    reason = raw.replace(/(?:sk-|r8_|Bearer\s+)[A-Za-z0-9_-]+/g, "[redacted]").replace(/\s+/g, " ").slice(0, 160);
  } catch { /* body is optional */ }
  return new TranscriptionError("provider_failed", `${provider} http ${response.status}${reason ? `: ${reason}` : ""}`);
}

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const HINT = "Jarvis, Artikelsuche, Freigabe, Freigeben, Ablehnen, Status, Weiter, Entwurf, Kategorie, Amazon, Facebook, Instagram, Bild, Text.";
const REPLICATE_MODEL = () => process.env.WHATSAPP_TRANSCRIPTION_MODEL?.trim() || "openai/gpt-4o-transcribe";
const OPENAI_MODEL = "gpt-4o-mini-transcribe";

// Typical hallucinations of speech models on silence/noise. A transcript that is only this is never acted upon.
const NOISE = /^(?:untertitel(?: der amara\.org-community| im auftrag des zdf| von stephanie geiges)?|vielen dank(?: fürs zuschauen| für ihre aufmerksamkeit)?|danke(?: fürs zuschauen)?|tschüss|bis zum nächsten mal|musik|applaus|ähm|hm+|\.+)$/i;

export function usableTranscript(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 2000) return null;
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || NOISE.test(text.replace(/[.!?…]+$/g, "").trim())) return null;
  return text;
}

function textOf(output: unknown): unknown {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.every(part => typeof part === "string")) return output.join("");
  if (output && typeof output === "object" && typeof (output as { text?: unknown }).text === "string") return (output as { text: string }).text;
  return null;
}

type Deps = { request?: typeof fetch; sleep?: (ms: number) => Promise<void> };

async function viaOpenAI(bytes: Uint8Array, mime: string, key: string, request: typeof fetch) {
  const form = new FormData();
  form.set("model", OPENAI_MODEL);
  form.set("language", "de");
  form.set("prompt", HINT);
  form.set("response_format", "json");
  form.set("file", new Blob([bytes as BlobPart], { type: mime || "audio/ogg" }), "voice.ogg");
  const response = await request("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, redirect: "error", signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw await refusal("openai", response);
  return textOf(await response.json().catch(() => null));
}

async function viaReplicate(bytes: Uint8Array, mime: string, token: string, request: typeof fetch, sleep: (ms: number) => Promise<void>) {
  const audio = `data:${(mime || "audio/ogg").split(";")[0]};base64,${Buffer.from(bytes).toString("base64")}`;
  const post = () => request(`https://api.replicate.com/v1/models/${REPLICATE_MODEL()}/predictions`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=30", "Cancel-After": "60s" },
    redirect: "error", signal: AbortSignal.timeout(50_000),
    body: JSON.stringify({ input: { audio_file: audio, language: "de", prompt: HINT } }),
  });
  let response = await post();
  // 429 is a refusal before any processing: one retry after the advertised wait is safe.
  if (response.status === 429) { await sleep(8_000); response = await post(); }
  if (!response.ok) throw await refusal("replicate", response);
  let prediction = await response.json() as { id?: string; status?: string; output?: unknown; error?: unknown };
  // GETs only observe the same prediction; there is never a second paid POST.
  for (let attempt = 0; ["starting", "processing"].includes(prediction.status || "") && prediction.id && /^[a-z0-9]{12,64}$/.test(prediction.id) && attempt < 12; attempt++) {
    await sleep(1_500);
    const poll = await request(`https://api.replicate.com/v1/predictions/${prediction.id}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!poll.ok) throw new TranscriptionError("provider_failed");
    const next = await poll.json() as typeof prediction;
    if (next.id !== prediction.id) throw new TranscriptionError("provider_failed");
    prediction = next;
  }
  if (prediction.status !== "succeeded") {
    const reason = typeof prediction.error === "string" ? prediction.error.replace(/(?:sk-|r8_|Bearer\s+)[A-Za-z0-9_-]+/g, "[redacted]").replace(/\s+/g, " ").slice(0, 200) : "";
    throw new TranscriptionError("provider_failed", `replicate prediction ${prediction.status || "unknown"}${reason ? `: ${reason}` : ""}`);
  }
  return textOf(prediction.output);
}

// Provider order: a configured OpenAI key (documented transcription API), otherwise the existing Replicate token.
export async function transcribeAudio(bytes: Uint8Array, mime: string, deps: Deps = {}): Promise<string> {
  if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) throw new TranscriptionError(bytes.byteLength ? "too_large" : "unintelligible");
  const request = deps.request ?? fetch;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const openai = process.env.OPENAI_API_KEY?.trim(), replicate = process.env.REPLICATE_API_TOKEN?.trim();
  if (!openai && !replicate) throw new TranscriptionError("not_configured");
  let raw: unknown;
  try { raw = openai ? await viaOpenAI(bytes, mime, openai, request) : await viaReplicate(bytes, mime, replicate!, request, sleep); }
  catch (error) {
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError(error instanceof Error && /timeout|aborted/i.test(`${error.name} ${error.message}`) ? "timeout" : "provider_failed",
      error instanceof Error ? `${openai ? "openai" : "replicate"} ${error.name}` : "unknown");
  }
  const text = usableTranscript(raw);
  if (!text) throw new TranscriptionError("unintelligible");
  return text;
}

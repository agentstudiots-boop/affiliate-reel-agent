import { z } from "zod";
import { editorialPolicy, type Generator } from "./agent";

export function createGenerator(options: { mode: "reference" | "ai"; signal?: AbortSignal; onUsage: (tokens: number) => void }): Generator {
  let calls = 0;
  return async (agent, instruction, input, schema, reference) => {
    options.signal?.throwIfAborted();
    if (options.mode === "reference") return schema.parse(reference());
    if (++calls > 8) throw new Error("Das Limit von acht Modellaufrufen ist erreicht.");
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const model = process.env.CONTENT_MODEL;
    if (process.env.CONTENT_AI_ENABLED !== "true" || !key || !model || !/^[a-zA-Z0-9.-]+$/.test(model)) {
      throw new Error("KI-Planung ist nicht konfiguriert. Referenzmodus verwenden oder die Server-Konfiguration ergänzen.");
    }
    // No SDK retries, no arbitrary provider URL, no tools and no raw provider errors in logs.
    const signal = AbortSignal.any([AbortSignal.timeout(25000), ...(options.signal ? [options.signal] : [])]);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${editorialPolicy}\nRolle: ${agent}. ${instruction}` }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { temperature: agent === "orchestrator" ? 0.1 : 0.7, maxOutputTokens: 5000,
          responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema) },
      }),
    });
    if (!response.ok) throw new Error(`Modellaufruf fehlgeschlagen (HTTP ${response.status}). Kein automatischer Neuversuch.`);
    const payload = await response.json();
    options.onUsage(Number(payload.usageMetadata?.totalTokenCount) || 0);
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason !== "STOP") throw new Error("Modellantwort unvollständig oder blockiert. Job gestoppt.");
    try {
      return schema.parse(JSON.parse(candidate.content.parts.map((p: { text?: string }) => p.text || "").join("")));
    } catch { throw new Error("Modellantwort entspricht nicht dem vereinbarten Datenformat. Job gestoppt."); }
  };
}

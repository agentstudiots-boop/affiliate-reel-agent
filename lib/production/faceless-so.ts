import { z } from "zod";
import type { ContentJob } from "../content/schema";

const base = "https://faceless.so/api/v1";
const envelope = z.object({ success: z.literal(true), data: z.unknown() });
const voiceSchema = z.object({ id: z.string().min(1), name: z.string(), labels: z.object({ language: z.string().optional() }).optional(), targetLanguages: z.array(z.string()).optional() });
const modelCatalog = z.object({ kind: z.literal("models"), items: z.array(z.object({ value: z.string(), credits: z.number().int().positive() })) });
const meSchema = z.object({ team: z.object({ credits: z.number().nonnegative() }), auth: z.object({ scopes: z.array(z.string()) }) });

export class FacelessError extends Error {}

export function narration(job: ContentJob) {
  if (job.status !== "approved" || job.content?.format !== "video") throw new FacelessError("Freigegebener Video-Plan fehlt.");
  // The provider accepts one narration script, not a per-scene editable storyboard.
  return job.content.scenes.map(scene => scene.audio.trim()).join("\n\n");
}

export function facelessClient(fetcher: typeof fetch = fetch) {
  async function call(path: string, options: { method?: "POST"; body?: unknown; idempotencyKey?: string } = {}) {
    const key = process.env.FACELESS_API_KEY;
    if (!key) throw new FacelessError("FACELESS_API_KEY fehlt.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetcher(`${base}${path}`, {
        method: options.method || "GET", signal: controller.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const issue = z.object({ error: z.object({ type: z.string().optional(), message: z.string().optional() }).optional() }).safeParse(payload);
        throw new FacelessError(`Faceless.so HTTP ${response.status}${issue.success && issue.data.error?.type ? ` (${issue.data.error.type})` : ""}. ${response.status === 429 ? "Rate Limit: später manuell erneut prüfen." : "Provider-Ergebnis prüfen."}`);
      }
      return envelope.parse(payload).data;
    } catch (error) {
      if (error instanceof FacelessError) throw error;
      throw new FacelessError("Faceless.so-Antwort unklar oder nicht erreichbar. Keinen Schreibaufruf automatisch wiederholen.");
    } finally { clearTimeout(timeout); }
  }

  return {
    async quote() {
      const [me, models, voices] = await Promise.all([
        call("/me").then(value => meSchema.parse(value)),
        call("/options?kind=models").then(value => modelCatalog.parse(value)),
        call("/voices").then(value => z.array(voiceSchema).parse(value)),
      ]);
      const model = models.items.find(item => item.value === "storyboard");
      if (!model) throw new FacelessError("Storyboard-Modell fehlt im Faceless.so-Katalog.");
      if (!["videos:read", "videos:write", "catalog:read"].every(scope => me.auth.scopes.includes(scope))) {
        throw new FacelessError("Dem Faceless.so-API-Key fehlen Lese-, Schreib- oder Katalogrechte.");
      }
      const germanVoices = voices.filter(voice => voice.labels?.language?.toLowerCase().startsWith("de") || voice.targetLanguages?.some(language => language.toLowerCase().startsWith("de")));
      if (!germanVoices.length) throw new FacelessError("Keine deutschsprachige Stimme im Provider-Katalog gefunden.");
      return { credits: model.credits, balance: me.team.credits, voices: germanVoices.map(({ id, name }) => ({ id, name })) };
    },
    async create(script: string, voiceId: string, name: string, idempotencyKey: string) {
      return z.object({ id: z.string().min(1), model: z.literal("storyboard"), creditsUsed: z.number().optional() }).parse(
        await call("/videos", { method: "POST", idempotencyKey, body: { script, voiceId, model: "storyboard", name } }),
      );
    },
    async videoStatus(id: string) {
      return z.object({ status: z.enum(["pending", "processing", "completed", "failed"]), errorMessages: z.array(z.string()).optional(), renderedVideoUrl: z.string().url().nullish() }).parse(await call(`/videos/${encodeURIComponent(id)}/status`));
    },
    async video(id: string) {
      return z.object({ id: z.string(), renderedVideoUrl: z.string().url().nullish() }).parse(await call(`/videos/${encodeURIComponent(id)}`));
    },
    async render(id: string, idempotencyKey: string) {
      return z.object({ renderId: z.string().min(1) }).parse(await call(`/videos/${encodeURIComponent(id)}/render`, { method: "POST", idempotencyKey, body: { codec: "h264" } }));
    },
    async renderStatus(id: string) {
      return z.object({ status: z.enum(["in-progress", "done", "error"]), url: z.string().url().nullish() }).parse(await call(`/renders/${encodeURIComponent(id)}`));
    },
  };
}

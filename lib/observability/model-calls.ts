import { databaseConfigured, getDatabase, type Sql } from "../memory/db";
import { emitEvent } from "./events";

// Model call ledger: which agent called which model, with what outcome, latency and provider metrics (tokens, compute
// time). Cost monitoring without guessing: no Euro amounts are invented here; the provider's own metrics are stored and
// prices can be applied later. Never stores prompts, outputs, keys or personal data. Recording never breaks a call.

export type ModelCall = {
  agent: string; model: string; provider?: string; ok: boolean; errorClass?: string | null; latencyMs: number;
  predictionId?: string | null; inputTokens?: number | null; outputTokens?: number | null; predictTimeS?: number | null;
};

const int = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

// Replicate prediction metrics (language models report token counts; all report predict_time).
export function predictionMetrics(prediction: unknown): Pick<ModelCall, "predictionId" | "inputTokens" | "outputTokens" | "predictTimeS"> {
  const value = (prediction && typeof prediction === "object" ? prediction : {}) as { id?: unknown; metrics?: Record<string, unknown> };
  const metrics = value.metrics && typeof value.metrics === "object" ? value.metrics : {};
  return { predictionId: typeof value.id === "string" && /^[a-z0-9]{8,64}$/.test(value.id) ? value.id : null,
    inputTokens: int(metrics.input_token_count), outputTokens: int(metrics.output_token_count), predictTimeS: num(metrics.predict_time) };
}

type Store = (call: ModelCall) => Promise<void>;
const databaseStore: Store = async call => {
  if (!databaseConfigured()) return;
  await getDatabase().query(`INSERT INTO model_calls(agent,model,provider,ok,error_class,latency_ms,prediction_id,input_tokens,output_tokens,predict_time_s)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [call.agent.slice(0, 60), call.model.slice(0, 120), (call.provider ?? "replicate").slice(0, 40), call.ok,
    call.errorClass?.slice(0, 60) ?? null, Math.max(0, Math.round(call.latencyMs)), call.predictionId ?? null, call.inputTokens ?? null, call.outputTokens ?? null, call.predictTimeS ?? null]);
};
let store: Store = databaseStore;
export function setModelCallStore(next: Store | null) { store = next ?? databaseStore; }

export async function recordModelCall(call: ModelCall) {
  emitEvent("model_call", { agent: call.agent, model: call.model, ok: call.ok, errorClass: call.errorClass ?? null, latencyMs: Math.round(call.latencyMs),
    // "token" keys are dropped by the event sanitizer (secrets); usage counts are therefore logged as usageIn/usageOut.
    usageIn: call.inputTokens ?? null, usageOut: call.outputTokens ?? null, predictTimeS: call.predictTimeS ?? null }, "info"); // failures are already warned about by the calling site
  try { await store(call); } catch { /* best effort: a missing table (before migration 037) or an outage never affects the call */ }
}

// Per agent and model over the last `days` days: calls, failure rate, latency, tokens and provider compute time.
export async function modelCallSummary(db: Sql, days = 7) {
  const rows = (await db.query(`SELECT agent, model, count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failures,
      round(avg(latency_ms))::int AS avg_latency_ms, percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_latency_ms,
      sum(input_tokens)::bigint AS input_tokens, sum(output_tokens)::bigint AS output_tokens, round(sum(predict_time_s)::numeric, 1) AS predict_time_s,
      max(created_at) AS last_call_at
    FROM model_calls WHERE created_at > now() - make_interval(days => $1::int) GROUP BY agent, model ORDER BY calls DESC LIMIT 50`, [days])).rows;
  return rows.map(row => ({ agent: String(row.agent), model: String(row.model), calls: Number(row.calls), failures: Number(row.failures),
    failureRate: Number(row.calls) ? Number(row.failures) / Number(row.calls) : 0, avgLatencyMs: Number(row.avg_latency_ms), p95LatencyMs: Number(row.p95_latency_ms),
    inputTokens: row.input_tokens === null ? null : Number(row.input_tokens), outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
    predictTimeS: row.predict_time_s === null ? null : Number(row.predict_time_s), lastCallAt: row.last_call_at ? new Date(String(row.last_call_at)).toISOString() : null }));
}

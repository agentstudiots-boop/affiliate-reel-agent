// Failure diagnostics for the editorial model (task DIAG-MODEL). Describes WHY an answer was rejected without ever
// carrying model text or values: schema paths are reduced to array indexes and keys the schema itself defines,
// JSON problems to the shape of the answer, provider problems to the last prediction state.
import { z } from "zod";

export type SchemaIssue = { path: string; code: string; limit?: number | string };
export type JsonShape = { chars: number; start: "brace" | "fence" | "text" | "empty"; end: "brace" | "fence" | "other" | "empty" };
export type ProviderState = { status: string; output: boolean; polls: number; waitedMs: number };

const STATUSES = new Set(["starting", "processing", "succeeded", "failed", "canceled", "aborted"]);
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

// Every property name the schema defines anywhere; a path segment outside this set came from the answer and is masked.
export function schemaKeys(schema: z.ZodType): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const properties = (node as { properties?: unknown }).properties;
    if (properties && typeof properties === "object") for (const key of Object.keys(properties)) if (KEY.test(key)) keys.add(key);
    for (const value of Object.values(node)) walk(value);
  };
  try { walk(z.toJSONSchema(schema)); } catch { /* unrepresentable schema: every key is masked */ }
  return keys;
}

export function schemaIssues(error: z.ZodError, keys: ReadonlySet<string>, max = 3): SchemaIssue[] {
  return error.issues.slice(0, max).map(issue => {
    const path = issue.path.map(part => typeof part === "number" ? String(part) : typeof part === "string" && keys.has(part) ? part : "*").join(".") || "(root)";
    const raw = issue as unknown as { maximum?: unknown; minimum?: unknown; expected?: unknown };
    // Limits and expected types come from the schema, never from the answer.
    const limit = issue.code === "too_big" ? raw.maximum : issue.code === "too_small" ? raw.minimum : issue.code === "invalid_type" ? raw.expected : undefined;
    const summary: SchemaIssue = { path, code: issue.code };
    if (typeof limit === "number" && Number.isFinite(limit)) summary.limit = limit;
    else if (typeof limit === "bigint") summary.limit = Number(limit);
    else if (typeof limit === "string" && KEY.test(limit)) summary.limit = limit;
    return summary;
  });
}

export function jsonShape(output: string): JsonShape {
  const text = output.trim();
  const first = text[0], last = text[text.length - 1];
  return { chars: output.length,
    start: !text ? "empty" : first === "{" ? "brace" : text.startsWith("```") ? "fence" : "text",
    end: !text ? "empty" : last === "}" ? "brace" : text.endsWith("```") ? "fence" : "other" };
}

export function providerState(prediction: unknown, polls: number, waitedMs: number): ProviderState {
  const value = (prediction && typeof prediction === "object" ? prediction : {}) as { status?: unknown; output?: unknown };
  const status = typeof value.status === "string" && STATUSES.has(value.status) ? value.status : prediction ? "other" : "none";
  const output = value.output !== null && value.output !== undefined && !(Array.isArray(value.output) && value.output.length === 0) && value.output !== "";
  return { status, output, polls, waitedMs: Math.max(0, Math.round(waitedMs)) };
}

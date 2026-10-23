// Soft length limits for editorial model answers (DIAG-MODEL stage B, operator approval 23.10.2026).
//
// Some free-text fields carry a maxLength only to bound their downstream use (an internal reason that is cut anyway, a
// scene description inside the image prompt). The model regularly overshoots such limits by a few words, and one
// overshoot used to discard the whole answer. A schema may name such fields; when EVERY issue of a rejected answer is a
// too-long string in one of the named fields, those strings are cut at a word boundary to the schema's own limit and the
// answer is validated again. Any other issue rejects the answer as before. Published texts (captions, body, slides,
// disclosures) are never named here: they are rejected, not shortened.
import { z } from "zod";

const registry = new WeakMap<z.ZodType, ReadonlySet<string>>();

// Paths use the schema's keys; array indexes are written as "*" (e.g. "slides.*.visual").
export function softTextLimits<T extends z.ZodType>(schema: T, paths: readonly string[]): T {
  registry.set(schema, new Set(paths));
  return schema;
}

export function softTextPaths(schema: z.ZodType): readonly string[] {
  return [...(registry.get(schema) ?? [])];
}

// Cuts at the last word boundary within the limit (whole word kept if none is found in the last 40 %) and never splits
// a surrogate pair, so the result is at most `max` UTF-16 units – the measure Zod applies.
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.search(/\s\S*$/);
  if (space >= Math.floor(max * 0.6)) cut = cut.slice(0, space);
  return cut.replace(/[\s,;:–-]+$/u, "");
}

const pathKey = (path: readonly PropertyKey[]) => path.map(part => typeof part === "number" ? "*" : String(part)).join(".");

// Returns a trimmed copy and the trimmed schema paths, or null if the error is not purely about named soft fields.
export function trimSoftLimits(schema: z.ZodType, value: unknown, error: z.ZodError): { value: unknown; paths: string[] } | null {
  const allowed = registry.get(schema);
  if (!allowed?.size || !error.issues.length) return null;
  const targets: { path: readonly PropertyKey[]; max: number }[] = [];
  for (const issue of error.issues) {
    const raw = issue as unknown as { origin?: unknown; maximum?: unknown };
    if (issue.code !== "too_big" || raw.origin !== "string" || typeof raw.maximum !== "number" || !Number.isFinite(raw.maximum)) return null;
    if (!allowed.has(pathKey(issue.path))) return null;
    targets.push({ path: issue.path, max: raw.maximum });
  }
  const copy = structuredClone(value);
  for (const { path, max } of targets) {
    let node: unknown = copy;
    for (const part of path.slice(0, -1)) node = node && typeof node === "object" ? (node as Record<PropertyKey, unknown>)[part] : undefined;
    const key = path[path.length - 1];
    if (!node || typeof node !== "object" || typeof (node as Record<PropertyKey, unknown>)[key] !== "string") return null;
    (node as Record<PropertyKey, unknown>)[key] = cutAtWord((node as Record<PropertyKey, string>)[key], max);
  }
  return { value: copy, paths: [...new Set(targets.map(target => pathKey(target.path)))] };
}

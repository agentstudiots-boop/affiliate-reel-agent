// Runtime guard against unintended side effects outside the production deployment (audit P-02).
//
// Vercel preview deployments can receive the production database, Blob, Meta and WhatsApp credentials. This module
// is independent of the business logic: it decides from the deployment environment alone whether an effect may run.
//
//   VERCEL_ENV=production           → everything allowed (unchanged production behaviour)
//   VERCEL_ENV unset (local, tests)  → everything allowed (no production credentials there; unit tests use mocks)
//   VERCEL_ENV=preview|development   → blocked, unless the operator explicitly declares a sandbox:
//        NON_PRODUCTION_SANDBOX=true      the deployment uses its OWN database, Blob store, Meta/WhatsApp test assets
//        ALLOW_NON_PRODUCTION_PAID_CALLS=true   only paid model/media providers (no database, no publishing, no messages)
//
// The sandbox flag is a statement of the operator and must never be set together with production resources.

export type EffectKind = "database" | "migrate" | "publish" | "message" | "storage_write" | "scheduled_job" | "paid_provider";
type Env = Record<string, string | undefined>;

export function runtimeEnvironment(env: Env = process.env): "production" | "preview" | "development" | "local" {
  const value = env.VERCEL_ENV?.trim();
  if (value === "production" || value === "preview" || value === "development") return value;
  // Fail closed: a Vercel runtime (VERCEL is always set there) that does not report a recognised VERCEL_ENV is never
  // treated as production. Local runs and tests do not set VERCEL and stay "local".
  if (env.VERCEL?.trim()) return "preview";
  return "local";
}
export const isNonProductionDeployment = (env: Env = process.env) => ["preview", "development"].includes(runtimeEnvironment(env));
export const sandboxDeclared = (env: Env = process.env) => env.NON_PRODUCTION_SANDBOX === "true";

export type EffectDecision = { ok: true } | { ok: false; reason: "non_production_environment" };
export function effectDecision(kind: EffectKind, env: Env = process.env): EffectDecision {
  if (!isNonProductionDeployment(env)) return { ok: true };
  if (sandboxDeclared(env)) return { ok: true };
  if (kind === "paid_provider" && env.ALLOW_NON_PRODUCTION_PAID_CALLS === "true") return { ok: true };
  return { ok: false, reason: "non_production_environment" };
}

export class NonProductionEffectError extends Error {
  constructor(public readonly kind: EffectKind) { super(`non_production_effect_blocked:${kind}`); this.name = "NonProductionEffectError"; }
}
export function assertEffectAllowed(kind: EffectKind, env: Env = process.env) {
  if (!effectDecision(kind, env).ok) {
    console.warn(JSON.stringify({ event: "non_production_effect_blocked", kind, environment: runtimeEnvironment(env) }));
    throw new NonProductionEffectError(kind);
  }
}

// Network egress filter: in a non-production deployment without sandbox, state-changing requests (anything but
// GET/HEAD) to hosts that publish, message, store or cost money are refused before the request leaves the server.
const WRITE_HOSTS: { pattern: RegExp; kind: EffectKind }[] = [
  { pattern: /(^|\.)graph\.facebook\.com$/i, kind: "publish" },
  { pattern: /(^|\.)open\.tiktokapis\.com$/i, kind: "publish" },
  { pattern: /(^|\.)(upload\.)?twitter\.com$|(^|\.)api\.x\.com$|(^|\.)upload\.x\.com$/i, kind: "publish" },
  { pattern: /(^|\.)googleapis\.com$/i, kind: "publish" },
  { pattern: /(^|\.)vercel\.com$|(^|\.)blob\.vercel-storage\.com$/i, kind: "storage_write" },
  { pattern: /(^|\.)api\.replicate\.com$|(^|\.)api\.openai\.com$|(^|\.)api\.runwayml\.com$|(^|\.)api\.dev\.runwayml\.com$|(^|\.)api\.heygen\.com$|(^|\.)faceless\.so$|(^|\.)api\.tavily\.com$/i, kind: "paid_provider" },
];
export function egressDecision(url: URL, method: string, env: Env = process.env): { ok: true } | { ok: false; kind: EffectKind } {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return { ok: true };
  const match = WRITE_HOSTS.find(item => item.pattern.test(url.hostname));
  if (!match) return { ok: true };
  return effectDecision(match.kind, env).ok ? { ok: true } : { ok: false, kind: match.kind };
}

const INSTALLED = Symbol.for("non-production-egress-guard");
export function guardedEgressFetch(inner: typeof fetch, env: Env = process.env): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL | null = null;
    try { url = new URL(input instanceof Request ? input.url : String(input)); } catch { /* relative or invalid: not an outbound third-party write */ }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url) {
      const decision = egressDecision(url, method, env);
      if (!decision.ok) {
        console.warn(JSON.stringify({ event: "non_production_egress_blocked", kind: decision.kind, host: url.hostname, method: method.toUpperCase(), environment: runtimeEnvironment(env) }));
        throw new NonProductionEffectError(decision.kind);
      }
    }
    return inner(input as RequestInfo, init);
  }) as typeof fetch;
}
export function installEgressGuard(target: { fetch: typeof fetch } = globalThis as unknown as { fetch: typeof fetch }, env: Env = process.env) {
  if (isNonProductionDeployment(env) && sandboxDeclared(env)) {
    // Visible in the logs: every guard is off here, the operator has declared that this deployment owns separate resources.
    console.warn(JSON.stringify({ event: "non_production_sandbox_active", environment: runtimeEnvironment(env) }));
    return false;
  }
  if (!isNonProductionDeployment(env)) return false; // production and local runs are left untouched
  const current = target.fetch as typeof fetch & { [INSTALLED]?: boolean };
  if (current[INSTALLED]) return false;
  const wrapped = guardedEgressFetch(current, env) as typeof fetch & { [INSTALLED]?: boolean };
  wrapped[INSTALLED] = true;
  target.fetch = wrapped;
  return true;
}

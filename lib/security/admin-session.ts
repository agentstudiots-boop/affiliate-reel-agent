import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Operator (admin) session for the internal studio and command center.
// Stateless, signed token in an HttpOnly cookie. The signing key is derived from the operator access code
// (CONTENT_STUDIO_PASSWORD) and an optional ADMIN_SESSION_SECRET: rotating either one ends every session at once.
// Without a configured access code no session is ever valid (fail closed). The token carries no secret and no
// personal data, only issue/expiry time and a random id.
//
// No Next.js imports: used by proxy.ts, the auth routes and lib/memory/auth.ts, and unit tested directly.

export const ADMIN_SESSION_COOKIE = "acs_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
const VERSION = "v1";

type Payload = { v: string; iat: number; exp: number; sid: string };

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function signingKey(): Buffer | null {
  const password = process.env.CONTENT_STUDIO_PASSWORD;
  if (!password) return null;
  const extra = process.env.ADMIN_SESSION_SECRET?.trim() || "";
  return createHash("sha256").update(`acs-admin-session:${VERSION}\0${extra}\0${password}`).digest();
}

function sign(key: Buffer, body: string) {
  return createHmac("sha256", key).update(body).digest();
}

export function sessionConfigured() {
  return signingKey() !== null;
}

export function issueSessionToken(now = Date.now()): { token: string; expiresAt: number } | null {
  const key = signingKey();
  if (!key) return null;
  const iat = Math.floor(now / 1000);
  const payload: Payload = { v: VERSION, iat, exp: iat + ADMIN_SESSION_TTL_SECONDS, sid: randomBytes(16).toString("hex") };
  const body = b64url(JSON.stringify(payload));
  return { token: `${body}.${b64url(sign(key, body))}`, expiresAt: payload.exp * 1000 };
}

export function verifySessionToken(token: string | null | undefined, now = Date.now()): { valid: true; expiresAt: number } | { valid: false } {
  const key = signingKey();
  if (!key || !token || token.length > 512) return { valid: false };
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return { valid: false };
  const expected = sign(key, body);
  let given: Buffer;
  try { given = Buffer.from(signature, "base64url"); } catch { return { valid: false }; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { valid: false };
  let payload: Payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload; } catch { return { valid: false }; }
  const seconds = Math.floor(now / 1000);
  if (payload.v !== VERSION || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return { valid: false };
  if (payload.iat > seconds + 60 || payload.exp <= seconds || payload.exp - payload.iat > ADMIN_SESSION_TTL_SECONDS) return { valid: false };
  return { valid: true, expiresAt: payload.exp * 1000 };
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

export function sessionFromRequest(request: Request, now = Date.now()) {
  return verifySessionToken(readCookie(request.headers.get("cookie"), ADMIN_SESSION_COOKIE), now);
}

// Secure everywhere except plain-http local development.
export function secureCookies(request: Request) {
  try { return new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production"; } catch { return true; }
}

export function sessionCookie(token: string, secure: boolean) {
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean) {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

// Cookie-authenticated state changes must come from this origin (CSRF defence in addition to SameSite=Strict).
// Requests without Origin header (same-origin GET/HEAD in older browsers, server-to-server) are judged by Sec-Fetch-Site.
export function sameOrigin(request: Request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
  }
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

// Only relative in-app targets after login: never an open redirect.
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.length > 200) return "/";
  if (value.startsWith("/login") || value.startsWith("/api/")) return "/";
  return value;
}

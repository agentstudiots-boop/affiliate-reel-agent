import { timingSafeEqual } from "node:crypto";
import { sameOrigin, sessionFromRequest } from "../security/admin-session";

export function contentPasswordMatches(value: string) {
  const secret = process.env.CONTENT_STUDIO_PASSWORD;
  if (!secret) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Operator access: either the signed admin session cookie (browser, after /login) or the access code header
// (scripts, tests). A cookie-authenticated state change must additionally come from this origin.
export function authorized(request: Request) {
  if (contentPasswordMatches(request.headers.get("x-content-password") || "")) return true;
  return sessionFromRequest(request).valid && sameOrigin(request);
}

// Uniform 401 for operator-only routes. No hint whether the code is missing, wrong or not configured.
export function unauthorizedResponse() {
  return Response.json({ error: "Zugangscode erforderlich." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

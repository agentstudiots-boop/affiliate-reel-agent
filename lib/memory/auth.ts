import { timingSafeEqual } from "node:crypto";
export function contentPasswordMatches(value: string) {
  const secret = process.env.CONTENT_STUDIO_PASSWORD;
  if (!secret) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function authorized(request: Request) {
  return contentPasswordMatches(request.headers.get("x-content-password") || "");
}

// Uniform 401 for operator-only routes. No hint whether the code is missing, wrong or not configured.
export function unauthorizedResponse() {
  return Response.json({ error: "Zugangscode erforderlich." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

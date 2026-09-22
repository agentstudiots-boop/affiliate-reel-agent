import { timingSafeEqual } from "node:crypto";
export function authorized(request: Request) {
  const secret = process.env.CONTENT_STUDIO_PASSWORD;
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get("x-content-password") || "");
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

import { contentPasswordMatches } from "@/lib/memory/auth";
import { issueSessionToken, safeNextPath, sameOrigin, secureCookies, sessionCookie } from "@/lib/security/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator login: verifies the access code once and issues the signed HttpOnly session cookie.
// Plain HTML form (works without JavaScript) or JSON. The code is never stored, logged or echoed.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;
// Best effort per instance (serverless): slows down guessing; a strong access code remains the real protection.
const failures = new Map<string, { count: number; since: number }>();

function clientKey(request: Request) {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

function limited(key: string, now: number) {
  const entry = failures.get(key);
  if (!entry || now - entry.since > WINDOW_MS) return false;
  return entry.count >= MAX_FAILURES;
}

function noteFailure(key: string, now: number) {
  const entry = failures.get(key);
  if (!entry || now - entry.since > WINDOW_MS) failures.set(key, { count: 1, since: now });
  else entry.count++;
  if (failures.size > 1000) failures.clear();
}

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const json = (request.headers.get("content-type") || "").includes("application/json");
  const fail = (status: number, code: string, next = "/") => json
    ? Response.json({ error: status === 429 ? "Zu viele Fehlversuche. Bitte später erneut versuchen." : "Anmeldung fehlgeschlagen." }, { status, headers: noStore })
    : new Response(null, { status: 303, headers: { ...noStore, Location: `/login?error=${code}${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}` } });
  if (!sameOrigin(request)) return fail(403, "origin");
  if (Number(request.headers.get("content-length") || 0) > 4096) return fail(413, "invalid");
  let password = "", next = "/";
  try {
    if (json) {
      const body = JSON.parse(await request.text()) as { password?: unknown; next?: unknown };
      password = typeof body.password === "string" ? body.password : "";
      next = safeNextPath(body.next);
    } else {
      const form = await request.formData();
      password = String(form.get("password") || "");
      next = safeNextPath(form.get("next"));
    }
  } catch { return fail(400, "invalid"); }
  const key = clientKey(request), now = Date.now();
  if (limited(key, now)) {
    console.warn(JSON.stringify({ event: "admin_login_rate_limited" }));
    return fail(429, "limited", next);
  }
  if (!password || password.length > 256 || !contentPasswordMatches(password)) {
    noteFailure(key, now);
    console.warn(JSON.stringify({ event: "admin_login_failed", configured: !!process.env.CONTENT_STUDIO_PASSWORD }));
    await new Promise(resolve => setTimeout(resolve, 400));
    return fail(401, "invalid", next);
  }
  const session = issueSessionToken(now);
  if (!session) return fail(503, "invalid", next);
  failures.delete(key);
  console.info(JSON.stringify({ event: "admin_login", expiresAt: new Date(session.expiresAt).toISOString() }));
  const cookie = sessionCookie(session.token, secureCookies(request));
  return json
    ? Response.json({ ok: true, expiresAt: new Date(session.expiresAt).toISOString() }, { headers: { ...noStore, "Set-Cookie": cookie } })
    : new Response(null, { status: 303, headers: { ...noStore, "Set-Cookie": cookie, Location: next } });
}

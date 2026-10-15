import { clearedSessionCookie, sameOrigin, secureCookies } from "@/lib/security/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ends the browser session: the cookie is removed. (Stateless token: rotating CONTENT_STUDIO_PASSWORD or
// ADMIN_SESSION_SECRET ends all sessions everywhere.)
export function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  console.info(JSON.stringify({ event: "admin_logout" }));
  const headers = { "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookie(secureCookies(request)), "Clear-Site-Data": "\"cookies\"" };
  return (request.headers.get("content-type") || "").includes("application/json")
    ? Response.json({ ok: true }, { headers })
    : new Response(null, { status: 303, headers: { ...headers, Location: "/login?loggedOut=1" } });
}

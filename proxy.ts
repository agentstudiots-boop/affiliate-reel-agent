import { NextResponse, type NextRequest } from "next/server";
import { classifyPath } from "@/lib/security/access-policy";
import { ADMIN_SESSION_COOKIE, verifySessionToken } from "@/lib/security/admin-session";

// Network boundary of the internal area: studio and command center need the operator session. Public pages,
// webhooks and cron endpoints stay reachable (see lib/security/access-policy.ts). A hidden URL is not access control;
// every internal API route also checks the credential itself.
export function proxy(request: NextRequest) {
  const access = classifyPath(request.nextUrl.pathname);
  if (access === "public") return NextResponse.next();
  const session = verifySessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (session.valid) return NextResponse.next();
  if (access === "internal_api") {
    // Scripts may still send the access code header; the route verifies it (constant time). No header, no session → 401.
    if (request.headers.get("x-content-password")) return NextResponse.next();
    return NextResponse.json({ error: "Zugangscode erforderlich." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const login = new URL("/login", request.url);
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (next !== "/") login.searchParams.set("next", next.slice(0, 200));
  if (request.cookies.has(ADMIN_SESSION_COOKIE)) login.searchParams.set("error", "expired");
  return NextResponse.redirect(login, { headers: { "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { sessionFromRequest } from "@/lib/security/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whether the browser holds a valid operator session. No configuration details.
export function GET(request: Request) {
  const session = sessionFromRequest(request);
  return Response.json(session.valid ? { authenticated: true, expiresAt: new Date(session.expiresAt).toISOString() } : { authenticated: false },
    { headers: { "Cache-Control": "no-store" } });
}

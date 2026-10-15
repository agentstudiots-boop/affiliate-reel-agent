// Which paths are public and which belong to the internal (operator-only) area. Used by proxy.ts.
// Public means "no operator session needed"; such routes keep their own server-side protection:
//   /api/whatsapp/webhook  Meta signature (X-Hub-Signature-256) + verify token
//   /api/cron/*            CRON_SECRET bearer token (Vercel Cron)
//   /api/landing/click     same-origin, only ids of published posts, no data returned
//   /api/auth/*            login/logout/session itself
// Everything else (studio, command center, all other APIs) requires the operator session or, for API calls,
// the access code header. The route handlers additionally verify the credential themselves (defence in depth).

const PUBLIC_PAGES = [/^\/login\/?$/, /^\/produkte(?:\/.*)?$/, /^\/impressum\/?$/, /^\/datenschutz\/?$/];
const PUBLIC_API = [/^\/api\/whatsapp\/webhook\/?$/, /^\/api\/cron\/[a-z0-9-]+\/?$/, /^\/api\/landing\/click\/?$/, /^\/api\/auth\/(?:login|logout|session)\/?$/];
const PUBLIC_FILES = [/^\/_next\//, /^\/favicon\.ico$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/icon(?:\.[a-z]+)?$/, /^\/apple-icon(?:\.[a-z]+)?$/];

export type Access = "public" | "internal_page" | "internal_api";

export function classifyPath(pathname: string): Access {
  if (PUBLIC_FILES.some(rule => rule.test(pathname))) return "public";
  if (pathname.startsWith("/api/")) return PUBLIC_API.some(rule => rule.test(pathname)) ? "public" : "internal_api";
  return PUBLIC_PAGES.some(rule => rule.test(pathname)) ? "public" : "internal_page";
}

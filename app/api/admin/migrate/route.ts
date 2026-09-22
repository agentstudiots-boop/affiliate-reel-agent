import { contentPasswordMatches } from "@/lib/memory/auth";
import { databaseConfigured } from "@/lib/memory/db";
import { applyMigrations } from "@/lib/memory/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const headers = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function page(message = "") {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Postgres einrichten</title><style>body{font:16px system-ui;max-width:640px;margin:48px auto;padding:0 20px;color:#191919}form{display:grid;gap:12px}input,button{font:inherit;padding:12px}button{cursor:pointer}p{line-height:1.5}.status{padding:12px;background:#f1f5f9;border-radius:8px}</style></head><body><h1>Postgres-Migration</h1><p>Führt ausschließlich die im Projekt hinterlegten, noch offenen Migrationen aus. Der Zugangscode wird weder gespeichert noch ausgegeben.</p>${message ? `<p class="status">${message}</p>` : ""}<form method="post"><label for="password">Content-Studio-Zugangscode</label><input id="password" name="password" type="password" required autocomplete="current-password" maxlength="256"><button type="submit">Migration sicher ausführen</button></form></body></html>`;
}

export function GET() {
  return new Response(page(databaseConfigured() ? "Datenbank und Zugangscode sind konfiguriert." : "Konfiguration ist noch unvollständig."), { headers });
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 4096) {
    return new Response(page("Anfrage zu groß."), { status: 413, headers });
  }
  let password = request.headers.get("x-content-password") || "";
  if (!password) {
    try {
      const form = await request.formData();
      password = String(form.get("password") || "");
    } catch {
      return new Response(page("Ungültige Anfrage."), { status: 400, headers });
    }
  }
  if (!contentPasswordMatches(password)) {
    return new Response(page("Zugangscode stimmt nicht."), { status: 401, headers });
  }
  if (!databaseConfigured()) {
    return new Response(page("Postgres-Konfiguration ist unvollständig."), { status: 503, headers });
  }
  try {
    const result = await applyMigrations();
    const message = result.applied.length
      ? `Migration erfolgreich: ${result.applied.join(", ")}.`
      : `Schema bereits aktuell: ${result.alreadyApplied.join(", ")}.`;
    console.info(JSON.stringify({ event: "database_migration", applied: result.applied, alreadyApplied: result.alreadyApplied }));
    return new Response(page(message), { headers });
  } catch {
    console.error(JSON.stringify({ event: "database_migration_failed" }));
    return new Response(page("Migration fehlgeschlagen. Es wurden keine Zugangsdaten ausgegeben."), { status: 500, headers });
  }
}

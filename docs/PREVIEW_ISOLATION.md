# Preview-/Production-Isolation (Audit P-02)

**Problem (bestätigt über die Variablenliste des Vercel-Projekts):** `DATABASE_*` (Neon), `BLOB_READ_WRITE_TOKEN`, `META_APP_SECRET`,
`WHATSAPP_APPROVER_WA_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_SYSTEM_USER_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `REPLICATE_API_TOKEN`, `TAVILY_API_KEY`,
`CRON_SECRET` und `CONTENT_STUDIO_PASSWORD` gelten auch für **Preview**. Jede PR-Preview konnte damit gegen die Produktionsdatenbank laufen.

## Was der Code jetzt erzwingt (`lib/security/runtime-guard.ts`)
Maßgeblich ist `VERCEL_ENV`. `production` und „nicht gesetzt“ (lokal, Tests) verhalten sich unverändert.
In `preview` und `development` sind ohne Sandbox-Erklärung gesperrt:

| Wirkung | Sperrstelle |
|---|---|
| Datenbankzugriff | `getDatabase()` |
| Migrationen | `applyMigrations()` (und damit `/api/admin/migrate`, `ensureAutomationSchema`) |
| Veröffentlichung | `livePublishCapability()` → zentrale Freigabeschranke (`non_production_environment`), dazu `publishFacebookPhoto`, Facebook-Page-Schreibaufrufe, Instagram-Graph-POST |
| WhatsApp-Versand | `sendWhatsAppMessage()` |
| Blob-Schreibzugriff | explizit an den `put`-Stellen |
| Cron-Routen | `daily-draft`, `weekly-report`, `continue`, `topic-scout` antworten `skipped_non_production_environment` |
| Bezahlte Provider | `getRunwayClient()` |
| Netzwerk-Ausgang (zusätzlich, unabhängig) | `instrumentation.ts` filtert schreibende Aufrufe (nicht GET/HEAD) an Meta, TikTok, X, Google, Vercel Blob, Replicate, OpenAI, Runway, HeyGen, Faceless, Tavily |

Die Freigabeschranke selbst wurde **nicht abgeschwächt**; es kam nur ein weiterer Sperrgrund hinzu.

## Bewusste Ausnahmen (nur vom Betreiber zu setzen, nie zusammen mit Produktionsressourcen)
- `NON_PRODUCTION_SANDBOX=true` (nur Preview): erklärt, dass die Preview **eigene** Datenbank, **eigenen** Blob-Store und **Test**-Meta/WhatsApp-Zugänge nutzt. Hebt alle Sperren auf.
- `ALLOW_NON_PRODUCTION_PAID_CALLS=true`: erlaubt ausschließlich bezahlte Modell-/Medienprovider (keine Datenbank, keine Veröffentlichung, keine Nachrichten).

Folge: **Ohne Sandbox kann eine Preview keine Datenbank öffnen.** Die Preview baut weiterhin; Seiten mit Datenbankzugriff (z. B. `/produkte`) zeigen dort den Fehlerzustand.

## Anleitung für den Betreiber (Vercel → Settings → Environment Variables) — nicht automatisch ausgeführt
1. In Neon einen **Branch** `preview` (oder ein eigenes Projekt) anlegen; Migrationen dort gesondert ausführen.
2. Für das Environment **Preview** diese Variablen vom Produktionswert lösen und auf Test-/Branch-Werte stellen oder entfernen
   (Production-Einträge bleiben unverändert; bei Variablen mit gemeinsamen Targets den Eintrag teilen):
   `DATABASE_URL` und alle `DATABASE_*`/`POSTGRES_*`, `BLOB_READ_WRITE_TOKEN`/`BLOB_STORE_ID`, `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`,
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APPROVER_WA_ID`, `WHATSAPP_VERIFY_TOKEN`, `CRON_SECRET`, `CONTENT_STUDIO_PASSWORD`, `REPLICATE_API_TOKEN`, `TAVILY_API_KEY`, `RUNWAYML_API_SECRET`.
3. Erst wenn **alle** obigen Preview-Werte Testressourcen sind: `NON_PRODUCTION_SANDBOX=true` nur für Preview setzen.
4. Ungenutzt (im Code nicht referenziert): `GOOGLE_GENERATIVE_AI_API_KEY`, `AI_GATEWAY_API_KEY` — nach Prüfung entfernen.

## Nicht belegt / Grenzen
- Ob `@vercel/blob` alle Schreibaufrufe über `globalThis.fetch` sendet, ist nicht verifiziert; deshalb gibt es zusätzlich die expliziten Sperren an den `put`-Stellen. [ungeklärt]
- Der Filter greift nur im Node-Runtime der Funktion (`instrumentation.ts`), nicht im Build. Der Build führt keine Datenbank- oder Providerzugriffe aus [wahrscheinlich].
- Live auf Vercel nicht getestet (kein Preview-Deployment mit dem Branch ausgelöst).

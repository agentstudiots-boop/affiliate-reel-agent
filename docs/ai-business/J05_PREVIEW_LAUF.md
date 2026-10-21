# Preview-Lauf mit isolierten Ressourcen – Leitfaden (Aufgabe J-05)

Stand 21.10.2026. **Nur Vorbereitung:** Es wurden keine Ressourcen angelegt, keine Variablen gesetzt und kein Preview gestartet.
Die Einrichtung macht der Betreiber. Grundlage sind die vorhandenen Dokumente, die weiter gelten:
`docs/PREVIEW_ISOLATION_CHECKLIST.md` (Schritte je Ressource), `docs/PREVIEW_ISOLATION.md`, `docs/PREVIEW_ISOLATION_MATRIX.md`,
`docs/PREVIEW_E2E_RUNBOOK.md`. Dieser Leitfaden gleicht sie mit dem heutigen Code ab und ergänzt den Nachweis, dass Production
unberührt bleibt.

## 1. Ziel und Empfehlung

Ein Preview-Deployment soll die Executive-/Controlling-Bausteine (Migrationen 039–041, Aufgabenbuch, Entscheidungsvorlagen,
Kostenbuch) gegen eine **eigene Datenbank** ausprobieren können, ohne Production zu berühren.

**Empfohlener Zuschnitt:** nur `database` und `blob` isolieren; WhatsApp, Veröffentlichen und Bezahl-Provider bleiben
**gesperrt**, und ihre Zugangsdaten werden aus dem Preview-Target **entfernt** (Ressource „fehlt in Preview“). Damit gilt:

```
NON_PRODUCTION_SANDBOX=true
NON_PRODUCTION_SANDBOX_RESOURCES=database,blob
```

Cron-Jobs laufen in Preview ohnehin nicht (Vercel führt `vercel.json`-Crons nur in Production aus) und blieben zusätzlich gesperrt,
weil `scheduled_job` alle fünf Ressourcen verlangt.

## 2. Getrennte Ressourcen und Variablennamen (aus dem Code, Stand `main` 5f59d36)

| Ressource (`NON_PRODUCTION_SANDBOX_RESOURCES`) | Preview braucht | Variablen, die nicht mit Production geteilt werden dürfen |
|---|---|---|
| `database` | eigener Neon-Branch (eigener Endpoint-Host `ep-…`) | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `DATABASE_POSTGRES_URL`, `DATABASE_POSTGRES_URL_NON_POOLING` |
| `blob` | eigener Blob-Store | `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` |
| `whatsapp` | **empfohlen: keine Zugangsdaten** | `WHATSAPP_ACCESS_TOKEN`, `WHATTSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATTSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATTSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APPROVER_WA_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` |
| `publishing` | **empfohlen: keine Zugangsdaten** | `META_SYSTEM_USER_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_REFRESH_TOKEN`, `TIKTOK_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_CLIENT_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `X_API_KEY`, `X_API_SECRET`, `PINTEREST_ACCESS_TOKEN`, `PINTEREST_CLIENT_SECRET`, `PINTEREST_BOARD_ID` |
| `paid_providers` | **empfohlen: keine Zugangsdaten** | `REPLICATE_API_TOKEN`, `OPENAI_API_KEY`, `RUNWAYML_API_SECRET`, `HEYGEN_API_KEY`, `FACELESS_API_KEY`, `TAVILY_API_KEY`, `AI_GATEWAY_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` |
| Zugang (keine Ressource) | eigene Werte je Target | `CONTENT_STUDIO_PASSWORD`, `ADMIN_SESSION_SECRET`, `CRON_SECRET` |

**Neu gegenüber der Checkliste vom 12.10. (in diesem PR im Prüfskript ergänzt):** `PINTEREST_ACCESS_TOKEN`,
`PINTEREST_CLIENT_SECRET`, `PINTEREST_BOARD_ID`, die Client-Secrets von TikTok/YouTube/X, `X_API_KEY`,
`WHATSAPP_BUSINESS_ACCOUNT_ID` (+ Altname) und `ADMIN_SESSION_SECRET`. Vorher hätte das Skript z. B. ein geteiltes Pinterest-Token
nicht gemeldet und `publishing` fälschlich als belegbar vorgeschlagen. Ein neuer Test (`tests/preview-isolation-j05.test.cjs`)
schlägt künftig fehl, sobald der Code ein Zugangsdatum liest, das das Skript keiner Ressource zuordnet.

Schalter, die in Preview **nicht** gesetzt werden (Standard aus): `EXECUTIVE_ENABLED`, `EXECUTIVE_WEEKLY_REPORT`,
`TOPIC_PIPELINE_ENABLED`, `TOPIC_DAILY_VIDEO`, `HEYGEN_ENABLED`, `WHATSAPP_ROUTER_ENABLED`, `ALLOW_NON_PRODUCTION_PAID_CALLS`.

## 3. Prüfung des Runtime-Guards (`lib/security/runtime-guard.ts`) für diesen Zuschnitt

Ergebnis: **bleibt fail-closed.** Geprüft am Code von `main` (5f59d36) und an den offenen Executive-PRs:

- **Datenbank:** jeder Zugriff geht über `getDatabase()` (`lib/memory/db.ts`, `assertEffectAllowed("database")`), Migrationen über
  `applyMigrations` (`"migrate"`). Kein zweiter `pg`-Pool im App-Code. Mit `database` in der Liste: erlaubt – **nur sicher, wenn
  `DATABASE_URL` im Preview-Target wirklich der Neon-Branch ist** (Nachweis §4 Schritt 2).
- **Blob:** Schreiben nur über `lib/security/guarded-blob.ts` (`"storage_write"`); kein weiterer Import von `@vercel/blob`.
  Zusätzlich sperrt der Egress-Filter Schreibaufrufe an `*.blob.vercel-storage.com`/`vercel.com` ohne `blob`.
- **WhatsApp:** `sendWhatsAppMessage` prüft `"message"`; ohne `whatsapp` gesperrt, auch der Graph-Endpunkt `/messages` im
  Egress-Filter.
- **Veröffentlichen:** Meta/Instagram/Pinterest prüfen `"publish"`; Egress-Filter für Graph, Pinterest, TikTok, X, Google-APIs.
- **Bezahl-Provider:** Runway, HeyGen, Video prüfen `"paid_provider"`; Egress-Filter für Replicate, OpenAI, Runway, HeyGen, Faceless,
  Tavily, Gemini, Anthropic, AI-Gateway. `ALLOW_NON_PRODUCTION_PAID_CALLS` bleibt ungesetzt.
- **Cron:** alle Cron-Routen (`daily-draft`, `continue`, `topic-scout`, `topic-video`, `weekly-report`) und die Executive-Route aus
  B-07 (#98, `app/api/cron/executive-cycle`) prüfen `effectDecision("scheduled_job")` – mit nur `database,blob` gesperrt.
- **Teilisolation:** Eine Wirkung wird nur frei, wenn **ihre** Ressource gelistet ist; unbekannte Wörter oder die Liste ohne
  `NON_PRODUCTION_SANDBOX=true` öffnen nichts (`tests/runtime-guard.test.cjs`).
- **Grenze:** Der Guard prüft Erklärungen, nicht Ressourcen. Steht `database` in der Liste, aber `DATABASE_URL` zeigt noch auf
  Production, schreibt Preview in Production. Deshalb sind Schritt 2 und 7 in §4 Pflicht.

## 4. Ablauf für den Betreiber

1. Neon-Branch `preview` anlegen; Blob-Store `affiliate-preview` anlegen; beide **nur** mit dem Target *Preview* verbinden.
2. **Trennung belegen (offline, ohne Werte):**
   ```
   vercel env pull .env.production.local --environment=production
   vercel env pull .env.preview.local    --environment=preview
   node scripts/check-preview-isolation.cjs .env.production.local .env.preview.local
   rm .env.production.local .env.preview.local
   ```
   Erwartet: `database` und `blob` „getrennt“, alle übrigen Ressourcen „fehlt in Preview“, keine Warnung zum Zugang,
   Vorschlag `NON_PRODUCTION_SANDBOX_RESOURCES=database,blob` (bzw. alle fünf, wenn die übrigen ganz fehlen – dann trotzdem nur
   `database,blob` setzen).
3. Production-Stand festhalten (lesend):
   `DATABASE_URL=<Production, lesend> node scripts/check-production-untouched.cjs snapshot before.json`
4. Im Target *Preview* setzen: `NON_PRODUCTION_SANDBOX=true`, `NON_PRODUCTION_SANDBOX_RESOURCES=database,blob`. Preview neu deployen.
5. Im Log des Preview-Deployments `non_production_sandbox_active` mit `["database","blob"]` prüfen. Das Command Center (Preview-URL,
   Login mit dem Preview-Passwort) zeigt bei Teilisolation weiter alle Komponenten mit Wirkung als „Preview: gesperrt“ – es gibt nur
   bei voller Isolation frei (`lib/architecture/runtime.ts`), zeigt also eher zu viel als zu wenig Sperre.
6. Preview-Lauf (z. B. `POST /api/admin/migrate` auf der Preview → Migrationen nur im Neon-Branch; danach die Abläufe aus
   `docs/PREVIEW_E2E_RUNBOOK.md`). In einem ruhigen Zeitfenster, z. B. außerhalb 07–09 und 16–18 UTC.
7. **Production unberührt belegen:**
   `DATABASE_URL=<Production, lesend> node scripts/check-production-untouched.cjs compare before.json`
   Erwartet: „Ruhige Tabellen und Migrationen unverändert.“ (Exit 0). Änderungen in aktiven Tabellen mit dem Production-Betrieb im
   Zeitraum abgleichen. Exit 2 = Befund: sofort Schritt 8.
8. **Rücknahme:** `NON_PRODUCTION_SANDBOX` im Target *Preview* löschen und neu deployen – sofort wieder alles gesperrt.

## 5. Was dieser PR liefert
- `scripts/check-preview-isolation.cjs`: fehlende Zugangsdaten ergänzt (siehe §2).
- `scripts/check-production-untouched.cjs` (neu): lesender Vorher-/Nachher-Vergleich von Production (nur Tabellennamen, Zeilenzahlen,
  Migrationsnamen; Transaktion `READ ONLY`). Ruhige Tabellen = Tabellen, die Production heute nicht schreibt (Executive-Kern,
  Kosten-/Erlösbuch) – jede Änderung dort ist ein Befund.
- `tests/preview-isolation-j05.test.cjs`: Drift-Test Code ↔ Prüfskript, Erkennung geteilter Pinterest-/Session-Werte,
  Vorher-/Nachher-Logik mit PGlite, Lesbarkeit/keine Ausgabe der Verbindung.

Nicht enthalten: keine Ressource, keine Variable, kein Deployment, keine Änderung am Guard.

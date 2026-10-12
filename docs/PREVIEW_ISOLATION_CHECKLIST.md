# Preview-Isolation: Checkliste (vorbereitet, nicht ausgeführt)

Stand 2026-10-12. Ausgangslage laut lesender Prüfung der Vercel-Variablen (nur Namen/Targets, siehe
`PREVIEW_ISOLATION_MATRIX.md` in PR #64): **Neon, Blob, WhatsApp-Freigabeinstanz, `META_APP_SECRET`, Runway und
`AI_GATEWAY_API_KEY` werden von Preview und Production gemeinsam genutzt.** Bei Token mit eigenem Datensatz je Target ist der
Wert nicht geprüft. Bis zur Trennung schützt ausschließlich der Code (`lib/security/runtime-guard.ts`).

## Was der Code heute garantiert (Nachweis: `tests/runtime-guard.test.cjs`)

| Lage in Preview/Development | Datenbank | Blob schreiben | WhatsApp senden | Veröffentlichen | Bezahl-Provider | Cron |
|---|---|---|---|---|---|---|
| nichts gesetzt (heute) | gesperrt | gesperrt | gesperrt | gesperrt | gesperrt | gesperrt |
| `NON_PRODUCTION_SANDBOX=true` ohne Liste | gesperrt | gesperrt | gesperrt | gesperrt | gesperrt | gesperrt |
| `…_RESOURCES=database,blob` | erlaubt | erlaubt | gesperrt | gesperrt | gesperrt | gesperrt |
| alle fünf Ressourcen | erlaubt | erlaubt | erlaubt | erlaubt* | erlaubt | erlaubt** |

\* Veröffentlichen braucht zusätzlich wie immer: gültige WhatsApp-Freigabe der exakten Fassung, Einmal-Claim, Live-Schalter,
Plattform in `TOPIC_PLATFORMS`, Zugangsdaten. \** Vercel führt `vercel.json`-Crons nur auf Production-Deployments aus.

Zusätzlich auf jeder Vercel-Laufzeit ohne erkannten `VERCEL_ENV` (PR #64): Einstufung als Preview, also gesperrt.

## Checkliste je Ressource (Betreiber; jeder Schritt einzeln)

1. **Neon (`database`)**
   - [ ] Im Production-Projekt einen Branch `preview` anlegen (eigener Endpoint-Host `ep-…`).
   - [ ] Vercel → Storage/Integration: für das Target *Preview* den Branch verbinden; `DATABASE_*`/`POSTGRES_*` dürfen nicht mehr
         gemeinsam mit Production gelten.
   - [ ] Migrationen nur gegen den Branch (`POST /api/admin/migrate` auf einer Preview *nach* Schritt 6 oder `npm run db:migrate`
         mit Branch-URL lokal). Nie mit der Production-URL.
2. **Blob (`blob`)**
   - [ ] Zweiten Store (z. B. `affiliate-preview`) anlegen und nur mit Preview verbinden; `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` trennen.
3. **WhatsApp (`whatsapp`)**
   - [ ] Meta-Testnummer oder eigene Test-App; eigene `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
         `META_APP_SECRET`, **eigene** `WHATSAPP_APPROVER_WA_ID` (Testgerät). Den Produktions-Webhook nicht umstellen.
   - [ ] Altnamen `WHATTSAPP_*` aus Preview/Development entfernen (gelten heute für alle Targets).
4. **Publishing (`publishing`)**
   - [ ] Nur Testseiten/-konten bzw. private Sichtbarkeit (TikTok `SELF_ONLY`, YouTube `private`). Kein Production-`META_SYSTEM_USER_TOKEN`.
5. **Bezahl-Provider (`paid_providers`)**
   - [ ] Preview-Keys entfernen oder eigene Keys mit hartem Budget (Replicate, Runway, HeyGen, OpenAI, Tavily).
   - [ ] `RUNWAYML_API_SECRET` aus Preview/Development lösen; unbenutzte `AI_GATEWAY_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` löschen.
6. **Zugang**
   - [ ] `CONTENT_STUDIO_PASSWORD` und `CRON_SECRET` je Target neu und verschieden setzen.
7. **Nachweis (offline, ohne Werte anzuzeigen)**
   ```
   vercel env pull .env.production.local --environment=production
   vercel env pull .env.preview.local    --environment=preview
   node scripts/check-preview-isolation.cjs .env.production.local .env.preview.local
   rm .env.production.local .env.preview.local
   ```
   Das Skript meldet je Variable `getrennt` / `GLEICH` / `GLEICHER HOST` / `fehlt in Preview` und schlägt die belegbare
   Ressourcenliste vor. Es belegt nur *verschiedene Werte*, nicht dass es Testressourcen sind – das bestätigt der Betreiber.
8. **Erst dann:** für Target *Preview* `NON_PRODUCTION_SANDBOX=true` und `NON_PRODUCTION_SANDBOX_RESOURCES=<Liste aus Schritt 7>`.
9. **Verifikation:** neues Preview-Deployment; im Log `non_production_sandbox_active` mit der Liste; Command Center (PR #64) zeigt
   die Preview-Sperre nur noch für nicht gelistete Ressourcen; `docs/PREVIEW_E2E_RUNBOOK.md`.

## Rücknahme
`NON_PRODUCTION_SANDBOX` (oder nur die Liste) im Preview-Target löschen und neu deployen: sofort wieder alles gesperrt.

## Grenzen
- Die Erklärung wird nicht automatisch gegen echte Ressourcen geprüft (keine Production-Werte in Preview verfügbar).
- `@vercel/blob` umgeht `fetch`; Blob-Schreiben ist deshalb zusätzlich an `guarded-blob.ts` gebunden (Test vorhanden).
- Nicht live auf Vercel getestet.

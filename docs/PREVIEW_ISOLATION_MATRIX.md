# Preview-Isolationsmatrix (Stand 2026-10-10, PR #64-Review)

Quelle: lesender Abruf der Vercel-Projektvariablen (nur Schlüssel, Targets, Datensatz-IDs; keine Werte entschlüsselt),
Code-Review von `lib/security/runtime-guard.ts`, `instrumentation.ts`, `vercel.json`. Es wurden keine Schreibzugriffe auf Vercel,
Neon, Blob, Meta oder WhatsApp ausgeführt.

Wichtig: Ein **eigener Variablen-Datensatz** für Preview beweist **nicht**, dass der **Wert** abweicht. Werte sind `sensitive` und
wurden bewusst nicht gelesen. Solche Zeilen gelten als „nicht verifiziert“.

Legende: **G** getrennt · **S** gemeinsam genutzt · **N** nicht verifiziert · **K** sicherheitskritisch

| Ressource | Variable(n) | Targets (Vercel) | Status | Wirkung der Code-Sperre in Preview |
|---|---|---|---|---|
| Neon/Postgres | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, alle `DATABASE_POSTGRES_*`, `DATABASE_PG*`, `DATABASE_NEON_PROJECT_ID` (gleiche Integrations-Store `store_vNF39…`) | production + preview | **S, K** | `getDatabase()`/Migrationen gesperrt, solange `NON_PRODUCTION_SANDBOX` nicht gesetzt |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` (Store `store_k6Pcl…`) | production + preview | **S, K** | `put` über `guarded-blob` gesperrt; Lesen mit Token wäre möglich |
| WhatsApp Freigabe-Instanz | `WHATSAPP_APPROVER_WA_ID` | production + preview (ein Datensatz) | **S, K** | Versand gesperrt; Absenderprüfung bleibt |
| WhatsApp Webhook | `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` | production + preview (ein Datensatz) | **S, K** | Preview-URL kann signierte Meta-Aufrufe prüfen; DB-Zugriff gesperrt. Meta-Webhook zeigt nur auf Production (nicht verifiziert) |
| WhatsApp Absender | `WHATTSAPP_PHONE_NUMBER_ID`, `WHATTSAPP_BUSINESS_ACCOUNT_ID` (Altnamen) | production + preview + development (ein Datensatz) | **S** | `sendWhatsAppMessage()` gesperrt |
| WhatsApp Token | `WHATSAPP_ACCESS_TOKEN` | getrennte Datensätze je Target | **N** | Versand gesperrt |
| Meta Graph (IG/FB) | `META_SYSTEM_USER_TOKEN` | getrennte Datensätze je Target (Preview wurde später als Production geändert, Werte nicht lesbar) | **N** | Graph-POST per Egress-Filter + Gate gesperrt |
| Meta IDs | `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`, `META_BUSINESS_ID` | **in keinem Target gesetzt** | **G** (nicht vorhanden) | Live-Publishing Instagram/Facebook über Themen-Pfad ohnehin nicht möglich |
| Cron | `CRON_SECRET` | getrennte Datensätze production / preview | **N** | Cron-Routen antworten `skipped_non_production_environment`; `vercel.json`-Crons laufen nur auf Production-Deployments |
| Operator-Zugang | `CONTENT_STUDIO_PASSWORD` | getrennte Datensätze production / preview / development | **N** | Gilt auch für `/api/architecture`; gleicher Wert würde Preview-Passwort = Production-Passwort bedeuten |
| Replicate | `REPLICATE_API_TOKEN` | getrennte Datensätze je Target | **N** | bezahlte Aufrufe gesperrt (Egress + `paid_provider`) |
| Tavily | `TAVILY_API_KEY` | getrennte Datensätze je Target | **N** | Egress-Filter (POST) |
| Faceless.so | `FACELESS_API_KEY` | getrennte Datensätze je Target | **N** | Egress-Filter |
| Google (Gemini) | `GOOGLE_GENERATIVE_AI_API_KEY` | getrennte Datensätze je Target | **N** | im Code nicht referenziert (laut `PREVIEW_ISOLATION.md`); googleapis-POST gesperrt |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | production + preview (ein Datensatz) | **S** | im Code nicht referenziert; Host `ai-gateway.vercel.sh` ist **nicht** im Egress-Filter |
| Runway | `RUNWAYML_API_SECRET`, `RUNWAY_MONTHLY_BUDGET_CREDITS` | production + preview + development (ein Datensatz) | **S, K** (kostenpflichtig) | `getRunwayClient()` + Egress gesperrt |
| TikTok / YouTube / X | alle Variablen | in keinem Target gesetzt | **G** (nicht vorhanden) | Adapter laufen nur im Dry-Run |
| Themen-Pipeline | `TOPIC_PIPELINE_ENABLED`, `TOPIC_LIVE_PUBLISHING`, `TOPIC_PLATFORMS` | nirgends gesetzt | **G** (aus) | Cron `topic-scout` nicht in `vercel.json` |
| Sandbox-Schalter | `NON_PRODUCTION_SANDBOX`, `ALLOW_NON_PRODUCTION_PAID_CALLS` | nirgends gesetzt | **G** | Alle Preview-Sperren aktiv |
| Publishing-Endpunkte | `/api/publication`, `/api/instagram/reel`, `/api/production` | Code | **G** (per Code) | Freigabeschranke + `non_production_environment`; live auf Vercel nicht getestet |
| Webhooks | `/api/whatsapp/webhook` | Code | **N** | Signatur (HMAC) bleibt aktiv; Effekte gesperrt |

## Befunde

1. **K – Neon und Blob sind identisch mit Production.** Nur die Code-Sperre schützt. Sie ist die einzige Schicht.
2. **K – Ein einziges Flag (`NON_PRODUCTION_SANDBOX=true`) öffnet alles**, ohne zu prüfen, ob die Ressourcen wirklich getrennt sind.
   Solange Neon/Blob/Meta/WhatsApp gemeinsam sind, darf es nicht gesetzt werden.
3. **Behoben in diesem PR (fail-closed):** `runtimeEnvironment()` stufte jeden unbekannten oder fehlenden `VERCEL_ENV` als `local`
   ein (alles erlaubt). Auf einer Vercel-Laufzeit (`VERCEL` gesetzt) gilt das jetzt als `preview` (gesperrt). Production meldet
   `VERCEL_ENV=production` und ist unverändert. Test: `tests/runtime-guard.test.cjs`.
4. **Offen (nur mit Betreiber-Aktion):** `AI_GATEWAY_API_KEY` ist in beiden Targets gleich und im Egress-Filter nicht erfasst.
   Unbenutzte Variablen (`GOOGLE_GENERATIVE_AI_API_KEY`, `AI_GATEWAY_API_KEY`) entfernen.
5. **Offen:** `RUNWAYML_API_SECRET` und `WHATTSAPP_*` liegen als *ein* Datensatz in allen Targets, inkl. `development`.
6. Die Egress-Liste kennt keine Hosts für Anthropic/AI-Gateway; im Code werden sie nicht genutzt (Grep über `lib/`).

## Sicherer Umsetzungsplan (alles manuell durch den Betreiber, nichts davon wurde ausgeführt)

1. **Neon:** Branch `preview` aus dem Production-Projekt anlegen (Copy-on-write, nur Lesen aus Production). Eigene Connection-Strings.
2. **Vercel:** Die Datenbank-Integration für **Preview** auf den Branch umstellen. Danach die `DATABASE_*`-Datensätze nicht mehr
   mit production teilen. Migrationen *nur* gegen den Branch (`npm run db:migrate` mit Branch-URL, nie mit Production-URL).
3. **Blob:** Zweiten Store `affiliate-preview` anlegen; `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` je Target trennen.
4. **Meta/WhatsApp:** Separate Test-App oder Test-Phone-Number (Meta stellt eine kostenlose Testnummer bereit). Eigene
   `WHATSAPP_*`, `META_APP_SECRET`, `WHATSAPP_APPROVER_WA_ID`. Eigenes `WHATSAPP_VERIFY_TOKEN`. Meta-Webhook bleibt auf Production-URL.
5. **Secrets rotieren/trennen:** `CRON_SECRET`, `CONTENT_STUDIO_PASSWORD` pro Target eindeutig (Werte vergleichen ohne Anzeige: neu setzen).
6. **Bezahl-Provider:** Preview-Keys entfernen oder eigene Keys mit Budget-Limit. `RUNWAYML_API_SECRET` aus Preview/Development lösen.
7. **Erst wenn 1–6 erledigt:** `NON_PRODUCTION_SANDBOX=true` nur für Preview. Danach `scripts/` bzw. Preview-E2E-Runbook (`docs/PREVIEW_E2E_RUNBOOK.md`).
8. **Verifikation:** Preview-Deployment, `GET /api/architecture` (zeigt nur fehlende Variablennamen), `non_production_sandbox_active` im Log.

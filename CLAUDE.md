# CLAUDE.md – Projektgedächtnis „Alltäglich leichter – Affiliate Content Studio“

**Pflicht zu Beginn jeder Sitzung:** diese Datei und `docs/PROJECT_STATUS.md` lesen, danach `AGENTS.md`
(verbindliche Projektvorgaben, hat Vorrang) und bei Drehbuch/Produkt-Themen `docs/SCRIPT_WRITER_MANIFEST.md`.
Diese Datei beschreibt nur die tatsächliche Architektur und verbindliche Regeln. Laufender Stand, offene PRs,
Blocker und Übergabe stehen in `docs/PROJECT_STATUS.md`; Soll-Ist-Matrix des Audits in `docs/PRODUCTION_AUDIT_FINAL_2026-10-15.md`.

## 1. Projekt und Betrieb

- Repository `agentstudiots-boop/affiliate-reel-agent`, Default-Branch `main` (kein Branch-Schutz – trotzdem nie direkt auf `main` arbeiten).
- Vercel-Projekt `affiliate-reel-agent` (`prj_tcYmiHTgJ3VF6E1bmapnNYkDHikI`, Team-Slug `agentstudiots-boop`, Hobby-Plan, Region `fra1`).
  Production-Domain `https://affiliate-reel-agent.vercel.app`. Merge nach `main` ⇒ automatisches Production-Deployment.
- Next.js **16.3.8** (fest gepinnt, App Router, `proxy.ts` statt Middleware, Node-Runtime). Vor Next-spezifischem Code die Doku unter
  `node_modules/next/dist/docs/` lesen. React 19, TypeScript strict, Zod, `pg` (Neon Postgres), Vercel Blob.
- Betreiber kommuniziert auf Deutsch; Oberfläche, WhatsApp-Texte und Doku sind deutsch.

## 2. Architektur (Überblick)

```
Browser (Betreiber, Admin-Session)          WhatsApp (Betreiber)            Vercel Cron
   │ app/page.tsx, Command Center              │ Meta-Webhook (signiert)        │ CRON_SECRET
   ▼                                           ▼                                ▼
 app/api/* (authorized())          app/api/whatsapp/webhook        app/api/cron/{daily-draft,continue,topic-scout,weekly-report}
   │                                           │                                │
   └──────────────► Orchestrator / Pipelines ◄─┴────────────────────────────────┘
                    lib/orchestrator.ts  (öffentlicher Einstieg: Scout, Review, Content-Job)
                    lib/content/orchestrator.ts (einziger Ort, der Spezialagenten importiert)
                    lib/daily/draft.ts   (Affiliate-Tagesentwurf je Slot)
                    lib/topic-pipeline/  (Themen-/Multi-Format-Pipeline, per Schalter aus)
                    lib/trendsetter/     (Content-Chancen, per Schalter aus)
                         │
     Freigaben: lib/whatsapp/content-approval.ts (Inhalt) · lib/production/* (Videokosten)
                lib/meta/publication-gate.ts (Affiliate-Bildpost) · lib/publishing/approval-gate.ts (Themen-Publish, harte Invariante)
                         │
     Publisher: lib/meta/* (Facebook/Instagram Affiliate) · lib/distribution/publishers/* (Meta, YouTube, TikTok, X, Pinterest für Themen; nur Meta/YouTube-Dry-Run nutzbar)
```

### Agenten (Spezialisten haben keine Tools, keine Imports untereinander)

| Agent | Ort | Modell / Quelle |
|---|---|---|
| Trend-/Produkt-Scout | `lib/agents/product-scout.ts`, `lib/content/trend-scout.ts`, `lib/content/research-mix.ts` | Tavily + Replicate `openai/gpt-4.1`; Themenrecherche `TRENDSCOUT_TOPICS=on` und Produktmix `PRODUCT_MIX=balance` (beide Standard aus) |
| Produktprüfung | `lib/agents/product-reviewer.ts`, `lib/product-resolver.ts` | Amazon-Detailseite (ASIN), regelbasiert |
| Content-Orchestrator + Creative/Bild/Video/Text/Marketing | `lib/content/orchestrator.ts`, `lib/content/agents/*` | Referenzmodus regelbasiert; KI-Modus Replicate `openai/gpt-4.1` (`lib/content/model.ts`) |
| WhatsApp-Router / Chat / Anweisungen | `lib/whatsapp/route-llm.ts`, `chat.ts`, `instruction.ts` | Replicate `openai/gpt-5.6-terra` |
| Bildqualität (Vision) | `lib/content/image-quality/gate.ts` | `IMAGE_QUALITY_MODEL` oder Router-Modell |
| Bildgenerierung | `lib/content/image-provider.ts` | Replicate FLUX 1.1 pro (OpenAI-Bild nur Fallback, nicht konfiguriert) |
| Video | `lib/production/*` (Runway, Faceless), `lib/visual/providers/heygen.ts`, `lib/visual/avatar-{briefing,preflight}.ts` | nur nach Kostenfreigabe; HeyGen nur mit `HEYGEN_ENABLED=true` (Standard aus), Briefing „Mia“ + Preflight ohne Netzaufruf |
| Themen-Scout | `lib/topics/*` | Tavily + Modell |
| Trendsetter | `lib/trendsetter/*` | Bewertung von Content-Chancen |

Referenzmodus und KI-Modus in Oberfläche und Doku immer klar unterscheiden (AGENTS.md).

**Modellaufrufe** werden zentral protokolliert: `lib/observability/model-calls.ts` → Tabelle `model_calls` (Agent, Modell, Erfolg,
Latenz, Tokens, Rechenzeit; nie Prompts/Ausgaben). Jeder neue Modellaufruf muss `recordModelCall` verwenden. Übersicht: `/api/operations` → `modelUsage`.
Kein Modellwechsel ohne nachvollziehbare Daten; kostenpflichtige Vergleiche nur nach Freigabe.

## 3. Sicherheitsregeln (verbindlich)

- **Admin-Zugang:** `/login` → `POST /api/auth/login` prüft `CONTENT_STUDIO_PASSWORD` (konstante Zeit) und setzt das
  signierte Session-Cookie `acs_admin_session` (HttpOnly, SameSite=Strict, Secure, 12 h; `lib/security/admin-session.ts`).
  Logout: `POST /api/auth/logout`. Rotation von `CONTENT_STUDIO_PASSWORD` oder optional `ADMIN_SESSION_SECRET` beendet alle Sitzungen.
- **Command Center:** eigene Seite `/architecture` (Login nötig) + Link oben im Studio. Daten: `/api/architecture`
  (`lib/architecture/model.ts` = statisches Inventar inkl. KI-Modell je Komponente, `runtime.ts` = Status aus Variablennamen/Schaltern,
  `snapshot.ts` = nur lesende DB-Nachweise inkl. „zuletzt erfolgreich“). Keine erfundenen Aktivitätsanzeigen; ohne Nachweis steht das dort.
- **`proxy.ts`** schützt alle internen Seiten und APIs (`lib/security/access-policy.ts`). Öffentlich bleiben nur:
  `/login`, `/produkte*`, `/impressum`, `/datenschutz`, `/api/whatsapp/webhook` (Meta-Signatur), `/api/cron/*` (CRON_SECRET),
  `/api/landing/click` (same-origin, nur IDs veröffentlichter Posts), `/api/auth/*`, `/_next/*`. Neue öffentliche Routen
  brauchen eine bewusste Entscheidung und einen Eintrag im Test `tests/admin-session.test.cjs`.
- **Jede interne API-Route prüft selbst** `authorized(request)` (`lib/memory/auth.ts`): Session-Cookie (state-ändernd nur
  same-origin) oder Header `x-content-password` (Skripte). Eine versteckte URL ist keine Authentifizierung.
- Secrets nie im Frontend, in Logs, Jobdaten, WhatsApp-Texten oder im Repo. Umgebungsvariablen nur nach Namen prüfen
  (Vercel: kein `decrypt`). Änderungen an Secrets nur mit Freigabe des Betreibers.
- Preview-Deployments teilen DB/Blob/WhatsApp/Meta mit Production: `lib/security/runtime-guard.ts` sperrt Wirkungen
  außerhalb von Production (fail-closed). Keine Schreibtests in Preview.

## 4. Freigabeprozesse (harte Invarianten)

1. **Inhaltsfreigabe** (`lib/whatsapp/content-approval.ts`): „Freigeben“ als Antwort auf genau die Freigabenachricht,
   gebunden an Content-ID + Fingerprint. Startet keine Produktion und keine Veröffentlichung.
2. **Bild:** erst nach Inhaltsfreigabe; Qualitäts-Gate (`lib/content/image-quality/`). Bildstopps erzeugen eine Notice
   (`image_quality_notices`); Antworten gelten nur für die **neueste** Notice des Jobs, dieselbe Content-Fassung und
   solange die Inhaltsfreigabe gilt. Übersteuern („Bild trotzdem senden“) nur bei *unsicherer* Prüfung oder *rein
   gestalterischen* Mängeln, nie bei harten Prüfregeln (`overrideClass`). Freie Formulierungen („Mach es trotzdem“) → Rückfrage.
3. **Videokosten:** eigene WhatsApp-Kostenfreigabe (`lib/production/request-cost-approval.ts`; Themenvideos: Kostenfreigabe-Nachricht `cost_message_id`,
   Höchstbetrag/Monatsbudget `lib/topic-pipeline/video-plan.ts`). Eine Inhaltsfreigabe startet nie ein Rendering.
4. **Veröffentlichungsfreigabe:** Affiliate-Bildpost über `lib/meta/publication-gate.ts`; Themen-Pipeline ausschließlich über
   `lib/publishing/approval-gate.ts` (Content-ID + Version + Fingerprint, jede Änderung = neue Version). Eine Bild- oder
   Inhaltsfreigabe ist nie eine Veröffentlichungsfreigabe. Keine Schreibzugriffe auf Freigabetabellen außerhalb `lib/publishing/`;
   einzige Ausnahme: Executive-Entscheidungsvorlagen (`enterprise_decisions`, Migration 041) nur in `lib/enterprise/decisions.ts`, mit denselben
   Beweisregeln (vertrauenswürdige Nummer, Antwort auf genau die Anfrage, wörtliches „Freigeben“/„Ablehnen“). Eine solche Freigabe führt nichts aus.
5. Ablehnung, Änderungswunsch oder fehlende Antwort ⇒ kein Publish. Cron, Retries, Fallbacks veröffentlichen nie selbst.
6. Ein expliziter WhatsApp-Auftrag (`lib/whatsapp/manual-order.ts`) übersteuert nur die 7-Tage-Sperre des Trendscouts,
   nie Prüfungen/Freigaben; er legt keinen zweiten Entwurf für einen laufenden oder freigegebenen Auftrag an.

## 5. Kommunikationsprotokoll WhatsApp

- Webhook-Reihenfolge (`app/api/whatsapp/webhook/route.ts`): Zustellstatus speichern → „Status“/„Weiter“ → Bildstopp-Antworten →
  manuelle Aufträge → Themen-Pipeline (wenn aktiv) → semantischer Router → Schlüsselwortkette → Freigabe-Gate.
- Idempotenz: jede eingehende Nachricht wird über `whatsapp_events.message_id` genau einmal beansprucht.
- Aktiver Kontext: `whatsapp_active_context` (+ Log `whatsapp_context_log`, auch Bildentscheidungen `image:*`).
- 24-h-Servicefenster: proaktive Nachrichten nur innerhalb des Fensters; außerhalb nur genehmigte Vorlage
  (`WHATSAPP_DAILY_TEMPLATE_*`, derzeit per Betreiberentscheidung `false`).

## 6. Datenbank

- Neon Postgres, Migrationen `db/migrations/NNN_*.sql`, registriert in `lib/memory/migrations.ts`, automatisch angewendet
  durch `ensureAutomationSchema` (transaktional, Advisory-Lock) oder `/api/admin/migrate` (angemeldet).
- **Nur additive Migrationen** (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), keine destruktiven Änderungen.
  Neue Migration ⇒ Liste in `migrations.ts`, Prüfung in `ensure-automation-schema.ts`, `tests/migration-upgrade.test.cjs`,
  Anzeige in `lib/architecture/model.ts` anpassen. Aktuell: 001–041 (037 = `model_calls`, 038 = Zustellstatus/Themenvideo, 039 = Executive-Aufgabenbuch, 040 = Kosten-/Erlösbuch, 041 = Executive-Entscheidungsvorlagen; 039–041 ungenutzt).

## 7. Cron-Jobs (`vercel.json`, UTC)

- `/api/cron/daily-draft` 07/08/09/16/17/18 UTC → Slots morning/afternoon (Europe/Berlin), Claim je (Tag, Slot), Nachweis in `daily_slot_runs`.
- `/api/cron/topic-scout` 07/08 UTC → ein Themenvorschlag im Fenster 08–11 Uhr Berlin (Tageslimit); `/api/cron/topic-video` 10/11/12 UTC →
  höchstens ein Themenvideo-Vorschlag je Berliner Tag (Fenster 12–14 Uhr, Claim `topic_video_days`). Beide wirken nur mit `TOPIC_PIPELINE_ENABLED=true`
  (Video zusätzlich `TOPIC_DAILY_VIDEO=true`). Außerhalb des 24-h-Fensters werden Themenvorschläge gehalten und mit der nächsten Betreiber-Nachricht nachgeliefert.
- `/api/cron/weekly-report` Mo 08:15 UTC. `/api/cron/continue` existiert, ist aber nicht geplant.
- Hobby-Plan: Ausführungszeit innerhalb der Stunde unscharf, Runtime-Logs nur 1 h → Nachweise in der DB.

## 8. Entwicklungs-, Test- und Deployment-Regeln

- Kleine Branches, getrennte PRs, keine direkten Änderungen auf `main`, keine Force-Pushes auf fremde Branches.
- Vor jedem PR: `npm run typecheck`, `npm run lint` (2 bekannte Warnungen), `npm test` (Node-Test, PGlite, keine echten
  Netzaufrufe), `npm run build`. Tests für Regressionen mit realem Code, nur I/O wird ersetzt (`tests/helpers/`).
- Keine kostenpflichtigen Aufrufe (Bild, Video, Modellvergleich) und keine Live-Posts ohne ausdrückliche Freigabe.
- Neue Funktionen hinter Schaltern mit Standard „aus“ (Rollback = Variable entfernen); Schalter nie eigenmächtig aktivieren.
- Cloud-Sitzungen: nicht in einem Git-Worktree mit verlinktem `node_modules` bauen (Turbopack-Fehler), sondern im Hauptcheckout.
- Nach Deployment: Production-Status mit echtem Aufruf prüfen (Build allein ist kein Nachweis). Begriffe strikt trennen:
  implementiert · getestet · gemergt · deployed · aktiviert · live verifiziert.
- Commits ohne Modellkennung; Projektdoku (`CLAUDE.md`, `docs/PROJECT_STATUS.md`) nach jeder Phase prüfen und versionieren.
- Affiliate-Compliance: keine erfundenen Tests/Preise/Garantien/Gesundheitsversprechen/Superlative; Kennzeichnung bleibt;
  Links nur auf konkrete Amazon-Produktdetailseiten (ASIN); keine automatischen Klicks.

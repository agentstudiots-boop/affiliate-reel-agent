# Produktionsintegration – Auditbericht 13.10.2026

Projekt: Affiliate Content Studio · Repository `agentstudiots-boop/affiliate-reel-agent` · Vercel-Projekt `affiliate-reel-agent` (`prj_tcYmiHTgJ3VF6E1bmapnNYkDHikI`, Team `agentstudiots-boop`, Hobby-Plan, Region `fra1`).

Erstellt von Claude Code (Sitzung auf dem Windows-Arbeitsplatz des Betreibers) für die anschließende unabhängige Prüfung durch ChatGPT Codex.

**Begriffe (strikt getrennt):**

| Begriff | Bedeutung in diesem Bericht |
|---|---|
| implementiert | Code existiert auf irgendeinem Branch |
| gemergt | Code ist in `main` |
| deployed | Code läuft im aktuellen Production-Deployment |
| aktiviert | Die nötigen Schalter/Zugangsdaten sind in Production gesetzt |
| live verifiziert | In Production mit echtem Aufruf beobachtet (nicht Mock, nicht lokal, nicht Preview) |

Es wurden **keine Secrets** gelesen oder ausgegeben. Umgebungsvariablen wurden nur mit Namen, Ziel-Umgebung und Typ abgefragt (`decrypt` nicht verwendet).

---

## 1. Ursprünglicher lokaler Entwicklungsstand (13.10.2026, ca. 16:00 UTC)

| Punkt | Befund |
|---|---|
| Arbeitsverzeichnis | `C:\Users\thors\affiliate-reel-agent` (Haupt-Checkout, keine weiteren Worktrees) |
| Branch / HEAD | `claude/tender-ramanujan-55jabk` @ `bc542c7` |
| Uncommittete / untracked Dateien | keine (`git status` sauber) |
| Stashes | keine |
| Lokale Branches | `claude/tender-ramanujan-55jabk` (ohne Upstream), `main` (1 hinter `origin/main`), `legal/datenschutz-impressum`, `pr64` (ohne Upstream) |
| Nicht gepushte Commits | **keine.** `bc542c7` und `pr64` (`20ccea1`) sind vollständig in `origin/claude/tender-ramanujan-55jabk` enthalten; `legal/datenschutz-impressum` ist identisch mit dem Remote-Branch |
| Lokal veraltet | Der lokale Branch lag 5 Commits **hinter** `origin/claude/tender-ramanujan-55jabk` (Review-Fixes vom 12.10. aus einer Cloud-Sitzung) |
| Git-Identität | lokal nicht konfiguriert; Commits dieser Sitzung mit `-c user.name=Claude -c user.email=noreply@anthropic.com` (wie frühere Agent-Commits), keine Konfigurationsänderung |

**Sicherung:** lokales Tag `backup/pre-integration-2026-10-13` → `bc542c7` (nicht gepusht). Danach `main` und `claude/tender-ramanujan-55jabk` per Fast-Forward aktualisiert. Kein `reset --hard`, kein `clean`, kein Force-Push.

## 2. Gefundene lokale Rückstände

Keine lokal-exklusive Arbeit. Alle Entwicklungsarbeiten früherer Claude-Code-Sitzungen lagen bereits auf GitHub; der Rückstand war ausschließlich **Remote-Branch → `main`** (siehe 3).

## 3. GitHub- und PR-Status (vor der Integration)

`main` = `638a2ce` (#66, 10.10.2026 19:09 UTC). Kein Branch-Schutz, keine Rulesets, kein Review-Zwang.

### Offene PRs

| PR | Branch | Status | Inhalt | Bewertung |
|---|---|---|---|---|
| #68 | `claude/daily-approval-outage-2026-10-13` | bereit, CI grün | Zustellstatus von Meta + Cron-Slot-Läufe protokollieren, Fensterende in der Freigabe, Migration 036 | produktionsreif → integriert |
| #67 | `claude/pipeline-hardening-2026-10-12` | Draft, CI grün | Freigabe-Vorschau-Fix, Publishing-Pfad-Inventar-Test, granulare Preview-Sandbox (fail-closed), Migration-034-Nachweis, Go-live-Runbook | produktionsreif (Production-Verhalten unverändert, Preview strenger) → integriert |
| #64 | `claude/tender-ramanujan-55jabk` | Draft, CI grün | Command Center 2.0, Trendsetter + Migration 035, Themen-Tageslimit, Review-Fixes 12.10. | produktionsreif, neue Funktionen standardmäßig aus → integriert |
| #61 | `feature/reel-intelligence-patterns-20261008` | offen, **CI rot** | Reel-Intelligence-Musteranalyse | **nicht integriert**: Test „specialists cannot import each other or an orchestrator“ schlägt fehl (`creative.ts` importiert `../reel-intelligence`) – verletzt die Projektregel „Nur der Orchestrator importiert Spezialagenten“; Basis veraltet (`aaeb440`); PR selbst sagt „Nicht ungeprüft mergen“ |
| #65 | `legal-pages-pinterest-prep` | Draft, Konflikte, CI rot | Rechtliche Seiten (Entwurf) | **überholt** durch #66 (gemergt) – Schließen empfohlen |
| #10 | `feat/content-identity-history` | Draft seit 24.09., Konflikte | Dauerhafte Content-IDs, Performance-Snapshots | **nicht integriert**: Migration `010_content_history.sql` kollidiert mit `main`-Migration `010_replicate_visual_provider.sql`; Code nicht in `main`; bräuchte Neunummerierung und neues Review |

### Gemergte PRs aus dem Auftrag

| PR | Inhalt | gemergt | in Production vor dieser Sitzung |
|---|---|---|---|
| #60 | Themen-/Multi-Format-Pipeline, zentrale Freigabeschranke | 09.10. | ja (`2a00432`, Pipeline per Schalter aus) |
| #62 | Bildqualität, visuelles Quality Gate (Migration 034) | 09.10. | ja (`72cc3ab`) |
| #63 | Audit-Umsetzung: API-Absicherung, Preview-Guard, Instagram-Re-Check | 10.10. | ja (`d86dae1`) |
| #66 | Impressum / Datenschutz | 10.10. | ja (`638a2ce`) |

### Ältere Remote-Branches

Inhaltlich per Reverse-Apply gegen `main` geprüft: `legal/datenschutz-impressum` und `claude/wonderful-hamilton-qjckiv` sind vollständig in `main` (Squash-Merges #66, #63). `claude/vibrant-hamilton-njt53h` ist per #60/#62 gemergt; die Abweichungen betreffen Dateien, die `main` später weiterentwickelt hat. 24 `fix/*`, `feat/*` und `docs/*`-Branches aus September haben 0 Commits außerhalb von `main`. `feat/content-orchestrator-memory` (#5) und `feat/parallel-revisions-weekly-report*` (#8, #9) sind gemergt; ihre Restunterschiede sind Vorgängerstände inzwischen weiterentwickelter Dateien. Doppelte Implementierungen: keine aktiven gefunden; `pr64` (lokal) war ein Vorgängerstand von #64.

### Konflikte zwischen den offenen PRs

- #64 ↔ #68: `lib/memory/migrations.ts`, `tests/migration-upgrade.test.cjs` (Migrationsliste 035 vs. 036) – inhaltlich gelöst, siehe 4.
- #64 ↔ #67: `lib/security/runtime-guard.ts`, `tests/runtime-guard.test.cjs` – automatisch zusammengeführt, Tests grün.
- #67 ↔ #68: keine Überschneidung.

## 4. Durchgeführte Integrationen

Integrationsbranch `claude/integration-2026-10-13` von `origin/main` (`638a2ce`), Merge-Reihenfolge #68 → #67 → #64 (`--no-ff`, Historie der Einzel-PRs erhalten).

Fachliche Konfliktlösung (Commit `a555db2`):

1. Migrationsliste 001 … 034 → **035_content_chances** → **036_delivery_and_slot_evidence**. Beide Migrationen sind rein additiv (`CREATE TABLE/INDEX IF NOT EXISTS`, keine `ALTER/DROP/UPDATE/DELETE`), voneinander unabhängig, und werden beim ersten DB-Aufruf automatisch angewendet.
2. `lib/architecture/model.ts`: Statisches Command-Center-Modell nennt jetzt „Migrationen 001–036“ und „034–036 in Produktion nicht verifiziert“.
3. `tests/migration-034.test.cjs`: Der Test liest den Rollback-SQL-Block aus der Doku zeilenende-tolerant (`\r?\n`). Ursache: Windows-Checkout mit `core.autocrlf=true` (CRLF) – unter Linux/CI nicht betroffen. Reiner Testfix, kein Produktionscode.

Keine neuen Features, keine Env-Änderungen, keine Änderung an `lib/publishing/approval-gate.ts`.

Pull Request: [#69](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/69).

## 5. Merge- und Deployment-Nachweise

| Schritt | Nachweis |
|---|---|
| CI PR #69 | GitHub Actions `check` (Run `38428699522`): **success**; Vercel-Preview `dpl_9ZMnWoHit7EP1RSTWiQgjnXJW1Yp` READY |
| Preview-Smoke | Startseite der Preview enthält „Jarvis 3D Command Center öffnen“; `/api/architecture` ohne Code → 401 |
| Merge | PR #69 am 13.10.2026 16:21:43 UTC per Merge-Commit nach `main` → `e27af8767c7f44500cd46ba6a970c0ef9c01ad74`. GitHub markiert #64, #67, #68 dadurch automatisch als gemergt (16:21:46 UTC) |
| Production-Deployment | `dpl_2Bm2wFwXG9JbQJ7egnbjAuE7HDNe`, Ziel `production`, Zustand **READY**, `githubCommitSha` = `e27af87…`, Ref `main` |
| Ausgeliefert | Production-HTML enthält den Command-Center-Launcher ab 16:22:47 UTC (ca. 60 s nach dem Merge) |
| Rollback-Kandidat | vorheriges Production-Deployment `dpl_3ECDE28uQg7XCAgN9wS677qy57mn` (`638a2ce`) ist als Rollback-Kandidat markiert |

Folge-PR (dieser Bericht): enthält nur Dokumentation, eine statische Anzeige-Korrektur im Architekturmodell und den passenden Test (siehe 10.1). Er ändert kein Laufzeitverhalten von Pipelines, Freigaben oder Publishern.

## 6. Produktiver Commit

Zum Zeitpunkt der Nachweise: **`e27af8767c7f44500cd46ba6a970c0ef9c01ad74`** (`main`, Deployment `dpl_2Bm2wFwXG9JbQJ7egnbjAuE7HDNe`, Domain `affiliate-reel-agent.vercel.app`).

Nach dem Merge des Folge-PRs ist dessen Merge-Commit der produktive Commit; der Unterschied zu `e27af87` besteht nur aus dem in 5 genannten Umfang. Prüfbefehl: `git diff e27af87 origin/main --stat`.

## 7. Aktivierte und deaktivierte Funktionen (Production, Stand 13.10.2026 16:30 UTC)

Quelle: Variablennamen in Vercel (keine Werte) + Auswertung der Code-eigenen Capability-Prüfung `checkCapabilities()` mit genau diesen Namen (offline, keine Netzaufrufe).

| Funktion | Schalter / Voraussetzung | Status |
|---|---|---|
| Affiliate-Tageslauf (6 Cron-Slots) | `CRON_SECRET`, DB, WhatsApp | **aktiv**, live beobachtet (siehe 9.3) |
| WhatsApp-Tagesvorlage | `WHATSAPP_DAILY_TEMPLATE_ENABLED=false` (Betreiberentscheidung) | **aus** – Freigaben nur innerhalb des 24-h-Fensters |
| WhatsApp-Router (freie Sprache) | Standard an | aktiv (live im Log 16:17 UTC) |
| Zustell-/Slot-Nachweise (#68) | Migration 036 | **deployed**; seit 16:28 UTC aktiv (siehe 9.3) |
| Visuelles Quality Gate | `IMAGE_QUALITY_GATE` nicht gesetzt → `strict`, Replicate vorhanden | aktiv (seit #62); Vision-Modell nicht live belegt |
| Themen-Pipeline | `TOPIC_PIPELINE_ENABLED` nicht gesetzt | **aus** (bewusst); Cron `/api/cron/topic-scout` nicht in `vercel.json` |
| Themen-Live-Veröffentlichung | `TOPIC_LIVE_PUBLISHING` nicht gesetzt | **aus** – nur Dry-Run |
| Themen-Tageslimit | `TOPIC_POSTS_PER_DAY` nicht gesetzt → 1 | deployed, wirkungslos solange Pipeline aus |
| Trendsetter (Content-Chancen) | `TRENDSETTER_AFFILIATE` nicht gesetzt | **aus** – Affiliate-Pfad unverändert |
| Command Center 2.0 | Zugangscode | **deployed und erreichbar** (nur lesend) |
| Preview-Sandbox (#67) | `NON_PRODUCTION_SANDBOX(_RESOURCES)` nirgends gesetzt | Preview vollständig gesperrt (fail-closed) |

Plattformen laut Capability-Prüfung (Themen-/Multi-Format-Pfad):

| Plattform | Ergebnis | Fehlend |
|---|---|---|
| Instagram | blockiert | `META_PAGE_ID`, `META_INSTAGRAM_USER_ID` |
| Facebook | blockiert | `META_PAGE_ID` |
| YouTube | nur Dry-Run | – (Zugangsdaten am 10.10. nach dem damaligen Deployment angelegt, ab `e27af87` erstmals im Deployment vorhanden) |
| TikTok | blockiert | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN` oder `TIKTOK_REFRESH_TOKEN` |
| X | blockiert | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` |
| HeyGen | blockiert | `HEYGEN_*` |
| OpenAI (Bild-Fallback) | blockiert | `OPENAI_API_KEY` |
| Landing (Themen) | blockiert | `TOPIC_LANDING_URL` |

Hinweis: Der **Affiliate-Pfad** veröffentlicht auf Facebook/Instagram über `lib/meta/connection.ts`, das die Seite per Token und Seitenname ermittelt; er braucht `META_PAGE_ID` nicht. „Blockiert“ oben gilt nur für den Themen-Pfad.

## 8. Architekturstatus aller Komponenten

Legende: I = implementiert, G = gemergt, D = deployed, A = aktiviert, L = live verifiziert (in dieser Sitzung oder per dokumentiertem Live-Nachweis).

| Komponente | I | G | D | A | L | Bemerkung |
|---|---|---|---|---|---|---|
| Jarvis / Orchestrator (`lib/orchestrator.ts`, `lib/content/`) | ✓ | ✓ | ✓ | ✓ | teilw. | Tageslauf heute live; KI-Modus der Spezialisten nicht live belegt, Referenzmodus regelbasiert |
| Trendsetter (`lib/trendsetter/`) | ✓ | ✓ (heute) | ✓ (heute) | ✗ | ✗ | `TRENDSETTER_AFFILIATE` aus |
| Trend-Agent (Tavily + Modell) | ✓ | ✓ | ✓ | ✓ | ✓ | 16:28 UTC: `trend_discovery` success, 20 Belege, 4/4 Abfragen |
| Themen-Scout | ✓ | ✓ | ✓ | ✗ | ✗ | Pipeline aus |
| Produkt-Scout / Amazon-Auflösung | ✓ | ✓ | ✓ | ✓ | ✓ | 16:28 UTC lief, Ergebnis „kein passender Kategorietreffer“ |
| Affiliate-Pipeline | ✓ | ✓ | ✓ | ✓ | teilw. | Lauf bis `needs_input` beobachtet; Freigabe/Veröffentlichung heute nicht beobachtet |
| Themen-Pipeline / Multi-Format | ✓ | ✓ | ✓ | ✗ | ✗ | bewusst aus; Go-live-Runbook in `docs/GO_LIVE_RUNBOOK.md` |
| Bildgenerierung (Replicate) | ✓ | ✓ | ✓ | ✓ | früher dokumentiert | heute nicht ausgelöst |
| Vision-Qualitätsprüfung | ✓ | ✓ | ✓ | ✓ | ✗ | Stufe 2 des Smoke-Tests (kostenpflichtig) nicht ausgeführt |
| Video (Runway / Faceless / HeyGen) | ✓ | ✓ | ✓ | Runway/Faceless nur nach Kostenfreigabe; HeyGen ✗ | ✗ heute | keine bezahlten Aufrufe in dieser Sitzung |
| WhatsApp-Freigaben | ✓ | ✓ | ✓ | ✓ | ✓ | Eingehende Nachricht 16:17 UTC verarbeitet (Status-Route) |
| Freigabeschranke `approval-gate.ts` | ✓ | ✓ | ✓ | ✓ | ✗ heute | unverändert; #67 korrigiert nur die Vorschau-Anzeige |
| Instagram / Facebook (Affiliate) | ✓ | ✓ | ✓ | ✓ | laut früherer Doku | heute keine Veröffentlichung |
| YouTube / TikTok / X (Themen) | ✓ | ✓ | ✓ | YouTube Dry-Run; TikTok/X ✗ | ✗ | siehe 7 |
| Produkt-Studio (Startseite) | ✓ | ✓ | ✓ | ✓ | ✓ | HTTP 200 |
| Landingpage `/produkte`, `/impressum`, `/datenschutz` | ✓ | ✓ | ✓ | ✓ | ✓ | HTTP 200 |
| 3D Command Center 2.0 | ✓ | ✓ (heute) | ✓ (heute) | ✓ | teilw. | Launcher sichtbar, Dialog öffnet, API 401 ohne Code; Inhalt mit echtem Code nicht geprüft (Code nicht verfügbar) |
| Datenbank / Migrationen | ✓ | ✓ | ✓ | ✓ | indirekt | siehe 9.3 |
| Cron-System | ✓ | ✓ | ✓ | ✓ | ✓ | 16-Uhr-Slot lief 16:28 UTC auf neuem Deployment |
| Monitoring / Status | ✓ | ✓ | ✓ | ✓ | teilw. | Laufzeitfehler: nur bekannte `pg`-SSL-Warnung |

### Warum das überarbeitete Command Center nicht erreichbar war

Der gesamte Code (`app/architecture/*`, `lib/architecture/*`, `app/api/architecture/route.ts`, Launcher in `app/content-studio.tsx`) lag ausschließlich auf dem Draft-Branch von PR #64 und war nie in `main`. Production (`638a2ce`) hatte weder Launcher noch API (`/api/architecture` → **404**, belegt um 16:16 UTC). Preview-Deployments des Branches sind zusätzlich durch Vercel-Authentifizierung (`ssoProtection: all_except_custom_domains`) geschützt und für normale Nutzer nicht erreichbar.

Nach dem Merge: Launcher „Jarvis 3D Command Center öffnen“ im Abschnitt „02 Content-Planung“ der Startseite; `/api/architecture` → **401** ohne Zugangscode. Bedienung: zuerst den Zugangscode im Feld „Zugangscode für Planung & Datenbank“ eintragen, dann öffnen. Ohne Code zeigt der Dialog „Zugangscode erforderlich“ (so beabsichtigt).

## 9. Testergebnisse

### 9.1 Lokal (Windows 11, Node 24.21, Integrationsstand `a555db2`)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run lint` | 0 Fehler, 2 bekannte Warnungen (ungenutzte Variablen in `app/produkte/landing-view.tsx:6` und `tests/daily-automation.test.cjs:318`) |
| `npm test` | **614/614** (vor dem CRLF-Testfix 613/614, siehe 4) |
| `npm run build` | ✓ (inkl. `/api/architecture`) |

Folge-Branch `claude/integration-audit-2026-10-13` (Architekturmodell + Test + dieser Bericht): Typecheck ✓, Lint 0 Fehler (dieselben 2 Warnungen), `npm test` **614/614**.

### 9.2 Lokal im Browser (Production-Build, **kein** Produktionsnachweis)

`next start` mit einem lokal erzeugten Test-Zugangscode, ohne `.env`-Dateien und ohne Produktions-Secrets (Runtime-Guard sperrt alle Wirkungen): 3D-Szene mit Jarvis im Zentrum und sieben Bereichen gerendert, Seitenpanel „Gesamtübersicht“, Status „Keine Laufzeitdaten“ (erwartet ohne DB), keine Konsolenfehler.

### 9.3 Production (echte Nachweise, keine Mocks)

| Nachweis | Ergebnis |
|---|---|
| HTTP | `/` 200 · `/produkte` 200 · `/impressum` 200 · `/datenschutz` 200 · `/api/architecture` 401 · `/api/cron/daily-draft` 401 · `/api/cron/weekly-report` 401 · `/api/cron/topic-scout` 401 · `/api/whatsapp/webhook` GET 403, POST ohne Signatur 401 · `/api/admin/migrate` GET 200 (nur Infoseite) |
| Command Center | Launcher in Production-HTML; Dialog öffnet; DOM: Vollbild, oberstes Element „Jarvis Command Center“, Hinweis „Zugangscode erforderlich“; Konsole: nur der erwartete 401 der API |
| Cron 16-Uhr-Slot | `daily_cron_invocation` 16:28:27 UTC (`scheduledBy: 0 16 * * *`) auf `dpl_2Bm2wFwX…` → `daily_slot_claim accepted` → `trend_discovery success` → `amazon_resolution no_indexed_category_match` → `daily_draft needs_input` + `deferred_retry_pending (product_unresolved)` |
| Migrationen 035/036 | **indirekt belegt:** Die Tabelle `daily_slot_runs` (036) existierte vor dem Deployment nicht; `ensureAutomationSchema` wendet in diesem Fall alle fehlenden Migrationen in Reihenfolge an (also 035 und 036). Der Lauf endete ohne `daily_slot_evidence_unsaved` und ohne `daily_draft_storage_failed`, d. h. Schema-Upgrade und `INSERT INTO daily_slot_runs` waren erfolgreich. Ein direkter `SELECT` auf `schema_migrations` war nicht möglich (`DATABASE_URL` ist „sensitive“). |
| Laufzeitfehler (1 h) | nur `pg`-Warnung zu `sslmode` (bekannt, seit 23.09.) |
| WhatsApp eingehend | 16:17 UTC Statusanfrage des Betreibers verarbeitet (`intent: status`, noch altes Deployment) → 24-h-Fenster offen bis ca. 14.10. 16:17 UTC |

Nicht live verifiziert (bewusst nicht ausgelöst): Versand einer Freigabenachricht, Veröffentlichung auf einer Plattform, Bild-/Videoerzeugung, Vision-Smoke-Stufe 2, Wochenbericht.

## 10. Offene Probleme und Risiken

1. **Veraltete Anzeige im Command Center (im Folge-PR behoben):** Das statische Modell markierte den Trendsetter als „nur Preview“ (`since: "pr64"`) und nannte als Basis „Branch von PR #64“. Nach dem Merge falsch; korrigiert auf `main`/Production, Test angepasst.
2. **Keine Preview-Isolation:** Preview und Production teilen `DATABASE_*` (Neon-Store), `BLOB_READ_WRITE_TOKEN`, WhatsApp-, Meta- und Replicate-Zugänge. Schutz besteht nur durch den Runtime-Guard (fail-closed). Produktive Schreibtests in Preview sind daher **nicht** zulässig und wurden nicht durchgeführt.
3. **WhatsApp-24-h-Fenster:** Ohne Vorlage (`WHATSAPP_DAILY_TEMPLATE_ENABLED=false`) endet jeder Slot außerhalb des Fensters mit `template_required` ohne Nachricht. Wird separat behandelt (Betreiberentscheidung, Kosten). #68 macht den Zustand sichtbar, behebt ihn nicht.
4. **Produktauflösung:** Der heutige Slot fand kein Amazon-Produkt in passender Kategorie (`relevant: 0`). Wiederholt sich das, entstehen trotz offenem Fenster keine Freigaben.
5. **YouTube-Refresh-Token:** OAuth-Zustimmungsseite im Testmodus → Token läuft nach 7 Tagen ab (angelegt 10.10. → ca. 17.10.).
6. **Hobby-Plan:** Runtime-Logs nur 1 h; Cron-Zeitpunkt innerhalb der Stunde unscharf (heute 16:28 statt 16:00). Nachweise deshalb jetzt in `daily_slot_runs`/`whatsapp_delivery_statuses`.
7. **`next: "latest"`** in `package.json`: Builds können ohne Codeänderung eine neue Next-Version ziehen.
8. **`pg`-SSL-Warnung:** künftige `pg`-Major-Version ändert die `sslmode`-Semantik; `sslmode=verify-full` explizit setzen.
9. **Command-Center-Inhalt mit echtem Code nicht geprüft:** Der Zugangscode ist „sensitive“ und für Werkzeuge nicht lesbar.
10. **Migrationen nur indirekt belegt** (siehe 9.3). Direkte Prüfung: `node scripts/check-migration-status.cjs` mit Production-`DATABASE_URL` (Betreiber).
11. **Themen-Pfad:** Capability-Prüfung verlangt `META_PAGE_ID`/`META_INSTAGRAM_USER_ID`, der Affiliate-Pfad ermittelt die Seite selbst. Vor Aktivierung der Themen-Pipeline vereinheitlichen oder Variablen setzen.

## 11. Blockaden durch externe Freigaben

| Blocker | Benötigt von | Auswirkung |
|---|---|---|
| Direkter Production-DB-Zugriff (Migrationen 034–036, `daily_slot_runs`) | Betreiber (`DATABASE_URL` sensitive) | nur indirekter Nachweis |
| Command Center mit Laufzeitdaten prüfen | Betreiber (Zugangscode) | nur Erreichbarkeit belegt |
| WhatsApp-Vorlage / 24-h-Fenster | Betreiber (Kostenentscheidung) | Freigaben nur nach eigener Nachricht |
| Preview-Isolation (eigene Neon-Branch-DB, eigener Blob-Store, keine WhatsApp-/Meta-Zugänge in Preview) | Betreiber (Vercel-/Neon-Dashboard) | keine Schreibtests in Preview |
| TikTok (Developer-App, `video.publish`, App-Audit) | Betreiber + TikTok | Plattform blockiert |
| X (Schreibrecht, bezahlter API-Tarif) | Betreiber + X | Plattform blockiert |
| YouTube (API-Audit für öffentliche Uploads, Zustimmungsseite in Produktion) | Betreiber + Google | nur Dry-Run, Token-Ablauf |
| Meta-IDs für Themen-Pfad | Betreiber | IG/FB im Themen-Pfad blockiert |
| Vision-Smoke-Test Stufe 2 (ein bezahlter Aufruf) | Betreiber-Kostenfreigabe | Vision-Gate nicht live belegt |
| Aktivierung Themen-Pipeline / Live-Publishing / Trendsetter | Betreiber (Env-Schalter) | bewusst aus |
| PR #61 Reel Intelligence | Code-Überarbeitung + Review | nicht integriert |
| PR #10 Content-IDs | Neunummerierung der Migration + Review | nicht integriert |

## 12. Konkrete nächste Schritte

1. **Folge-PR (Bericht + Anzeige-Korrektur) mergen** und Production-Commit erneut prüfen (`list_deployments`, Startseite, `/api/architecture` 401).
2. **Betreiber:** im Studio Zugangscode eintragen, Command Center öffnen, Bereich „Infrastruktur → Postgres“ und Laufzeitnachweise prüfen; alternativ `node scripts/check-migration-status.cjs` mit Production-DB.
3. **Betreiber:** WhatsApp „Status“ senden – zeigt seit #68 Fensterende, letzte 6 Cron-Läufe und Zustellstatus je Freigabe. Erwartet: Eintrag für 13.10. Nachmittag (`needs_input`).
4. Nächste Cron-Slots (17:00 und 18:00 UTC) beobachten: Retry des Nachmittags-Slots bei offenem Fenster → erwartet `approval_sent` oder erneut `needs_input`.
5. **PR #65 schließen** (überholt durch #66). **PR #61** zurück an den Autor: `reel-intelligence` als Orchestrator-Eingabe statt Spezialisten-Import, Rebase auf `main`. **PR #10** entscheiden: neu nummerieren (≥ 037) oder schließen.
6. Preview-Isolation nach `docs/PREVIEW_ISOLATION_CHECKLIST.md` einrichten, Nachweis mit `scripts/check-preview-isolation.cjs`; erst danach Preview-Schreibtests.
7. YouTube-Zustimmungsseite auf „In Produktion“ stellen oder Token-Erneuerung vor dem 17.10. einplanen.
8. Themen-Pipeline nur gemäß `docs/GO_LIVE_RUNBOOK.md` §5 aktivieren (Dry-Run zuerst, eine Plattform, Cron per Codeänderung).
9. Technische Pflege: `next` auf feste Version pinnen; `sslmode=verify-full` in der DB-URL bzw. Client-Konfiguration.
10. Aufräumen nach Bestätigung: gemergte Remote-Branches (`claude/tender-ramanujan-55jabk`, `claude/pipeline-hardening-2026-10-12`, `claude/daily-approval-outage-2026-10-13`, `claude/integration-2026-10-13` sowie die 24 vollständig gemergten September-Branches) löschen; lokales Tag `backup/pre-integration-2026-10-13` danach entfernen.

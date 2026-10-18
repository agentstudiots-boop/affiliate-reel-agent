# 01 – Bestandsaufnahme (Stand 18.10.2026, `main` = `ea0559a`)

Grundlage: Quellcode, Migrationen, Tests, `vercel.json`, CI-Workflow, Projektdoku (`CLAUDE.md`, `AGENTS.md`,
`docs/PROJECT_STATUS.md`, `docs/PRODUCTION_AUDIT_FINAL_2026-10-15.md`, `docs/JARVIS_AUDIT_2026-10-10.md`), Git-Historie und
GitHub-Metadaten. **Nicht** geprüft: Produktionsdatenbank, Command-Center-Inhalte hinter dem Login, Vercel-Laufzeitdaten
(kein Zugang in dieser Sitzung, bewusst). Produktionsaussagen stammen deshalb aus den Audits vom 13.–16.10. und sind so markiert.

Statusbegriffe (wie im Projekt): **implementiert** (Code auf `main`) · **getestet** (Offline-Tests) · **aktiviert** (Schalter/Zugänge in
Production gesetzt) · **live verifiziert** (echter Production-Aufruf belegt) · **geplant** (nur Schnittstelle/Doku) · **nicht vorhanden**.

## 1. Rahmenbedingungen, die die Zielarchitektur bestimmen

| Fakt | Quelle | Folge für die Planung |
|---|---|---|
| Repository ist **öffentlich** (`visibility: public`) | GitHub-API, 18.10. | Geschäftsdaten, Chancenbewertungen, Finanzzahlen, Strategien dürfen **nicht** ins Repo – auch nicht in Übergabedateien. Nur Code, Schemata, anonymisierte Planung. |
| Kein Branch-Schutz auf `main` | `CLAUDE.md` §1 | „Keine Merges ohne Qualitätsprüfung“ ist heute nur Konvention. Für öffentliche Repos ist Branch-Schutz kostenlos verfügbar → Betreiberentscheidung. |
| Merge nach `main` ⇒ automatisches Production-Deployment | `CLAUDE.md` §1 | Jeder Auto-Merge wäre ein Auto-Deploy. |
| Vercel **Hobby**-Plan, Region `fra1`, Funktionslaufzeit bis `maxDuration = 300` s | `CLAUDE.md`, `app/api/**/route.ts` | Kein Dauerprozess: ein Executive kann nur ereignis- (Webhook) oder zeitgesteuert (Cron) laufen. Ob der Hobby-Plan für ein Geschäftssystem mit Einnahmen nach Vercel-Nutzungsbedingungen zulässig ist, ist **ungeprüft** → offene Frage Q-04. |
| Cron: 7 tägliche Einträge, Ausführung innerhalb der Stunde unscharf, Logs 1 h | `vercel.json`, `CLAUDE.md` §7 | Nachweise müssen in der DB liegen (wird bereits so gemacht: `daily_slot_runs`). |
| Neon Postgres, 37 additive Migrationen, automatische Anwendung mit Advisory-Lock | `lib/memory/migrations.ts`, `ensure-automation-schema.ts` | Wiederverwendbar für Aufgaben-, Kosten- und Chancenmodell. **Migrationsnummern kollidieren**, wenn zwei Sitzungen gleichzeitig 038 anlegen → Reservierungsregel nötig (siehe 05, §6). |
| Preview teilt DB/Blob/WhatsApp/Meta mit Production; `runtime-guard.ts` sperrt Wirkungen außerhalb Production | `lib/security/runtime-guard.ts` | Keine Schreibtests in Preview; neue Abteilungen müssen denselben Guard nutzen. |
| CI `Quality`: `npm ci`, `npm audit`, typecheck, lint, test (660 Tests, ~10 min), build | `.github/workflows/quality.yml` | Grundlage für die gegenseitige Qualitätsprüfung; ist bereits je PR aktiv. |
| Commits: 59 × „Claude“, 58 × Betreiberkonto `agentstudiots-boop` (darunter Merge-Commits und ein als „Codex-Audit“ bezeichneter PR #71) | `git log` | GPT-/Codex-Arbeit ist im Repo **nicht unterscheidbar** vom Betreiber. Für die Multi-Modell-Zusammenarbeit fehlt eine Urheberkennung → Commit-Trailer-Regel (05, §4). |

## 2. Komponenteninventar

### 2.1 Steuerung („Jarvis“)

| Komponente | Ort | Status | Bemerkung |
|---|---|---|---|
| Öffentlicher Orchestrator (Scout, Review, Content-Job) | `lib/orchestrator.ts` | implementiert · getestet · aktiv (Affiliate) | regelbasiert; „Jarvis“ ist **kein** LLM-Agent, sondern Ablaufsteuerung |
| Content-Orchestrator (einziger Importeur der Spezialisten) | `lib/content/orchestrator.ts` | implementiert · getestet · aktiv | Max. 2 Revisionen, 8 Modellaufrufe je Planung (AGENTS.md) |
| Themen-Pipeline-Orchestrator | `lib/topic-pipeline/orchestrator.ts` | implementiert · getestet · **aus** (`TOPIC_PIPELINE_ENABLED`) | kein Cron |
| Trendsetter / Jarvis-Routing (Affiliate ↔ Thema) | `lib/trendsetter/*`, Migration 035 | implementiert · getestet · **aus** (`TRENDSETTER_AFFILIATE`) | deterministisch, mit Zeitsperren und eindeutigem Routing-Index |
| Executive-Agent | `lib/publishing/authority.ts` | **geplant** (nur Schnittstelle `ApprovalAuthority`) | ausdrücklich **nicht** in `ACTIVE_APPROVAL_AUTHORITIES`; Aktivierung nur per Codeänderung |
| Automatische Fortsetzung | `lib/automation/continue.ts`, `/api/cron/continue` | implementiert · nicht geplant (kein Cron) | |

### 2.2 Agenten (Spezialisten ohne Tools, ohne gegenseitige Imports)

| Agent | Ort | Modell | Status |
|---|---|---|---|
| Trend-/Produkt-Scout | `lib/agents/product-scout.ts`, `lib/content/trend-scout.ts`, `research-mix.ts` | Tavily + Replicate `openai/gpt-4.1` | aktiv; Themen (`TRENDSCOUT_TOPICS`) und Produktmix (`PRODUCT_MIX`) aus |
| Produktprüfung | `lib/agents/product-reviewer.ts`, `lib/product-resolver.ts` | regelbasiert (Amazon-Detailseite) | aktiv |
| Creative / Video / Bild / Text / Marketing | `lib/content/agents/*` | Referenzmodus regelbasiert; KI-Modus `openai/gpt-4.1` | aktiv |
| WhatsApp-Router / Chat / Anweisungen / Transkription | `lib/whatsapp/route-llm.ts`, `chat.ts`, `instruction.ts`, `transcribe.ts` | `openai/gpt-5.6-terra` | aktiv (live genutzt laut Audits) |
| Bild-Qualitätsprüfung (Vision) | `lib/content/image-quality/*` | `IMAGE_QUALITY_MODEL` / Router-Modell | aktiv; Vision-Smoke-Test Stufe 2 nie ausgeführt |
| Themen-Scout | `lib/topics/*` | Tavily + Modell | implementiert · getestet · aus |
| Video (Runway, Faceless, HeyGen) | `lib/production/*`, `lib/visual/*` | Anbieter-APIs | Runway nach Kostenfreigabe; HeyGen aus und blockiert |

### 2.3 Freigaben und Sicherheit (wiederverwendbare Muster)

| Muster | Ort | Status | Wiederverwendung im KI-Unternehmen |
|---|---|---|---|
| WhatsApp-Freigabe gebunden an Nachricht + ID + Fingerprint + Version | `lib/whatsapp/content-approval.ts`, `lib/publishing/approval-gate.ts` | aktiv, live genutzt | **Vorlage für jede Betreiberentscheidung** (Ausgaben, Verträge, neue Abteilungen) |
| Kostenfreigabe je Produktion | `lib/production/request-cost-approval.ts` | aktiv | Vorlage für Budgetfreigaben |
| Atomare Budgets/Kontingente (Runway, HeyGen, Bild 12/24 h) | `lib/production/repository.ts`, `provider_usage` (030) | aktiv | Vorlage für Abteilungsbudgets |
| Freigabeinstanzen-Liste nur per Code | `lib/publishing/authority.ts` | aktiv | Executive bleibt **ohne** Freigaberecht |
| Admin-Session, `proxy.ts`, `authorized()` je Route | `lib/security/*`, `lib/memory/auth.ts` | aktiv, live verifiziert | gilt unverändert für neue APIs |
| Runtime-Guard (Preview fail-closed) | `lib/security/runtime-guard.ts` | aktiv | Pflicht für jede neue Wirkung |
| Idempotenz eingehender Nachrichten | `whatsapp_events.message_id` | aktiv | Vorlage für Aufgaben-Idempotenz |

### 2.4 Daten, Kosten, Berichte

| Thema | Ort | Status | Lücke |
|---|---|---|---|
| Modellaufruf-Protokoll (Agent, Modell, Erfolg, Latenz, Tokens, Rechenzeit) | `lib/observability/model-calls.ts`, `model_calls` (037) | implementiert · getestet · deployed; Einträge **nicht live gelesen** | keine Euro-Preise, keine Zuordnung zu Abteilung/Aufgabe |
| Anbieterverbrauch (Kontingente) | `provider_usage` (030) | aktiv | nur Einheiten, keine Beträge |
| Produktionskosten (Schätzung je Lauf) | `production_runs.estimated_cost_cents` (002) | aktiv | Schätzung, nicht Rechnung |
| Erlöse, Klicks, Conversions, Produktionskosten je Beitrag | `performance_observations` (001), `app/performance-editor.tsx` | implementiert; **manuelle Eingabe** | kein automatischer Import (keine Amazon-PartnerNet-Anbindung im Code) |
| Landing-Klicks | `landing_clicks` (025) | aktiv | nur eigene Seite, keine Amazon-Conversions |
| Wochenbericht (nur vorhandene Daten, „unbekannt“ statt Schätzung) | `lib/reporting/weekly.ts`, `/api/cron/weekly-report`, `weekly_reports` (008) | aktiv (Cron Mo 08:15 UTC) | Zustellung außerhalb 24-h-Fenster nur per Vorlage (aus) |
| Betriebsübersicht | `lib/reporting/operations.ts`, `/api/operations` | aktiv | Modellkosten ohne Euro |
| Strukturierte Ereignisse (bereinigt, ohne Secrets) | `lib/observability/events.ts` | aktiv | nur prozesslokal im Speicher + Log (1 h) – **nicht dauerhaft** |
| Infrastrukturkosten (Vercel, Neon, Blob), Abos (Replicate-Guthaben, Tavily, Claude, GPT) | – | **nicht vorhanden** | nur Betreiberdaten |

### 2.5 Command Center

| Teil | Ort | Status |
|---|---|---|
| Seite `/architecture` (Login), 3D-Szene (React Three Fiber) + 2D-Fallback | `app/architecture/*` | deployed, Erreichbarkeit live verifiziert; Inhalte mit Produktionsdaten nicht gesehen |
| Statisches Inventar mit drei Statusdimensionen (Umsetzung, Deployment, Betrieb) + KI-Modell je Komponente | `lib/architecture/model.ts` (458 Zeilen, 7 Cluster um Jarvis) | getestet (`tests/architecture.test.cjs`) |
| Betriebsstatus aus Variablennamen/Schaltern | `lib/architecture/runtime.ts` | getestet |
| Lesende DB-Nachweise (READ-ONLY-Transaktion je Abschnitt) | `lib/architecture/snapshot.ts` | getestet |
| Executive-Knoten | `model.ts` (`executive-agent`, `since: "none"`) | geplant, als „Kein Betrieb“ angezeigt |

Wichtig: Das Command Center hat bereits das richtige Grundprinzip („kein Status ohne Nachweis“, Werte verlassen nie den Server).
Die Erweiterung zum Unternehmens-Planetarium ist eine **zusätzliche Ebene**, keine Neuentwicklung.

### 2.6 API-Schnittstellen (vorhanden)

Intern (Login): `/api/content`, `/api/content/jobs`, `/api/production`, `/api/publication`, `/api/operations`, `/api/architecture`,
`/api/trends`, `/api/verify`, `/api/generate`, `/api/video/*`, `/api/instagram/reel`, `/api/assets/upload`, `/api/meta/connection`,
`/api/whatsapp/connection`, `/api/admin/migrate`. Öffentlich: `/api/whatsapp/webhook` (Meta-Signatur), `/api/cron/*` (`CRON_SECRET`),
`/api/landing/click`, `/api/auth/*`. **Es gibt keine generische Aufgaben-, Nachrichten- oder Abteilungsschnittstelle.**

## 3. Was für das KI-Unternehmenssystem fehlt (nicht vorhanden)

1. Abteilungsregister und einheitlicher Abteilungsvertrag (Eingaben, Ausgaben, Berechtigungen, Budget).
2. Generische, dauerhafte Aufgabenverwaltung (Aufgaben, Zustände, Leases, Idempotenz, Ereignisprotokoll).
3. Entscheidungsanfragen an den Betreiber außerhalb von Content (Ausgaben, Verträge, neue Abteilungen).
4. Kostenbuch mit Unterscheidung Messwert / Schätzung / Prognose, Preiskatalog, Budgets je Abteilung.
5. Erlösbuch mit Quelle (heute nur manuelle `performance_observations` je Beitrag).
6. Opportunity Scout (Geschäftschancen jenseits von Produkten/Themen) mit Bewertungsraster.
7. Executive-Berichte über mehrere Abteilungen.
8. Koordination Claude Code ↔ GPT Work: Übergabedateien, Besitzregeln, Urheberkennung, Review-Protokoll.
9. Command-Center-Ebene „Unternehmen“ (Abteilungen als Planeten).
10. Immobilien-Abteilung: **kein Code, keine Daten, keine Quellen**.

## 4. Parallelarbeit: bekannte Konfliktzonen

Die parallele Sitzung (Themen-Content/Video) hat zum Zeitpunkt dieser Analyse **keinen Branch auf GitHub** veröffentlicht
(letzte Remote-Änderung: `main`/`claude/clever-cori-b73qxg`, 16.10.). Ihre Dateien sind daher unbekannt. Wahrscheinliche Berührungspunkte:

| Datei / Bereich | Risiko | Regel bis zur Klärung |
|---|---|---|
| `lib/architecture/model.ts`, `runtime.ts`, `snapshot.ts`, `tests/architecture.test.cjs` | hoch (neue Videoknoten) | Diese Planung ändert sie **nicht**; Phase H erst nach Merge der Videoarbeit oder in eigener Datei |
| `lib/memory/migrations.ts`, `db/migrations/038+` | hoch (Nummernkollision) | Nummernreservierung (05, §6) |
| `docs/PROJECT_STATUS.md`, `CLAUDE.md` | mittel (beide Sitzungen pflegen) | Diese Planung ändert sie **nicht**; Verweis erst nach Freigabe |
| `lib/topic-pipeline/*`, `lib/visual/*`, `lib/production/*` | hoch | Tabu für das KI-Unternehmensprojekt bis Phase G |
| `lib/observability/model-calls.ts` | mittel | Erweiterung (Abteilungszuordnung) erst in Phase E, abgestimmt |

Dieser Branch enthält ausschließlich neue Dateien unter `docs/ai-business/`.

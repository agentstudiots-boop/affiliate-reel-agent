# 02 – Grobe Zielarchitektur „Autonomous AI Business System“

Status: **Entwurf zur Prüfung.** Nichts davon ist implementiert. Alle Code- und SQL-Skizzen sind Diskussionsgrundlage, keine Migrationen.

## 1. Leitprinzipien

1. **Software zuerst, KI nur wo Sprache oder Urteil nötig ist.** Steuerung, Zustände, Budgets, Berechtigungen, Kennzahlen,
   Bewertungsformeln und Fristen sind deterministischer Code. KI-Modelle formulieren, recherchieren, fassen zusammen, klassifizieren.
2. **Der Betreiber ist die einzige Freigabeinstanz** für alles mit Außenwirkung, Geld, Verträgen oder Strategie.
   Der Executive bereitet Entscheidungen vor, er trifft sie nicht (`ACTIVE_APPROVAL_AUTHORITIES` bleibt `["whatsapp_operator"]`).
3. **Bestehendes wiederverwenden:** Freigabe-Gate-Muster, Runtime-Guard, `model_calls`, `provider_usage`, Wochenbericht,
   Command-Center-Statusmodell, Postgres-Migrationsmechanik, WhatsApp-Router.
4. **Ein Kern, austauschbare Abteilungen:** Eine neue Abteilung = ein Modul, das einen festen Vertrag erfüllt, plus Registereintrag.
   Der Kern ändert sich dafür nicht.
5. **Kein Wert ohne Herkunft:** Jede Zahl trägt `value_kind` (gemessen / geschätzt / prognostiziert / angenommen) und eine Quelle.
   Fehlt die Zahl, bleibt sie `null` und wird als „unbekannt“ angezeigt.
6. **Ereignis- und zeitgesteuert, nicht Dauerschleife:** passt zu Vercel (Cron, Webhooks, `maxDuration` ≤ 300 s).
   Keine rekursiven Agentenschleifen; jede Aufgabe hat Budget, Frist und maximale Versuchszahl.
7. **Öffentliches Repository:** Geschäftsdaten leben ausschließlich in der Datenbank, nie im Repo.

## 2. Schichtenmodell

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ BETREIBER  – WhatsApp (primär) · Command Center · später E-Mail/PDF                  │
└───────────────▲───────────────────────────────────────────────┬──────────────────────┘
                │ Berichte, Entscheidungsanfragen               │ Aufträge, Freigaben
┌───────────────┴───────────────────────────────────────────────▼──────────────────────┐
│ EXECUTIVE  (lib/enterprise/executive/*)                                              │
│  Kern (deterministisch): Register · Aufgabenbuch · Richtlinien/Berechtigungen ·      │
│  Budgetwächter · Eskalation · Berichtsplaner                                         │
│  KI-Teil (eng begrenzt): Intake natürlicher Sprache (bestehender WhatsApp-Router),   │
│  Berichtsformulierung, Zusammenfassung von Abteilungsergebnissen                     │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┬───────────────────┘
       │ Abteilungsvertrag (Task-Request / Task-Result / Decision-Request / Health)
┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼──────┐ ┌─────▼──────────┐ ┌─▼────────────────────┐
│ CONTROLLING│ │ OPPORTUNITY│ │ ENGINEERING │ │ AFFILIATE      │ │ WEITERE (Immobilien…) │
│ (Software) │ │ SCOUT      │ │ (Prozess +  │ │ CONTENT STUDIO │ │ erst nach Machbarkeit │
│            │ │ (KI+Regeln)│ │  Werkzeuge) │ │ (= heutiges    │ │                       │
│            │ │            │ │             │ │  Jarvis-System)│ │                       │
└──────┬─────┘ └──────┬─────┘ └──────┬──────┘ └─────┬──────────┘ └─┬────────────────────┘
       └──────────────┴──────────────┴──────────────┴──────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────────────────────┐
│ GEMEINSAME INFRASTRUKTUR: Postgres (Neon) · Runtime-Guard · Admin-Auth · model_calls │
│ · provider_usage · Ereignisse · Blob · Freigabe-Gates · Cron · Command Center        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Executive

### 3.1 Rolle
Operativer Koordinator („KI-Geschäftsführer“ im Sinne von *Vorbereitung und Koordination*, nicht *Zeichnungsbefugnis*).

### 3.2 Aufbau (Empfehlung: Kern regelbasiert, KI als Werkzeug)

| Baustein | Umsetzung | KI? | Begründung |
|---|---|---|---|
| Abteilungsregister | statischer, versionierter Code (`lib/enterprise/registry.ts`), analog `lib/architecture/model.ts` | nein | Änderungen sollen geprüfte Codeänderungen sein |
| Aufgabenbuch (Tasks, Zustände, Leases) | Postgres-Tabellen, `FOR UPDATE SKIP LOCKED` | nein | Idempotenz und Nachvollziehbarkeit |
| Priorisierung | Formel: Dringlichkeit × erwarteter Nutzen ÷ Kosten, Gewichte vom Betreiber | nein | reproduzierbar, prüfbar |
| Richtlinien/Berechtigungen | Code-Tabelle Aktion → Stufe (siehe 3.4) | nein | darf nie durch Modellausgabe geändert werden |
| Budgetwächter | atomare Reservierung wie `provider_usage` | nein | vorhandenes Muster |
| Eskalation | Regeln (Fehlerquote, Fristüberschreitung, Budget > 80 %) | nein | |
| Intake (Betreiber schreibt frei per WhatsApp) | bestehender semantischer Router um Absicht `executive.*` erweitern | ja (`gpt-5.6-terra`, vorhanden) | keine zweite Router-Instanz |
| Zusammenführung/Bewertung von Ergebnissen | strukturierte Ergebnisse + Regeln; KI nur für Zusammenfassungstext | teilweise | |
| Berichte | Daten per SQL, Text optional per 1 Modellaufruf/Bericht | optional | Bericht muss auch ohne KI vollständig sein (Fallback) |

### 3.3 Ablauf (Beispiel Wochenzyklus)
1. Cron `executive-cycle` (z. B. täglich 1 ×) liest Aufgabenbuch, Budgets, Health aller Abteilungen.
2. Regeln erzeugen fällige Aufgaben (z. B. „Controlling: Wochenabschluss“, „Scout: Recherche Thema X“, sofern Budget frei).
3. Abteilungen bearbeiten Aufgaben innerhalb ihres Budgets und liefern strukturierte Ergebnisse.
4. Executive prüft Ergebnisse gegen Vertrag (Zod) und Regeln; Abweichungen → Eskalation.
5. Entscheidungsbedürftiges wird gesammelt und **gebündelt** per WhatsApp vorgelegt (max. 1 Sammelnachricht/Tag, außer kritisch).
6. Wochenbericht (erweitert den bestehenden `weekly-report`).

### 3.4 Berechtigungsstufen (verbindlich, im Code)

| Stufe | Beispiele | Wer darf auslösen |
|---|---|---|
| **L0 Beobachten** | lesen, Kennzahlen berechnen, Health | Abteilung selbst |
| **L1 Intern analysieren** | Recherche mit Budgetdeckel, Entwürfe, Bewertungen | Abteilung innerhalb Budget |
| **L2 Intern umkehrbar schreiben** | Aufgaben anlegen, Status setzen, Notizen | Executive/Abteilung |
| **L3 Außenwirkung** | WhatsApp-Nachricht, Veröffentlichung, kostenpflichtiger Medienauftrag über Budgetrest | nur über bestehende Freigabe-Gates mit Betreiberfreigabe |
| **L4 Geld, Verträge, Strategie, Zugänge** | Abos, Käufe, Verträge, neue Abteilung aktivieren, Schalter/Secrets ändern, Budgets erhöhen | **nur Betreiber**, außerhalb des Systems ausgeführt; das System erzeugt nur eine Entscheidungsvorlage |

Der Executive besitzt **keine** Zahlungsmittel, keine Secrets-Schreibrechte, keine GitHub-Schreibrechte und kein Freigaberecht.

## 4. Abteilungen: Zuständigkeiten und Schnittstellen

| Abteilung | Verantwortung | Eingaben | Ausgaben | Orchestrator | Unteragenten / Bausteine | KI-Anteil |
|---|---|---|---|---|---|---|
| **Executive** | Koordination, Priorisierung, Eskalation, Berichte | Betreiberaufträge, Abteilungsergebnisse, Health, Budgets | Aufgaben, Entscheidungsvorlagen, Berichte | `executive/kernel.ts` | Intake (vorh. Router), Berichtsschreiber | gering |
| **Controlling** | Kosten, Erlöse, Budgets, Deckungsbeiträge, ROI | `model_calls`, `provider_usage`, `production_runs`, `performance_observations`, manuelle Rechnungs-/Erlösbelege, Preiskatalog | Kennzahlen je Abteilung/Agent/Monat, Budgetwarnungen, Rentabilitätsrechnungen | `controlling/orchestrator.ts` | Importer (Software), Kennzahlenrechner (SQL), Prognose (Formel) | **keiner** |
| **Opportunity Scout** | Geschäftschancen finden und einheitlich bewerten | Suchaufträge, Betreiberinteressen, Ausschlusslisten | bewertete Chancen mit Fakten/Annahmen/Prognosen getrennt, Empfehlung | `opportunity/orchestrator.ts` | Recherche (Tavily, vorhanden), Extraktion (LLM, strukturiert), Bewertungsraster (Regeln), Wirtschaftlichkeit (über Controlling-Formeln) | mittel, gedeckelt |
| **Engineering** | technische Weiterentwicklung | Anforderungen, Fehlerberichte, Review-Befunde | Aufgabendateien, Branches, PRs, Reviews, Releases | **kein Laufzeit-Agent** – Prozess im Repo (05) | Claude Code, GPT Work, CI, Validator | extern |
| **Affiliate Content Studio** | bestehende Geschäftseinheit | Chancen, Aufträge | Beiträge, Veröffentlichungen, Kosten, Klicks | bestehend: `lib/orchestrator.ts` + `lib/content/orchestrator.ts` | bestehende Agenten | unverändert |
| **Immobilien-Analyse** | (geplant) Markt-/Objektanalyse | – | – | – | – | erst nach Machbarkeitsprüfung (Phase I) |

### 4.1 Abteilungsvertrag (Skizze)

```ts
// lib/enterprise/contract.ts (Skizze – nicht implementiert)
export type PermissionLevel = "L0" | "L1" | "L2" | "L3" | "L4";
export interface DepartmentModule<K extends string = string> {
  id: string;                       // "controlling", "opportunity", "affiliate"
  version: number;                  // Vertragsversion
  accepts: readonly K[];            // Aufgabenarten, z. B. "controlling.monthly_close"
  maxLevel: PermissionLevel;        // höchste Stufe, die das Modul selbst ausführen darf (nie L3/L4)
  schemas: Record<K, { input: ZodType; output: ZodType }>;
  handle(task: TaskEnvelope<K>, ctx: DepartmentContext): Promise<TaskResult>;  // ohne Zugriff auf andere Abteilungen
  health(ctx: DepartmentContext): Promise<HealthReport>;                        // nur lesend
}
// ctx stellt bereit: db (eingeschränkt), budget.reserve()/settle(), recordModelCall, emitEvent, guard (runtime-guard), clock
```

Regeln wie heute in `AGENTS.md`: Abteilungen importieren einander **nicht**; nur der Executive-Kern ruft Module auf.
Abteilungen, die eine andere brauchen (Scout braucht Wirtschaftlichkeitsrechnung), erzeugen eine **Folgeaufgabe** über den Kern.

### 4.2 Nachrichtenformat (Task-Envelope)

```json
{
  "schema_version": 1,
  "message_id": "msg_…",
  "correlation_id": "cor_…",
  "causation_id": "msg_… | null",
  "kind": "task.request | task.result | task.failed | decision.request | decision.result | report | health",
  "from": "executive",
  "to": "controlling",
  "task_kind": "controlling.monthly_close",
  "permission_level": "L1",
  "budget": { "max_model_calls": 0, "max_cost_cents": 0, "deadline": "2026-12-01T08:00:00Z" },
  "idempotency_key": "controlling.monthly_close:2026-11",
  "payload": { },
  "created_at": "2026-12-01T07:00:00Z"
}
```

Transport: Postgres-Tabelle als Warteschlange (kein externer Broker, keine zusätzlichen Kosten). Zustellung „mindestens einmal“,
Wirkung „genau einmal“ über `idempotency_key` (gleiches Muster wie `whatsapp_events.message_id`).

## 5. Datenmodell (Skizze, additive Tabellen)

```sql
-- Aufgabenbuch
enterprise_tasks(id, department, task_kind, status /*queued|leased|running|succeeded|failed|needs_decision|cancelled*/,
  priority, permission_level, parent_id, correlation_id, idempotency_key UNIQUE, input jsonb, output jsonb,
  attempts, max_attempts, lease_until, deadline, budget_cents_reserved, created_by /*operator|executive|cron|department*/,
  created_at, updated_at)
enterprise_task_events(id, task_id, seq, kind, actor, detail jsonb, created_at)          -- append-only
-- Betreiberentscheidungen (Muster wie content_approval_requests / publish_approvals)
enterprise_decisions(id, task_id, level /*L3|L4*/, subject, options jsonb, recommendation jsonb, fingerprint, version,
  status /*pending|approved|rejected|expired|superseded*/, request_message_id, decided_message_id, decided_at, evidence jsonb)
-- Controlling
price_catalog(id, provider, item /*Modell, Einheit*/, unit /*input_token|output_token|second|image|video_second|month*/,
  price_micros, currency, valid_from, valid_to, source_url, entered_by, entered_at)            -- vom Betreiber gepflegt
cost_entries(id, occurred_at, department, agent, task_id, provider, category /*model|media|research|infra|subscription|other*/,
  quantity, unit, amount_cents NULL, currency, value_kind /*measured|estimated|forecast*/, source /*model_calls|provider_usage|invoice|manual*/,
  source_ref, price_catalog_id NULL)
revenue_entries(id, period_start, period_end, department, channel, amount_cents NULL, currency,
  value_kind /*measured|estimated|forecast*/, source /*partnernet_export|manual|…*/, source_ref, entered_at)
budgets(id, department, period /*YYYY-MM*/, limit_cents, kind /*hard|soft*/, approved_decision_id)
-- Opportunity Scout
opportunities(id, title, category, status /*new|researching|assessed|recommended|parked|rejected|approved_for_test*/,
  first_seen_at, last_assessed_at, assessment_version)
opportunity_assessments(id, opportunity_id, version, criterion, value_num NULL, value_text NULL, unit,
  kind /*fact|assumption|forecast*/, confidence /*low|medium|high*/, sources jsonb, method, created_at)
-- Berichte
executive_reports(id, period, kind /*daily_digest|weekly|monthly*/, content jsonb, delivered_message_id, created_at)
```

Bezug zum Bestand: `cost_entries` wird aus `model_calls`, `provider_usage` und `production_runs` **abgeleitet** (Importlauf, idempotent über
`source_ref`), die Quelltabellen bleiben unverändert. `revenue_entries` ergänzt `performance_observations`, ersetzt sie nicht.

## 6. Opportunity Scout – Bewertungsraster

Jedes Kriterium wird als eigene Zeile in `opportunity_assessments` gespeichert, mit Art (Fakt / Annahme / Prognose), Quelle und Konfidenz.

| Kriterium | Typ | Ermittlung | Bemerkung |
|---|---|---|---|
| Marktpotenzial | Zahl + Text | Recherche (Quellen) | Fakt nur mit Quelle, sonst Annahme |
| Zielgruppe | Text | Recherche + LLM-Extraktion | |
| Wettbewerb | Skala 1–5 + Belege | Recherche | |
| Eintrittsbarrieren | Skala 1–5 | Regeln + Recherche | |
| Investitionsbedarf | € | Annahme/Schätzung | nie als Fakt ohne Angebot |
| Laufende Kosten | €/Monat | Controlling-Preiskatalog | |
| Umsatz-/Gewinnpotenzial | €/Monat (Spanne) | **Prognose**, Formel offengelegt | immer Spanne, nie Punktwert |
| Skalierbarkeit | Skala | Regeln | |
| Amortisationsdauer | Monate | Formel aus Investition / Gewinnspanne | nur wenn beide Eingaben vorhanden, sonst „unbekannt“ |
| Technische Umsetzbarkeit | Skala + Begründung | Engineering-Einschätzung | |
| Automatisierungsgrad | % (Schätzung) | Regeln | |
| Rechtliche Risiken | Liste | Checkliste (Kennzeichnung, Lizenzen, Beratungsrecht, Datenschutz) | **keine Rechtsberatung**, nur Prüfpunkte für den Betreiber |
| Abhängigkeit von Drittanbietern | Liste + Skala | Regeln | |
| Voraussichtliche Trenddauer | Text/Spanne | Prognose aus Quellen | |

Gesamtwert = gewichtete Summe mit **vom Betreiber festgelegten Gewichten** (Konfiguration, versioniert). Fehlende Kriterien senken die
Konfidenz und blockieren die Empfehlung „Test freigeben“, statt geschätzt zu werden.

Kostenbremse: je Lauf max. N Tavily-Suchen und M Modellaufrufe (Konfiguration, Standard klein), Monatsbudget über `budgets`.

## 7. Controlling – Kennzahlen

Deckungsbeitrag je Abteilung/Monat = gemessene Erlöse − (gemessene + geschätzte direkte Kosten), **getrennt ausgewiesen**.
Anzeige immer dreispaltig: *gemessen* · *geschätzt* · *prognostiziert*; „unbekannt“, wenn eine Quelle fehlt.
Kosten je Agent = Σ `model_calls` × Preis aus `price_catalog` (gültig zum Zeitpunkt). Ohne Preis: Tokens/Rechenzeit, keine Euro.
ROI und Amortisation nur bei vorhandenen Messwerten; Prognosen tragen Formel und Annahmen.
Infrastruktur- und Abokosten: monatliche manuelle Belege (`cost_entries.source = 'invoice'|'manual'`), weil keine API vorhanden ist.

## 8. Kommunikation mit dem Betreiber

| Typ | Kanal | Häufigkeit | Inhalt |
|---|---|---|---|
| Kritisch (Ausfall, Budget hart erreicht, Sicherheitsereignis) | WhatsApp sofort (im 24-h-Fenster; sonst Vorlage, wenn genehmigt) | ereignisbasiert, gedrosselt | Problem, Wirkung, was gestoppt wurde, was nötig ist |
| Entscheidungsvorlagen | WhatsApp gebündelt | max. 1 ×/Tag | nummerierte Vorlagen, je mit Fingerprint; Antwort „Freigeben 2“ auf genau diese Nachricht |
| Tagesüberblick (optional) | Command Center | täglich | |
| Wochenbericht | WhatsApp + Command Center (erweitert `weekly-report`) | wöchentlich | erledigt, neue Chancen, Wirtschaft, Probleme, offene Entscheidungen, Entwicklungskosten, Prioritäten |
| Monatsabschluss | Command Center, später PDF/E-Mail | monatlich | Controlling-Abschluss |

Das 24-h-Servicefenster bleibt die harte Grenze; ohne genehmigte Vorlage werden Berichte im Command Center bereitgestellt und beim nächsten
Betreiberkontakt angekündigt.

## 9. Command Center – Planetarium

Erweiterung, keine Neuentwicklung:
- Neue oberste Ebene „Unternehmen“: **Executive** im Zentrum, Abteilungen als Planeten. Das heutige Jarvis-System wird zum Planeten
  „Affiliate Content Studio“; seine sieben Cluster werden beim Öffnen als Monde gezeigt (bestehende Szene wird wiederverwendet).
- Eigene Datei für die Unternehmensebene (`lib/architecture/enterprise.ts`), damit `model.ts` (Konfliktzone) kaum geändert wird.
- Je Planet: Status (aus Health), Orchestrator, aktive Agenten + KI-Modell, laufende Aufgaben, letzte Entscheidungen, Fehler/Warnungen,
  Modellaufrufe/Tokens, Kosten (gemessen/geschätzt getrennt), Erlöse, offene Freigaben, Entwicklungsfortschritt (aus Übergabedateien).
- Gleiche Regeln wie heute: nur lesende READ-ONLY-Abfragen, kein Status ohne Nachweis, „keine Produktionsdaten“ ausdrücklich angezeigt.

## 10. Sicherheit

- Neue APIs: `authorized()` je Route, `proxy.ts`-Schutz, keine neuen öffentlichen Routen (außer bewusster Entscheidung + Testeintrag).
- Jede Wirkung über `runtime-guard`; neue Wirkungsart `enterprise_task` (Cron) braucht alle Isolationsressourcen in Preview.
- Prompt-Injection: Rechercheinhalte (Webseiten) sind Daten; Modellausgaben können keine Aufgaben mit Stufe ≥ L3 erzeugen und keine
  Berechtigungen ändern (Validierung im Kern, Test).
- Keine Geschäftsdaten im öffentlichen Repo (auch keine Beispielwerte aus Produktion in Tests).

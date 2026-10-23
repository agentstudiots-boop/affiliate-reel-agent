# 02 – Grobe Zielarchitektur „Autonomous AI Business System“

Status: **Entwurf zur Prüfung, Runde 2** (nach GPT-Review A-01/review-1.json, Befunde GPT-01, -06, -07, -10). Nichts davon ist implementiert.
Alle Code- und SQL-Skizzen sind Diskussionsgrundlage, keine Migrationen.

## 1. Leitprinzipien

1. **KI plant und urteilt, Code sichert ab.** Der Executive und der Opportunity Scout nutzen KI für Planung, Analyse, Priorisierung
   und Entscheidungsvorbereitung. Zustände, Budgets, Berechtigungen, Kennzahlen, Formeln und Fristen sind deterministischer Code,
   der jeden KI-Vorschlag prüft, bevor etwas geschieht. Ein Modell kann nie selbst Rechte, Budgets oder Stufen festlegen.
2. **Der Betreiber ist die einzige Freigabeinstanz** für alles mit Außenwirkung, Geld, Verträgen oder Strategie.
   Der Executive bereitet Entscheidungen vor, er trifft sie nicht (`ACTIVE_APPROVAL_AUTHORITIES` bleibt `["whatsapp_operator"]`).
3. **Bestehendes wiederverwenden:** Freigabe-Gate-Muster, Runtime-Guard, `model_calls`, `provider_usage`, Wochenbericht,
   Command-Center-Statusmodell, Postgres-Migrationsmechanik, WhatsApp-Router.
4. **Ein Kern, austauschbare Abteilungen:** Eine neue Abteilung = ein Modul, das einen festen Vertrag erfüllt, plus Registereintrag.
   Der Kern ändert sich dafür nicht.
5. **Kein Wert ohne Herkunft:** Jede Zahl trägt `value_kind` (gemessen / geschätzt / prognostiziert / angenommen) und eine Quelle.
   Fehlt die Zahl, bleibt sie `null` und wird als „unbekannt“ angezeigt.
6. **Ereignis- und zeitgesteuert, nicht Dauerschleife:** passt zu Vercel (Cron, Webhooks, `maxDuration` ≤ 300 s; Hobby-Cron nur
   stundengenau). Keine rekursiven Agentenschleifen; jede Aufgabe hat Budget, Frist und maximale Versuchszahl.
8. **Externe Wirkung ist nie „genau einmal“ garantiert:** Postgres-Idempotenz schützt nur die eigene Datenbank. Für Anbieter- und
   Kanalaufrufe gilt das bestehende Muster: Absicht vorher speichern, unklares Ergebnis = `outcome_unknown`, Abgleich statt Wiederholung.
7. **Öffentliches Repository:** Geschäftsdaten leben ausschließlich in der Datenbank, nie im Repo.

## 2. Schichtenmodell

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ BETREIBER  – WhatsApp (primär) · Command Center · später E-Mail/PDF                  │
└───────────────▲───────────────────────────────────────────────┬──────────────────────┘
                │ Berichte, Entscheidungsanfragen               │ Aufträge, Freigaben
┌───────────────┴───────────────────────────────────────────────▼──────────────────────┐
│ EXECUTIVE  (lib/enterprise/*) – organisatorisch unabhängig vom Affiliate-Jarvis      │
│  Planer (KI): Ziele zerlegen, Alternativen, Priorisierung, Bewertung von Ergebnissen, │
│  Entscheidungsvorlagen, Berichte · Intake über den bestehenden WhatsApp-Router       │
│  Kern (Code): Register · Plan-Validator · Richtlinien L0–L4 · Budgetreservierung ·   │
│  Aufgabenbuch mit Lease · Outbox · Eskalation · Audit                                │
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
Zentrale, KI-gestützte Unternehmensführung zwischen Betreiber und Abteilungen. **Organisatorisch unabhängig** vom Affiliate Content Studio:
Jarvis bleibt der Orchestrator *dieser* Abteilung; der Executive steuert sie nur über Aufträge und Kennzahlen. Der Executive plant,
analysiert, priorisiert und **entscheidet selbst innerhalb seines Mandats** (Stufen L0–L2 und freigegebenes Budget). Alles darüber
bereitet er als Entscheidungsvorlage für den Betreiber vor.

### 3.2 Hybrid-Aufbau (ADR-01, Runde 2)

| Baustein | Umsetzung | KI? |
|---|---|---|
| **Planer** | Modellaufruf erzeugt einen strukturierten `ExecutivePlan` (siehe 3.3) aus Zielen, Kennzahlen, Abteilungsstatus und offenen Entscheidungen | ja |
| **Analyse/Bewertung** | Modell bewertet Abteilungsergebnisse gegen Ziel und Belege, benennt Abweichungen und Gegenargumente | ja |
| **Intake** | bestehender semantischer WhatsApp-Router mit neuer Absicht `executive.*` (keine zweite Router-Instanz) | ja (vorhanden) |
| **Berichte** | Daten per SQL; Text und Einordnung per Modell; ohne Modell bleibt ein vollständiger Datenbericht (Fallback) | ja, optional |
| **Plan-Validator** | Zod-Vertrag, bekannte Abteilungen/Aufgabenarten, Abhängigkeiten ohne Zyklen, Tiefe/Schritte begrenzt, Kostensumme ≤ Deckel ≤ Budget | nein |
| **Richtlinien** | Stufe wird aus der **Aktion** abgeleitet, nie aus der Modellausgabe übernommen; L3b/L4-Schritte werden zu Entscheidungsvorlagen | nein |
| **Budgetwächter** | Reservierung **vor** jedem kostenpflichtigen Schritt, Abrechnung danach; unklarer Anbieterstatus gibt die Reservierung nicht frei | nein |
| **Aufgabenbuch** | Postgres, Lease mit Fencing-Zähler, Outbox, Ereignisprotokoll | nein |
| **Eskalation** | Regeln (Fehlerquote, Frist, Budget > 80 %, `outcome_unknown`) | nein |

Damit hat der Executive echte Planungs- und Entscheidungsfähigkeit. **Designziel** (noch nicht nachgewiesen, GPT-R2-05): Modellfehler oder
Prompt-Injection erzeugen keine **unautorisierten** Wirkungen – keine Rechteerweiterung, keine Veröffentlichung, keine Ausgabe über das
reservierte Budget. Budgetierte Modellaufrufe (L1) **verursachen ausdrücklich Kosten** in der freigegebenen Höhe. Der Nachweis entsteht erst
mit Implementierung (B-01, B-05) und adversarialen Tests.

### 3.3 Plan-Vertrag (Skizze, Baustein B-01)

```ts
type ExecutivePlan = {
  goal: string;
  evidence: { claim: string; kind: "fact" | "assumption" | "forecast"; source?: string }[];
  alternatives: { title: string; why_not?: string }[];
  steps: { id: string; department: DepartmentId; taskKind: string; action: ActionKind; dependsOn: string[];
           maxCostCents: number; maxModelCalls: number; deadline?: string }[];
  expectedValue: { low: number; high: number; unit: string; kind: "forecast" } | null;   // immer Spanne
  costCapCents: number;
  abortCriteria: string[];
  openDecisions: { question: string; options: string[]; recommendation?: string }[];
};
// validatePlan(raw, registry, limits) → { ok, plan, executable: Step[], decisionRequests: Step[], violations: string[] }
```

Ungültiger Plan oder fehlende Daten ⇒ stoppen und eskalieren, keine stillschweigende Ausweitung. Qualität wird nicht über identische
Antworten gemessen, sondern über feste Evaluationsfälle (widersprüchliche Ziele, fehlende Daten, Quellen-Injection, unrealistische
Renditen, abgelaufene Freigaben, Budgetmangel) und zunächst im **Schattenbetrieb** gegen Betreiberentscheidungen. Modellwahl bleibt offen,
bis `model_calls`-Daten und eine Kostenfreigabe vorliegen.

### 3.4 Ablauf (Beispiel)
1. Anstoß: Cron `executive-cycle` (Schalter, Standard aus), Betreiber-WhatsApp oder manueller Start.
2. Kern sammelt Kennzahlen, Abteilungsstatus, Budgets, offene Entscheidungen → Planer erzeugt Plan → Validator prüft.
3. Ausführbare Schritte (L0–L2, im Budget) werden Aufgaben der Abteilungen; L3b/L4-Schritte werden Entscheidungsvorlagen.
4. Abteilungen liefern strukturierte Ergebnisse; der Executive bewertet sie (KI) und der Kern prüft Vertrag und Budget.
5. Entscheidungsvorlagen gebündelt per WhatsApp (max. 1 Sammelnachricht/Tag, außer kritisch); Wochenbericht.

### 3.5 Berechtigungsstufen (verbindlich, im Code; korrigiert nach GPT-10)

| Stufe | Beispiele | Wer darf auslösen |
|---|---|---|
| **L0 Beobachten** | lesen, Kennzahlen berechnen, Health | Abteilung selbst |
| **L1 Intern analysieren** | Recherche/Modellaufrufe innerhalb des reservierten Budgets, Entwürfe, Bewertungen | Executive/Abteilung |
| **L2 Intern umkehrbar schreiben** | Aufgaben anlegen, priorisieren, Status setzen, Notizen | Executive/Abteilung |
| **L3a Vorab autorisierte Mitteilung** | Bericht oder Entscheidungsanfrage **an den Betreiber** über den bestehenden Kanal, im 24-h-Fenster, gedrosselt | Executive (Regel, keine Einzelfreigabe) |
| **L3b Außenwirkung** | Veröffentlichung, Nachricht an Dritte, kostenpflichtiger Auftrag über dem reservierten Budget | nur über bestehende Freigabe-Gates mit Betreiberfreigabe |
| **L4 Geld, Verträge, Strategie, Zugänge** | Abos, Käufe, Verträge, neue Abteilung, Schalter/Secrets, Budgeterhöhung | **nur Betreiber**, außerhalb des Systems; das System liefert nur die Vorlage |

Der Executive besitzt **keine** Zahlungsmittel, keine Secrets-Schreibrechte, keine GitHub-/Vercel-Schreibrechte und kein Freigaberecht
(`ACTIVE_APPROVAL_AUTHORITIES` bleibt `["whatsapp_operator"]`).

## 4. Abteilungen: Zuständigkeiten und Schnittstellen

| Abteilung | Verantwortung | Eingaben | Ausgaben | Orchestrator | Unteragenten / Bausteine | KI-Anteil |
|---|---|---|---|---|---|---|
| **Executive** | Planung, Priorisierung, Bewertung, Entscheidungen im Mandat, Eskalation, Berichte | Betreiberziele/-aufträge, Abteilungsergebnisse, Health, Budgets, Controlling-Kennzahlen | Pläne, Aufgaben, Entscheidungsvorlagen, Berichte | `lib/enterprise/executive/*` | Planer, Bewerter, Intake (vorh. Router), Berichtsschreiber | **hoch, gedeckelt** |
| **Controlling** | Kosten, Erlöse, Budgets, Deckungsbeiträge, ROI | `model_calls`, `provider_usage`, `production_runs`, `performance_observations`, manuelle Rechnungs-/Erlösbelege, Preiskatalog | **Datenvertrag** `ControllingSnapshot` (lesend), Budgetwarnungen, Rentabilitätsrechnungen | `controlling/orchestrator.ts` | Importer, Kennzahlenrechner, Formeln | **keiner** (Interpretation übernimmt der Executive) |
| **Opportunity Scout** | Geschäftschancen finden und einheitlich bewerten | Suchaufträge, Betreiberinteressen, Ausschlusslisten | bewertete Chancen mit Fakten/Annahmen/Prognosen getrennt, Empfehlung | `opportunity/orchestrator.ts` | Recherche (Tavily, vorhanden), Extraktion (LLM, strukturiert), Bewertungsraster (Regeln), Wirtschaftlichkeit (über Controlling-Formeln) | mittel, gedeckelt |
| **Engineering** | technische Weiterentwicklung in drei getrennten Rollen: **Planung → Implementierung → unabhängige Prüfung** | genehmigte Vorhaben, Fehlerberichte, Review-Befunde | Aufgabendateien, Branches, PRs, Reviews, Releases | **kein Laufzeit-Agent** in der Production-App – Prozess im Repo (05) | Claude-Code- und Codex-Agenten je Rolle, CI | extern |
| **Affiliate Content Studio** | bestehende Geschäftseinheit | Chancen, Aufträge | Beiträge, Veröffentlichungen, Kosten, Klicks | bestehend: `lib/orchestrator.ts` + `lib/content/orchestrator.ts` | bestehende Agenten | unverändert |
| **Immobilien-Analyse** | (geplant) Markt-/Objektanalyse | – | – | – | – | erst nach Machbarkeitsprüfung (Phase I) |

### 4.1 Abteilungsvertrag (Skizze)

```ts
// lib/enterprise/contract.ts (Skizze – nicht implementiert)
export type PermissionLevel = "L0" | "L1" | "L2" | "L3a" | "L3b" | "L4";
export interface DepartmentModule<K extends string = string> {
  id: string;                       // "controlling", "opportunity", "affiliate"
  version: number;                  // Vertragsversion
  accepts: readonly K[];            // Aufgabenarten, z. B. "controlling.monthly_close"
  maxLevel: PermissionLevel;        // höchste Stufe, die das Modul selbst ausführen darf (nie L3b/L4)
  schemas: Record<K, { input: ZodType; output: ZodType }>;
  handle(task: TaskEnvelope<K>, ctx: DepartmentContext): Promise<TaskResult>;  // ohne Zugriff auf andere Abteilungen
  health(ctx: DepartmentContext): Promise<HealthReport>;                        // nur lesend
}
// ctx stellt bereit: db (eingeschränkt), budget.reserve()/settle(), recordModelCall, emitEvent, guard (runtime-guard), clock
```

`ctx` gibt **begrenzte Fähigkeiten** statt eines ungefilterten DB-Handles: je Abteilung lesende Abfragen auf freigegebene Sichten,
schreibend nur das eigene Ergebnis über den Kern (GPT-Review D.1).

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

Transport: Postgres-Tabelle als Warteschlange (kein externer Broker). Zustellung „mindestens einmal“; `idempotency_key` verhindert
doppelte **interne** Verarbeitung (Muster `whatsapp_events.message_id`). Für **externe** Wirkungen (korrigiert nach GPT-06):
1. Zustandsänderung + Ereignis + Outbox-Eintrag in **einer** Transaktion; keine DB-Transaktion über einen Modell-/Anbieteraufruf halten.
2. Lease mit Halter und monotonem Fencing-Zähler; ein abgelaufener Worker mit älterem Zähler kann nichts mehr festschreiben.
3. Anbieter-Idempotenz nutzen, wo vorhanden; sonst Ergebnis `outcome_unknown` und Abgleich (Muster: `provider_usage` planned/succeeded/failed,
   Statusabgleich der Publisher). `outcome_unknown` wird nie automatisch wiederholt und gibt keine Budgetreservierung frei.
4. Heartbeat, Wiederaufnahme, Dead-Letter = manuelle Prüfung mit Eskalation.

## 5. Datenmodell (Skizze, additive Tabellen)

```sql
-- Aufgabenbuch
enterprise_tasks(id, department, task_kind, status /*queued|leased|running|succeeded|failed|outcome_unknown|needs_decision|cancelled|dead*/,
  priority, permission_level, parent_id, plan_id, correlation_id, idempotency_key UNIQUE, input jsonb, output jsonb,
  attempts, max_attempts, lease_holder, lease_until, fencing_token bigint, deadline, created_by /*operator|executive|cron|department*/,
  created_at, updated_at)
enterprise_outbox(id, task_id, kind, payload jsonb, status /*pending|sent|outcome_unknown|failed*/, external_ref, created_at, settled_at)
budget_reservations(id, task_id, department, period, amount_cents, currency,
  status /*reserved|settled|released|disputed*/, settled_amount_cents, created_at, settled_at)   -- harter Budgetwächter (GPT-07)
enterprise_task_events(id, task_id, seq, kind, actor, detail jsonb, created_at)          -- append-only
-- Betreiberentscheidungen (Muster wie content_approval_requests / publish_approvals)
enterprise_decisions(id, task_id, plan_id, level /*L3b|L4*/, subject, options jsonb, recommendation jsonb, fingerprint, version,
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

Wichtig (GPT-07): `model_calls` ist ein **Messprotokoll mit Best-Effort-Speicherung** (Speicherfehler werden verschluckt) und kennt weder
Aufgabe noch Abteilung. Es ist deshalb **kein Budgetwächter** und kein vollständiges Kostenbuch. Harte Grenzen setzt nur
`budget_reservations` vor dem Aufruf; `model_calls` und Anbieterrechnungen dienen dem Abgleich. Ein Aufruf darf nicht doppelt gezählt
werden, wenn er in mehreren Quellen erscheint (Zuordnung über `prediction_id` bzw. `source_ref`). Umsätze werden nicht aus bloßen
Landing-Klicks einzelnen Beiträgen zugerechnet.

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

Abhängigkeitsrichtung (korrigiert nach GPT-02): **Controlling liefert einen lesenden Datenvertrag** (`ControllingSnapshot`, über
`/api/operations` bzw. eine eigene lesende Route) und zeigt ihn zuerst in der vorhandenen 2D-Betriebsübersicht. Das Planetarium
**konsumiert** diesen Vertrag nur; Controlling hängt nie vom Command Center ab.


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
- Prompt-Injection: Rechercheinhalte (Webseiten) sind Daten; Modellausgaben können keine Aufgaben mit Stufe ≥ L3b erzeugen und keine
  Berechtigungen ändern (Validierung im Kern, Test).
- Runtime-Guard sperrt nur auf Vercel-Preview/Development; lokal und in Tests ist alles erlaubt, Sandbox-Isolation ist eine Erklärung des
  Betreibers. Wirkungs-E2E-Tests deshalb nur in einem echt isolierten Testsystem; Entwicklungsprüfungen ohne Produktionszugänge.
- Dauerhafter Audit: jeder Plan, jede Entscheidung und jede Richtlinienprüfung wird versions- und fingerprintgebunden gespeichert.
- Keine Geschäftsdaten im öffentlichen Repo (auch keine Beispielwerte aus Produktion in Tests).

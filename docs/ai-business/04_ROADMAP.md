# 04 – Roadmap (kapazitätsgesteuert, Runde 2)

Stand 18.10.2026, korrigiert nach GPT-02, GPT-08, GPT-12 und dem Betreiberauftrag vom 18.10. (übernimmt `08_KAPAZITAETSGESTEUERTE_KOORDINATION.md`).
**Kein Kalenderplan:** Eine Aufgabe startet, sobald ihre Abhängigkeiten erfüllt sind und ein System Kapazität hat. April 2027 ist nur ein
äußerer Planungshorizont, kein Mindesttermin. Eine belastbare Terminprognose gibt es erst aus gemessenem Durchsatz (nach ca. 5 Paketen).

**Takt:** zunächst zwei manuelle Entwicklungsanstöße täglich durch den Betreiber (morgens, abends). Je Anstoß arbeitet ein System in dieser
Reihenfolge: (1) ihm zugewiesene offene Reviews, (2) eigene Aufgaben mit `changes_requested`, (3) eigene laufende Aufgabe, (4) nächste
startbereite Aufgabe per Lease. Vollautomatische Koordination ist **keine** Voraussetzung; automatisiert wird später nur ein gemessener Engpass.

**Rollen je Aufgabe:** Planer ≠ Implementierer ≠ (unabhängiger) Prüfer, soweit zwei Systeme verfügbar sind. Regel: Das jeweils andere System
plant; der Planer darf prüfen. Kein System gibt eigene Arbeit allein frei; gemergt wird nur durch den Betreiber.

Aufwand: **AP** = Arbeitspaket ≈ eine Aufgabe/ein PR, ca. 1–2 Anstöße. Planungswerte, keine Zusagen.

## 1. Abhängigkeitsgraph (DAG) und Gates

```
                    ┌─► B-02 Migration Aufgabenbuch/Outbox/Reservierungen ─► B-03 Repository+Lease ─► B-05 Budgetwächter ─► B-07 Cron (aus)
 G0 ─► B-01 Plan-   │                                                                                      │
       Vertrag +    ├─► G-01 Affiliate-Adapter (lesend) ──────────────────────────────┐                     ├─► B-08 KI-Planer (Schattenbetrieb) ─► B-09 Berichte/Entscheidungen
       Richtlinien ─┤                                                                 │                     │
                    └─► F-01 Bewertungsraster (rein) ─────────────────► F-03 Recherche-Pilot (Budget) ◄─────┘
 G0 ─► E-05 Kennzahlen-Formeln (rein) ─► E-01 Migration Kostenbuch ─► E-03 Importer ─► E-07 ControllingSnapshot + 2D-Anzeige ─► H Unternehmensebene
                                                                                                                       ▲
                                                                                         G-01 ─────────────────────────┘
```

Keine Kante führt von H zurück zu E (GPT-02 behoben): Controlling liefert den Datenvertrag und zeigt ihn zuerst in der vorhandenen 2D-
Betriebsübersicht; das Planetarium konsumiert ihn nur.

| Gate | Bedeutung | Erfüllt, wenn |
|---|---|---|
| **G0 Architektur** | gemeinsame Architektur freigegeben | A-01 Runde 2 vom GPT geprüft, A-02 von Claude geprüft, Betreiber hat ADR-01, ADR-13, ADR-14 entschieden |
| **G1 Erster Baustein** | Kooperation praktisch nachgewiesen | B-01 und E-05 je mit getrenntem Planer/Implementierer/Prüfer gemergt, CI grün |
| **G2 Kern** | Aufgabenbuch + Budgetwächter | B-02…B-05 gemergt, alles hinter Schaltern aus, Tests für Lease-Ablauf, `outcome_unknown`, Budget erschöpft |
| **G3 Controlling sichtbar** | echte Messwerte oder „unbekannt“ | E-07 in der 2D-Übersicht, keine Zahl ohne Quelle |
| **G4 Messreife** | Wirtschaftlichkeit messbar | Erlös- und Kostenerfassung laufen; Betreiber setzt Verlust-/Erkundungsbudget; **Ausbauentscheidung** für F (voll) und I |
| **G5 Schattenbetrieb** | KI-Planer gegen Betreiberentscheidungen verglichen | Evaluationsfälle bestanden, Kosten je akzeptiertem Plan gemessen |
| **G6 Aktivierung** | Schalter in Production | jede Aktivierung einzeln vom Betreiber freigegeben |

G4 trennt drei Dinge (GPT-Review D.6): **Messreife**, **Verlustbudget** und **Ausbauentscheidung**. Ein kleiner, budgetierter Recherche-
Pilot (F-03) ist schon nach B-05 erlaubt; der volle Scout und neue Geschäftseinheiten erst nach G4.

## 2. Startbereite Aufgaben nach G0 (parallel, ohne gemeinsame Dateien)

| Aufgabe | Planer | Implementierer | Prüfer | Dateien |
|---|---|---|---|---|
| **B-01** Plan-Vertrag + Richtlinien + Register (rein, ohne DB/Route) | Claude Code (`tasks/B-01/task.json`) | GPT Work (Codex) | Claude Code | `lib/enterprise/{registry,policy,plan}.ts`, `tests/enterprise-kernel.test.cjs` |
| **E-05** Kennzahlen-Formeln (rein) | GPT Work | Claude Code | GPT Work | `lib/enterprise/controlling/metrics.ts`, `tests/enterprise-controlling-metrics.test.cjs` |

Fortschritt wird gemessen: abgeschlossene und unabhängig geprüfte Pakete je Woche, Nacharbeitsquote, Durchlaufzeit je PR, Wartezeit auf
Review/Betreiber, blockierte Kapazität, tatsächliche Kosten.

Aktivierung in Production (Schalter) ist nie Teil einer Aufgabe: jede Aktivierung ist eine eigene Betreiberentscheidung.

## 3. Phasen im Detail

### Phase A – Bestandsaufnahme und Architekturprüfung
- **Ziel:** belastbare Ausgangslage, freigegebene Zielarchitektur, entschiedene Grundsatzfragen.
- **Arbeitspakete:** siehe `06_PHASE_A_UMSETZUNGSPLAN.md`. Stand: A-01 in Runde 2, A-02 (GPT-Review) erledigt und von Claude geprüft.
- **Abhängigkeiten:** keine.
- **Verantwortlich:** Claude Code · **Prüfend:** GPT Work (Gegenprüfung der Planung) · Betreiber entscheidet ADRs.
- **Aufwand:** 8 AP (überwiegend Doku/Prüfung), Review 2 AP, Betreiber ca. 2–3 h.
- **Ressourcen:** Lesezugriff Repo; Betreiber-Login für Command-Center-/`model_calls`-Ausgangswerte; GitHub-Einstellungen.
- **Kostenrisiken:** keine Laufzeitkosten.
- **Abnahme:** Planung gemergt (nur Doku); ADR-Liste mit Entscheidungen; GPT-Work-Fähigkeiten in `resources.json` eingetragen.
- **Tests:** keine Codeänderung; CI läuft trotzdem grün.
- **Integration:** reiner Doku-PR.

### Phase B – Executive-Architektur
- **Ziel:** Kern für Aufgaben, Berechtigungen, Budgets, Entscheidungsvorlagen; später Berichte und Intake.
- **Arbeitspakete:**
  - **B-01** Plan-Vertrag (`ExecutivePlan`, 02 §3.3), Richtlinien (Aktion → Stufe L0–L4), statisches Register; reine Funktionen, keine DB, keine Route
    (Spezifikation: `coordination/tasks/B-01/task.json`).
  - B-02 Migration `enterprise_tasks`, `enterprise_task_events`, `enterprise_outbox`, `budget_reservations` (additiv, Nummer reserviert).
  - B-03 Repository: Lease mit Halter + Fencing-Zähler, `SKIP LOCKED`, Idempotenz, Outbox in derselben Transaktion, `outcome_unknown`, Dead-Letter.
  - B-04 Abteilungsvertrag mit begrenzten Fähigkeiten (`ctx`) statt DB-Handle.
  - B-05 Budgetwächter: Reservierung vor Aufruf, Abrechnung danach, unklarer Status hält die Reservierung.
  - B-06 `enterprise_decisions` + Anbindung an das bestehende WhatsApp-Freigabemuster (Nachricht + Fingerprint) – **nur Vorlage**, keine Wirkung.
  - B-07 Cron `/api/cron/executive-cycle` hinter Schalter `EXECUTIVE_ENABLED` (Standard aus), Runtime-Guard.
  - B-08 **KI-Planer** (Modellaufruf → `ExecutivePlan` → Validator), zuerst Schattenbetrieb: Pläne werden gespeichert und dem Betreiber gezeigt, nichts ausgeführt.
  - B-09 Executive-Wochenbericht (Erweiterung `lib/reporting/weekly.ts`), gebündelte Entscheidungsnachricht, Router-Absicht `executive.*` (Hot Files).
- **Abhängigkeiten:** G0; Reihenfolge laut DAG. B-06/B-09 berühren Hot Files → vorher `origin/main` und offene PRs prüfen.
- **Rollen:** je Aufgabe in der Task-Datei; Startwert B-01: Claude plant, Codex implementiert, Claude prüft.
- **Aufwand:** 8 AP, Review 4 AP, Betreiber ca. 3 h.
- **Ressourcen:** PGlite-Tests; keine Zugänge.
- **Kostenrisiken:** Kern ohne Modellaufrufe; B-08 Planer je Zyklus gedeckelt (Budget hart, Schalter aus); B-09 optional 1 Aufruf/Bericht.
- **Abnahme:** Zustandsautomat vollständig getestet (Doppelzustellung, Lease-Ablauf mit Fencing, Abbruch, `outcome_unknown`, Budget erschöpft, Stufe L3b ohne Freigabe → blockiert);
  `ACTIVE_APPROVAL_AUTHORITIES` unverändert (Test); Schalter aus ⇒ keinerlei Wirkung (Test).
- **Tests:** Unit + PGlite; Regression bestehender Freigaben; Zugangsschutz neuer Routen.
- **Integration:** je AP ein PR; Migration zuerst allein.

### Phase C – Gemeinsame Aufgabenverwaltung und Übergabeprotokolle (schlank)
- **Ziel:** genug Protokoll für nachvollziehbare Zusammenarbeit – nicht mehr. Die Koordination ist Mittel, nicht Projekt.
- **Stand:** Struktur `docs/ai-business/coordination/` in Gebrauch (A-01, A-02); Schema Revision 2 mit Rollen, Lease, Wartezuständen,
  Akzeptanzkriterien, Budget, Befundantworten; `decision.schema.json` ergänzt.
- **Arbeitspakete:**
  - C-01 Übergabestruktur Runde 2 freigeben (dieser Draft-PR).
  - C-04 PR-Vorlage `.github/pull_request_template.md` (Task-ID, Planer/Implementierer/Prüfer, Tests, Risiken) – klein, sobald G0 erreicht.
  - C-02/C-03 Validator + CI-Schritt: **zurückgestellt**, bis Koordinationsfehler als Engpass nachgewiesen sind. Bis dahin prüft jedes System
    die Schemas lokal (z. B. `python3 -m jsonschema` oder Node-Skript) und nennt das Ergebnis in `tests[]`.
- **Integration:** `quality.yml` ist eine Hot File → einzelner PR.

### Phase D – Engineering-Orchestrator und Multi-Modell-Zusammenarbeit
- **Ziel:** Claude-Code- und Codex-Agenten arbeiten in getrennten Rollen (Planung, Implementierung, Prüfung) – **ohne** Laufzeit-Agenten in
  Production (K-03). Automatisierung nur für gemessene Engpässe; bis dahin manuelle Anstöße.
- **Arbeitspakete:**
  - D-01 Claude-Code-Routine „Review-Wache“: prüft werktags offene PRs mit Prüfer `claude-code` und hinterlässt Review (nur nach Betreiberfreigabe einrichten).
  - D-02 Prüfen und dokumentieren, welche GPT-Work-Automatisierung real verfügbar ist (Auslösen per Ereignis/Kommentar?) → `resources.json`.
  - D-03 Optional: GitHub-Action für Claude-Reviews (`claude-code-action`) – nur nach Kostenentscheidung (API-Schlüssel als Repo-Secret).
  - D-04 Branch-Schutz/Ruleset für `main` (Betreiber stellt ein; Doku der Einstellung).
  - D-05 Release-Checkliste (Deploy-Nachweis, Production-Aufruf, Statusbegriffe) als Doku + Übergabefeld.
  - D-06 Command-Center-Datenquelle „Entwicklung“: Aufgabenstatus aus den Übergabedateien (zur Buildzeit gelesen, nur Status/ID, keine Inhalte).
  - D-07 Getrennte Reviewer-Identität (GPT-05): eigene GitHub-Identität (Machine User oder App) für mindestens ein System, damit GitHub-Reviews
    mit „Approve“ und eine Merge-Sperre möglich werden. Betreiberentscheidung BF-15.
  - D-08 Eng begrenzter Ereignis-Trigger (z. B. „PR mit Label `review:gpt` geöffnet“) für genau ein System, erst nach BF-06 und mit
    dokumentiertem Testlauf (Trigger-ID, Ereignis, gelesene SHA).
- **Abhängigkeiten:** G1 (Kooperation manuell nachgewiesen); D-07 vor einer technischen Merge-Sperre.
- **Verantwortlich:** je Aufgabe in der Task-Datei · **Prüfend:** jeweils das andere System.
- **Aufwand:** 6 AP, Review 3 AP, Betreiber ca. 2 h.
- **Kostenrisiken:** D-03 verursacht API-Kosten je Review (Betreiberentscheidung); Routinen verbrauchen Abo-Kontingent.
- **Abnahme:** ein PR durchläuft Implementierung → automatische/geplante Prüfung → Betreiber-Merge mit vollständigem Protokoll.
- **Tests:** D-06 Unit-Test (liest nur erlaubte Felder).
- **Integration:** keine Änderung am Laufzeitverhalten der App.

### Phase E – Controlling und Kostenüberwachung
- **Ziel:** echte Kosten- und Erlöszahlen je Abteilung/Agent mit Unterscheidung gemessen/geschätzt/prognostiziert.
- **Arbeitspakete:**
  - E-01 Migration `price_catalog`, `cost_entries`, `revenue_entries`, `budgets` (additiv).
  - E-02 Preiskatalog-Pflege (Betreiber trägt Preise mit Quelle ein; Oberfläche oder Skript; nichts vorbelegt).
  - E-03 Importer: `model_calls` → `cost_entries` (gemessen: Tokens/Sekunden; Betrag nur mit Preis), `provider_usage`, `production_runs` (geschätzt).
  - E-04 Manuelle Belege: Abos/Infrastruktur/Rechnungen; Erlöse (PartnerNet-Export manuell, CSV-Import optional).
  - E-05 Kennzahlenfunktionen (Deckungsbeitrag, ROI, Amortisation; „unbekannt“ bei fehlenden Daten) als reine Funktionen.
  - E-06 Abteilungszuordnung für `model_calls` (Spalte `department` additiv **oder** Zuordnung über `agent` → Abteilung im Register; Empfehlung: Register, keine Schemaänderung).
  - E-07 Datenvertrag `ControllingSnapshot` (lesend, Zod) über `/api/operations` und Anzeige in der **vorhandenen 2D-Betriebsübersicht**.
    Das Planetarium (H) konsumiert diesen Vertrag später nur.
- **Abhängigkeiten:** E-05 startet sofort nach G0 (rein); E-01/E-03 nach Migrationsreservierung; E-06 nach B-01 (Register); E-07 nach E-03.
- **Rollen:** E-05: GPT plant, Claude implementiert, GPT prüft; weitere je Task-Datei.
- **Aufwand:** 7 AP, Review 4 AP, Betreiber ca. 2 h + Pflege der Preise.
- **Kostenrisiken:** keine Laufzeitkosten.
- **Abnahme:** Kosten der letzten 30 Tage je Agent als Tokens/Sekunden; Euro nur mit Preis; keine Zahl ohne Quelle (Test); Importer idempotent;
  keine Doppelzählung desselben Aufrufs aus mehreren Quellen; `model_calls` ausdrücklich als unvollständig gekennzeichnet (GPT-07).
- **Tests:** Formeln mit Grenzfällen (Division durch 0, fehlende Preise, Preiswechsel im Monat), Idempotenz, READ-ONLY-Anzeige.

### Phase F – Opportunity Scout
- **Ziel:** einheitlich bewertete Geschäftschancen mit getrennten Fakten, Annahmen und Prognosen.
- **Voraussetzung:** F-01 nach B-01; F-03-Pilot nach B-05 mit kleinem Erkundungsbudget; voller Scout erst nach G4.
- **Arbeitspakete:**
  - F-01 Bewertungsraster + Gewichte als versionierte Konfiguration (reine Funktionen).
  - F-02 Migration `opportunities`, `opportunity_assessments`.
  - F-03 Recherche-Schritt (bestehender `tavily.ts`, Budget je Lauf), Extraktion per `Generator` (strukturiert, Zod), `recordModelCall`.
  - F-04 Wirtschaftlichkeitsrechnung über Controlling-Funktionen (E-05).
  - F-05 Manueller Auslöser per WhatsApp-Absicht „Geschäftsidee prüfen“ und im Command Center; Ergebnis als Entscheidungsvorlage, nicht als Auftrag.
  - F-06 Optional: wöchentliche Beobachtung definierter Felder (Cron, Schalter aus, Budget hart).
- **Abhängigkeiten:** B-Kern, E-05.
- **Verantwortlich:** GPT Work (F-01, F-04) / Claude Code (F-02, F-03, F-05) · **Prüfend:** jeweils das andere.
- **Aufwand:** 6 AP, Review 3 AP, Betreiber ca. 2 h + Festlegung der Gewichte.
- **Kostenrisiken:** Tavily + Modellaufrufe je Lauf; Monatsbudget hart; Standard: nur manuell.
- **Abnahme:** jede Kennzahl mit Art/Quelle/Konfidenz; fehlende Daten blockieren „Test freigeben“; Prompt-Injection-Test (Webseite fordert Aktion → ignoriert).
- **Tests:** Raster, Grenzfälle, Mock-Recherche, Kostenobergrenze, keine Außenwirkung.

### Phase G – Integration des Affiliate Content Studios
- **Ziel:** bestehendes Studio als erste Abteilung hinter dem Vertrag – **ohne** Verhaltensänderung.
- **Arbeitspakete:**
  - G-01 Adapter `lib/enterprise/departments/affiliate.ts`: `health()` (liest `daily_slot_runs`, `content_jobs`, Freigaben), Kennzahlen.
  - G-02 Aufgabenart `affiliate.status_report` (nur lesend).
  - G-03 Optional später: `affiliate.manual_order` → nutzt den bestehenden `manual-order.ts`-Weg (gleiche Gates).
- **Abhängigkeiten:** B-01 (Vertrag/Register); liest nur Tabellen, berührt keine Pipeline-Dateien.
- **Verantwortlich:** Claude Code · **Prüfend:** GPT Work.
- **Aufwand:** 3 AP, Review 2 AP, Betreiber ca. 1 h.
- **Kostenrisiken:** keine.
- **Abnahme:** vollständige bestehende Testsuite unverändert grün; Adapter ohne Schreibzugriff (Test: READ-ONLY-Transaktion).

### Phase H – Command-Center-Erweiterungen
- **Ziel:** Planetarium-Ebene „Unternehmen“ mit echten Daten oder ausdrücklich „keine Daten“.
- **Arbeitspakete:** H-01 Datenmodell `lib/architecture/enterprise.ts` · H-02 API-Erweiterung (lesend) · H-03 Szene: Planetenebene über bestehender
  Szene · H-04 Detailpanel je Abteilung (Status, Orchestrator, Agenten+Modelle, Aufgaben, Entscheidungen, Fehler, Kosten, Erlöse, Freigaben,
  Entwicklungsfortschritt) · H-05 2D-Fallback und Tastaturbedienung.
- **Abhängigkeiten:** E-07 (Datenvertrag), G-01, optional D-06; vor Beginn `lib/architecture/*` gegen `origin/main` und offene PRs prüfen (Hot Files).
- **Verantwortlich:** Claude Code · **Prüfend:** GPT Work.
- **Aufwand:** 5 AP, Review 3 AP, Betreiber ca. 1,5 h (visuelle Abnahme).
- **Kostenrisiken:** keine.
- **Abnahme:** keine erfundenen Zahlen (Test analog `architecture.test.cjs`), WebGL-Fallback, Werte verlassen den Server nicht.

### Phase I – Weitere Geschäftseinheiten (z. B. Immobilienanalyse)
- **Ziel:** Machbarkeit belegen, bevor eine Abteilung gebaut wird.
- **Arbeitspakete:** I-01 Bewertung „Immobilienanalyse“ als Opportunity mit vollem Raster · I-02 Datenquellen- und Rechtscheckliste (Nutzungsbedingungen,
  Lizenzen, Beratungsabgrenzung, Datenschutz) als Vorlage für den Betreiber · I-03 Nur bei Go: Abteilungsskelett hinter dem Vertrag, Schalter aus.
- **Abhängigkeiten:** F-01, G4.
- **Verantwortlich:** GPT Work (I-01, I-02) · **Prüfend:** Claude Code; I-03 umgekehrt.
- **Aufwand:** 2–4 AP.
- **Kostenrisiken:** Recherchebudget; mögliche Datenlizenzen (Betreiberentscheidung, L4).
- **Abnahme:** Entscheidungsvorlage mit Fakten/Annahmen/Prognosen getrennt; keine Datenbeschaffung ohne Freigabe.

### Phase J – Integrations-, Sicherheits- und End-to-End-Tests
- **Je vertikalem Schritt** (nicht erst am Ende): jede Aufgabe liefert ihre Integrationstests; jedes Review prüft die Liste aus 05, §5.
- **Vor G6 zusätzlich:** J-01 E2E-Szenarien mit PGlite (Betreiberauftrag → Aufgabe → Abteilung → Entscheidungsvorlage → Ablehnung/Freigabe →
  keine Wirkung ohne Freigabe) · J-02 Sicherheitsreview beider Modelle (Zugriff, Guard, Injection, Secrets, öffentliche Routen) · J-03 Kostenobergrenzen
  unter Wiederholungen/Retries · J-04 Lasttest der Aufgabenwarteschlange (parallele Cron-Aufrufe) · J-05 Preview-Lauf nur mit isolierten Ressourcen
  (sonst entfällt er, dokumentiert).
- **Verantwortlich:** beide, über Kreuz · **Abnahme:** keine offenen `blocker`; Aktivierungsplan mit Rückfallweg je Schalter.

## 4. Ressourcen- und Budgetplanung (Entwicklung)

| Ressource | Stand |
|---|---|
| Claude-Code- und GPT-Work-Kontingente, Kontextgrößen, Reset-Zeiten | **unbekannt** (`resources.json` = `null`); nicht unendlich annehmen |
| Anstöße | 2 manuelle Anstöße/Tag durch den Betreiber |
| CI-Minuten (GitHub Actions) | je PR ~15 min; Grenzen nicht geprüft |
| Laufzeitkosten neu | Kern 0 Anbieteraufrufe; Planer/Scout nur mit hartem Budget und Schalter aus |
| Betreiberzeit | Reviews der Architektur, Merges, ADRs, Preise; Bedarf wird gemessen |

Kein starrer Claude/GPT-Anteil. Ist ein Kontingent erschöpft, setzt das System seine Aufgabe auf `waiting_capacity` mit Checkpoint; Reviews
fertiger Arbeit haben Vorrang vor neuer Implementierung. WIP-Startwert: höchstens 2 offene Code-PRs.

# 04 – Roadmap Winter 2026/2027

Zeitraum: **19.10.2026 – 04.04.2027** (24 Wochen). Annahme (Q-01): der Betreiber hat während der Saison etwa 2 Review-/Freigabefenster pro
Woche, über Weihnachten/Neujahr und in Spitzenwochen der Saison weniger. Die Roadmap ist daran ausgerichtet, nicht an der Modellkapazität.

Aufwandsangaben: **AP** = Arbeitspaket ≈ eine Aufgabe/ein PR, umsetzbar in 1–2 Modellsitzungen; **Review** = Prüfaufwand des anderen
Modells; **Betreiber** = geschätzte Prüf-/Entscheidungszeit des Betreibers. Größen sind Planungswerte, keine Zusagen.

## 1. Reihenfolge und Abhängigkeiten

```
A Bestandsaufnahme ──► C Koordination ──► B Executive-Kern ──► G Affiliate als Abteilung ──► H Command Center (Unternehmensebene)
        │                    │                 │    ▲                                          ▲
        │                    └──► D Engineering-Werkzeuge                                       │
        │                                      │    │                                          │
        └──────────────────────────────────────┴──► E Controlling ──► M1 Wirtschaftlichkeit ──► F Opportunity Scout ──► I Weitere Einheiten
                                                                                                                       (Machbarkeit)
J Tests/Sicherheit: begleitend in jeder Phase + Abschluss-E2E (März)
```

Priorität: gemeinsame Infrastruktur (A, C, B-Kern, D) → messbare Wirtschaft (E) → Fachabteilungen (G, F, I) → Darstellung (H, begleitend).
Abweichung von der Buchstabenreihenfolge: **C vor B-Kern**, weil der Koordinationsprozess für jede folgende Aufgabe gebraucht wird;
**E vor F**, weil der Scout die Wirtschaftlichkeitsformeln des Controllings nutzt.

## 2. Zeitplan

| KW | Zeitraum | Phase(n) | Meilenstein |
|---|---|---|---|
| 43–44 | 19.10.–01.11. | **A** | M0: Planung freigegeben, ADRs entschieden |
| 44–46 | 26.10.–15.11. | **C**, B-Spezifikation | M1: Übergabeprotokoll in Gebrauch, erste Aufgabe mit Cross-Review abgeschlossen |
| 47–49 | 16.11.–06.12. | **B-Kern** ∥ **E-Teil 1** | M2: Aufgabenbuch + Berechtigungen getestet (aus); Preiskatalog + Kostenbuch lesend |
| 50–51 | 07.12.–20.12. | **D** ∥ **E-Teil 2** | M3: Controlling-Kachel im Command Center (Messwerte/„unbekannt“) |
| 52–01 | 21.12.–10.01. | Pufferzeit (Saisonspitze angenommen): nur Doku, Tests, Reviews | – |
| 02–03 | 11.01.–24.01. | **G** | M4: Affiliate-Studio meldet Health/Kennzahlen über den Abteilungsvertrag (nur lesend) |
| 03 | bis 24.01. | Entscheidung **Wirtschaftlichkeitsnachweis** | **M5 (Go/No-Go)** für F und I |
| 04–07 | 25.01.–21.02. | **F** ∥ **H** | M6: Opportunity Scout manuell auslösbar; Planetarium-Ebene |
| 08–09 | 22.02.–07.03. | **B-Erweiterung** (Executive-Berichte, gebündelte Entscheidungen) | M7: Wochenbericht des Executive |
| 10–12 | 08.03.–28.03. | **I** (Machbarkeit) ∥ **J-Abschluss** | M8: E2E-/Sicherheitsabnahme |
| 13 | 29.03.–04.04. | Abschlussbericht, Aktivierungsplan | M9: Entscheidungsvorlage zur Aktivierung |

Aktivierung in Production (Schalter) ist **nicht** Teil der Roadmap-Termine: jede Aktivierung ist eine eigene Betreiberentscheidung.

## 3. Phasen im Detail

### Phase A – Bestandsaufnahme und Architekturprüfung
- **Ziel:** belastbare Ausgangslage, freigegebene Zielarchitektur, entschiedene Grundsatzfragen.
- **Arbeitspakete:** siehe `06_PHASE_A_UMSETZUNGSPLAN.md` (A-01 … A-08).
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
  - B-01 Spezifikation (ADR): Abteilungsvertrag, Envelope, Zustandsautomat, Berechtigungstabelle L0–L4.
  - B-02 Migration `enterprise_tasks`, `enterprise_task_events` (additiv, Nummer reserviert) + Repository mit Lease/`SKIP LOCKED`/Idempotenz.
  - B-03 Registry + Vertrag (`lib/enterprise/contract.ts`, `registry.ts`) + Zod-Schemas.
  - B-04 Richtlinien-Engine (Aktion → Stufe; Modellausgaben können keine Stufe ≥ L3 erzeugen).
  - B-05 Budgetwächter (Reservierung/Abrechnung, wiederverwendet `provider_usage`-Muster).
  - B-06 `enterprise_decisions` + Anbindung an das bestehende WhatsApp-Freigabemuster (gebunden an Nachricht + Fingerprint) – **nur Vorlage**, keine Wirkung.
  - B-07 Cron `/api/cron/executive-cycle` hinter Schalter `EXECUTIVE_ENABLED` (Standard aus), Runtime-Guard.
  - B-08 (später, Phase-B-Erweiterung) Executive-Wochenbericht als Erweiterung von `lib/reporting/weekly.ts`; gebündelte Entscheidungsnachricht; Router-Absicht `executive.*`.
- **Abhängigkeiten:** A, C (Prozess). B-06/B-08 berühren Hot Files (Router, Webhook) → nach Abstimmung mit der Video-Sitzung.
- **Verantwortlich:** Claude Code · **Prüfend:** GPT Work.
- **Aufwand:** 8 AP, Review 4 AP, Betreiber ca. 3 h.
- **Ressourcen:** PGlite-Tests; keine Zugänge.
- **Kostenrisiken:** keine (keine Modellaufrufe im Kern); B-08 optional 1 Modellaufruf/Bericht.
- **Abnahme:** Zustandsautomat vollständig getestet (Doppelzustellung, Lease-Ablauf, Abbruch, Budget erschöpft, Stufe L3 ohne Freigabe → blockiert);
  `ACTIVE_APPROVAL_AUTHORITIES` unverändert (Test); Schalter aus ⇒ keinerlei Wirkung (Test).
- **Tests:** Unit + PGlite; Regression bestehender Freigaben; Zugangsschutz neuer Routen.
- **Integration:** je AP ein PR; Migration zuerst allein.

### Phase C – Gemeinsame Aufgabenverwaltung und Übergabeprotokolle
- **Ziel:** Claude Code und GPT Work arbeiten nach einem überprüfbaren Protokoll.
- **Arbeitspakete:**
  - C-01 Übergabestruktur aus diesem Branch freigeben (Schema, Beispiel, Ownership, Ressourcen).
  - C-02 Validator-Skript `scripts/coordination-check.cjs` (Schema, eindeutige IDs, Claims ohne Überschneidung, Hot Files, Migrationsreservierung).
  - C-03 CI-Schritt im bestehenden Workflow (nur prüfend).
  - C-04 PR-Vorlage `.github/pull_request_template.md` (Task-ID, Implementiert/Prüft, Tests, Risiken).
  - C-05 Erster Probelauf: eine kleine echte Aufgabe (z. B. C-02 selbst) mit Implementierer GPT, Prüfer Claude.
- **Abhängigkeiten:** A.
- **Verantwortlich:** GPT Work (C-02, C-03) / Claude Code (C-01, C-04) · **Prüfend:** jeweils das andere.
- **Aufwand:** 5 AP, Review 3 AP, Betreiber ca. 1,5 h.
- **Kostenrisiken:** keine.
- **Abnahme:** Validator in CI aktiv; mindestens eine Aufgabe vollständig mit Übergabedatei, Review-Datei und Merge dokumentiert.
- **Tests:** Validator-Tests (gültige/ungültige Beispiele, Claim-Konflikt).
- **Integration:** `quality.yml` ist eine Hot File → einzelner PR, abgestimmt.

### Phase D – Engineering-Orchestrator und Multi-Modell-Zusammenarbeit
- **Ziel:** wiederholbarer, teilautomatisierter Entwicklungsprozess – **ohne** Laufzeit-Agenten in Production (Kritik K-03).
- **Arbeitspakete:**
  - D-01 Claude-Code-Routine „Review-Wache“: prüft werktags offene PRs mit Prüfer `claude-code` und hinterlässt Review (nur nach Betreiberfreigabe einrichten).
  - D-02 Prüfen und dokumentieren, welche GPT-Work-Automatisierung real verfügbar ist (Auslösen per Ereignis/Kommentar?) → `resources.json`.
  - D-03 Optional: GitHub-Action für Claude-Reviews (`claude-code-action`) – nur nach Kostenentscheidung (API-Schlüssel als Repo-Secret).
  - D-04 Branch-Schutz/Ruleset für `main` (Betreiber stellt ein; Doku der Einstellung).
  - D-05 Release-Checkliste (Deploy-Nachweis, Production-Aufruf, Statusbegriffe) als Doku + Übergabefeld.
  - D-06 Command-Center-Datenquelle „Entwicklung“: Aufgabenstatus aus den Übergabedateien (zur Buildzeit gelesen, nur Status/ID, keine Inhalte).
- **Abhängigkeiten:** C.
- **Verantwortlich:** Claude Code (D-01, D-05, D-06) / GPT Work (D-02) / Betreiber (D-04) · **Prüfend:** jeweils das andere Modell.
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
  - E-07 Command-Center-Kachel und `/api/operations`-Erweiterung (lesend).
- **Abhängigkeiten:** A; B-03 (Register) für E-06; H-Grundlage für E-07.
- **Verantwortlich:** GPT Work (E-03, E-05) / Claude Code (E-01, E-06, E-07) · **Prüfend:** jeweils das andere.
- **Aufwand:** 7 AP, Review 4 AP, Betreiber ca. 2 h + Pflege der Preise.
- **Kostenrisiken:** keine Laufzeitkosten.
- **Abnahme:** Kosten der letzten 30 Tage je Agent als Tokens/Sekunden; Euro nur mit Preis; keine Zahl ohne Quelle (Test); Importer idempotent.
- **Tests:** Formeln mit Grenzfällen (Division durch 0, fehlende Preise, Preiswechsel im Monat), Idempotenz, READ-ONLY-Anzeige.

### Phase F – Opportunity Scout
- **Ziel:** einheitlich bewertete Geschäftschancen mit getrennten Fakten, Annahmen und Prognosen.
- **Voraussetzung:** M5 (Wirtschaftlichkeitsnachweis oder bewusste Betreiberentscheidung).
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
- **Abhängigkeiten:** B-Kern; Abstimmung mit der Video-Sitzung (G berührt keine Pipeline-Dateien, liest nur Tabellen).
- **Verantwortlich:** Claude Code · **Prüfend:** GPT Work.
- **Aufwand:** 3 AP, Review 2 AP, Betreiber ca. 1 h.
- **Kostenrisiken:** keine.
- **Abnahme:** vollständige bestehende Testsuite unverändert grün; Adapter ohne Schreibzugriff (Test: READ-ONLY-Transaktion).

### Phase H – Command-Center-Erweiterungen
- **Ziel:** Planetarium-Ebene „Unternehmen“ mit echten Daten oder ausdrücklich „keine Daten“.
- **Arbeitspakete:** H-01 Datenmodell `lib/architecture/enterprise.ts` · H-02 API-Erweiterung (lesend) · H-03 Szene: Planetenebene über bestehender
  Szene · H-04 Detailpanel je Abteilung (Status, Orchestrator, Agenten+Modelle, Aufgaben, Entscheidungen, Fehler, Kosten, Erlöse, Freigaben,
  Entwicklungsfortschritt) · H-05 2D-Fallback und Tastaturbedienung.
- **Abhängigkeiten:** B-03, E-07, D-06; **Merge der Video-Sitzung** in `lib/architecture/*`.
- **Verantwortlich:** Claude Code · **Prüfend:** GPT Work.
- **Aufwand:** 5 AP, Review 3 AP, Betreiber ca. 1,5 h (visuelle Abnahme).
- **Kostenrisiken:** keine.
- **Abnahme:** keine erfundenen Zahlen (Test analog `architecture.test.cjs`), WebGL-Fallback, Werte verlassen den Server nicht.

### Phase I – Weitere Geschäftseinheiten (z. B. Immobilienanalyse)
- **Ziel:** Machbarkeit belegen, bevor eine Abteilung gebaut wird.
- **Arbeitspakete:** I-01 Bewertung „Immobilienanalyse“ als Opportunity mit vollem Raster · I-02 Datenquellen- und Rechtscheckliste (Nutzungsbedingungen,
  Lizenzen, Beratungsabgrenzung, Datenschutz) als Vorlage für den Betreiber · I-03 Nur bei Go: Abteilungsskelett hinter dem Vertrag, Schalter aus.
- **Abhängigkeiten:** F, M5.
- **Verantwortlich:** GPT Work (I-01, I-02) · **Prüfend:** Claude Code; I-03 umgekehrt.
- **Aufwand:** 2–4 AP.
- **Kostenrisiken:** Recherchebudget; mögliche Datenlizenzen (Betreiberentscheidung, L4).
- **Abnahme:** Entscheidungsvorlage mit Fakten/Annahmen/Prognosen getrennt; keine Datenbeschaffung ohne Freigabe.

### Phase J – Integrations-, Sicherheits- und End-to-End-Tests
- **Begleitend:** jede Phase liefert ihre Tests; jedes Review prüft die Liste aus 05, §5.
- **Abschluss (KW 10–12):** J-01 E2E-Szenarien mit PGlite (Betreiberauftrag → Aufgabe → Abteilung → Entscheidungsvorlage → Ablehnung/Freigabe →
  keine Wirkung ohne Freigabe) · J-02 Sicherheitsreview beider Modelle (Zugriff, Guard, Injection, Secrets, öffentliche Routen) · J-03 Kostenobergrenzen
  unter Wiederholungen/Retries · J-04 Lasttest der Aufgabenwarteschlange (parallele Cron-Aufrufe) · J-05 Preview-Lauf nur mit isolierten Ressourcen
  (sonst entfällt er, dokumentiert).
- **Verantwortlich:** beide, über Kreuz · **Abnahme:** keine offenen `blocker`; Aktivierungsplan mit Rückfallweg je Schalter.

## 4. Ressourcen- und Budgetplanung (Entwicklung)

| Ressource | Bedarf | Stand |
|---|---|---|
| Claude-Code-Kontingent | ca. 35–40 AP + Reviews über 24 Wochen | Limit/Tarif: **offener Parameter** (`resources.json`) |
| GPT-Work-Kontingent | ca. 20–25 AP + Reviews | **offener Parameter** |
| CI-Minuten (GitHub Actions) | je PR ~15 min | öffentliches Repo; Grenzen nicht geprüft |
| Laufzeitkosten neu | Executive 0–1 Aufruf/Bericht; Scout per Budget | Euro erst nach Preiskatalog |
| Betreiberzeit | ca. 15–20 h über den Winter (Reviews, ADRs, Preise, Merges) | Annahme Q-01 |

Verteilung: Claude Code ≈ 60 %, GPT Work ≈ 40 % der Implementierung; Reviews umgekehrt proportional. Wird ein Kontingent knapp, gilt:
Reviews haben Vorrang vor neuen Implementierungen (kein ungeprüfter Code im Stau).

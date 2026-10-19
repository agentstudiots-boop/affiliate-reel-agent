# 06 – Umsetzungsplan Phase A (Bestandsaufnahme und Architekturprüfung)

> Kalenderangaben unten sind die ursprüngliche Planung (Runde 1); maßgeblich ist der Stand und Gate G0.

Zeitraum: KW 43–44 (19.10.–01.11.2026). Keine Codeänderung an der App, keine Migration, keine Schalter, keine kostenpflichtigen Aufrufe.
Jede Aufgabe erhält eine Übergabedatei `docs/ai-business/coordination/tasks/<ID>/task.json` (A-01 liegt als Beispiel bei).

| ID | Aufgabe | Implementiert | Prüft | Ergebnis | Akzeptanzkriterien | Test-/Prüfanforderung |
|---|---|---|---|---|---|---|
| **A-01** | Planungsdokumente erstellen (dieser Branch) | Claude Code | GPT Work | `docs/ai-business/*` | alle 10 erwarteten Ergebnisse abgedeckt (README-Matrix); keine erfundenen Fähigkeiten/Limits; nur neue Dateien | `git diff --stat origin/main` zeigt nur `docs/ai-business/**`; CI grün |
| **A-02** | Gegenprüfung der Planung | GPT Work | Claude Code (Antwort auf Befunde) | `tasks/A-01/review-1.json` + PR-Kommentare | jeder Befund klassifiziert (blocker/major/minor/nit); Blocker beantwortet | Review-Datei valide gegen `review.schema.json` |
| **A-03** | GPT-Work-Fähigkeiten feststellen: Push, PR, Review, Auslöser, Kontextgröße, Komprimierung, Tarifgrenzen | Betreiber + GPT Work | Claude Code | `coordination/resources.json` ergänzt | jedes Feld entweder belegt (Quelle) oder `null` mit Begründung | Plausibilitätsprüfung durch Claude; kein Wert ohne Quelle |
| **A-04** | Konfliktkarte mit der parallelen Video-Sitzung: deren Branch, Dateien, geplante Migrationen | Claude Code | GPT Work | `ownership.json` → `parallel_sessions`, Migrationsreservierung | keine Überschneidung der Claims; nächste Migrationsnummer reserviert | Abgleich `git diff --name-only` des Video-Branches gegen Claims |
| **A-05** | Ausgangswerte erheben: `model_calls` (7/30 Tage), Command-Center-Steckbriefe, vorhandene `performance_observations` | Betreiber (Login) | Claude Code | Kurzprotokoll **außerhalb des Repos** (öffentlich!) oder nur aggregiert ohne Geschäftszahlen | Basislinie für Controlling vorhanden oder „keine Daten“ festgestellt | – |
| **A-06** | Architekturentscheidungen (ADR-01 … ADR-12, siehe 07) mit dem Betreiber klären | Claude Code (Vorlage) | GPT Work | `tasks/A-06/decision.json` (Betreiber) | jede ADR: angenommen / abgelehnt / vertagt | Schema-Validierung |
| **A-07** | Externe Rahmenbedingungen prüfen: Vercel-Hobby-Bedingungen für kommerzielle Nutzung, Cron-/Laufzeitgrenzen, Branch-Schutz-Optionen | GPT Work | Claude Code | Abschnitt in `07` aktualisiert, mit Quellen-URLs | jede Aussage mit Quelle und Abrufdatum | Quellen erreichbar |
| **A-08** | Phase-B/C-Feinplanung: Aufgabendateien B-01…B-07, C-01…C-05 anlegen (Status `planned`, Claims, Prüfer) | Claude Code | GPT Work | `coordination/tasks/*/task.json` | Claims überschneidungsfrei; Abhängigkeiten gesetzt | Schema-Validierung (manuell bis C-02) |

## Stand nach Runde 2 (18.10.2026)

| ID | Stand |
|---|---|
| A-01 | Runde 2 umgesetzt (Draft-PR, Prüfer GPT Work) – Antworten auf GPT-01…12 in `tasks/A-01/task.json` |
| A-02 | erledigt durch GPT Work (PR #81); von Claude geprüft: `tasks/A-02/review-1.json` (approve mit Nits) |
| A-03 | weitgehend erledigt durch A-02 (`resources.json`); Tarife/Limits bleiben `null` |
| A-04 | erledigt: Video-Sitzung gemergt (PR #78–#80), letzte Migration 038 (`ownership.json`) |
| A-05 | offen (Betreiber-Login); **kein** Blocker für B-01/E-05 |
| A-06 | offen: ADR-01, ADR-13 … ADR-16 (= BF-16) |
| A-07 | teilweise (Vercel-Hobby-Quelle in 09); Entscheidung BF-14 |
| A-08 | ersetzt: statt aller B-/C-Aufgabendateien nur die startbereite `tasks/B-01/task.json`; E-05 plant GPT Work |

Phase A endet mit **Gate G0** (04 §1). Danach sofort Code: B-01 und E-05 parallel. Keine weitere Planungsrunde vor dem ersten Baustein.

## Reihenfolge

```
A-01 ──► A-02 ──► A-06 ──► A-08
  └────► A-03 ─┐
  └────► A-04 ─┼──► A-08
  └────► A-05 ─┤
  └────► A-07 ─┘
```

A-03, A-04, A-05, A-07 laufen parallel zu A-02.

## Definition of Done Phase A (= Gate G0)

Maßgeblich ist allein die Definition von **G0 in `04_ROADMAP.md` §1** (GPT-R2-01). Kurzfassung ohne eigene Abweichung: jüngstes GPT-Review
von A-01 ohne offene blocker/major, A-02 geprüft (erledigt), BF-16 entschieden (ADR-01, ADR-13 … ADR-16), PR #81 und #82 gemergt.
Zusätzlich gilt: `resources.json` und `ownership.json` enthalten nur belegte Werte oder `null`. Ein Verweis in `docs/PROJECT_STATUS.md`
folgt als eigener kleiner PR.

## Was in Phase A ausdrücklich nicht passiert

Keine neuen Agenten, kein `lib/enterprise/`-Code, keine Migration, keine Änderung an `lib/architecture/*`, keine Schalter, keine Secrets,
kein Branch-Schutz-Umbau ohne Betreiber, kein Merge.

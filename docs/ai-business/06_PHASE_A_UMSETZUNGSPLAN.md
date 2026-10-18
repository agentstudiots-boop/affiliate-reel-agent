# 06 – Umsetzungsplan Phase A (Bestandsaufnahme und Architekturprüfung)

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

## Reihenfolge

```
A-01 ──► A-02 ──► A-06 ──► A-08
  └────► A-03 ─┐
  └────► A-04 ─┼──► A-08
  └────► A-05 ─┤
  └────► A-07 ─┘
```

A-03, A-04, A-05, A-07 laufen parallel zu A-02.

## Definition of Done Phase A (Meilenstein M0)

1. Betreiber hat diesen Bericht geprüft und die Planung freigegeben (oder Änderungen verlangt → neue Fassung).
2. GPT-Work-Review liegt vor; alle `blocker` sind beantwortet.
3. ADR-01 … ADR-12 entschieden oder bewusst vertagt.
4. `resources.json` und `ownership.json` enthalten nur belegte Werte oder `null`.
5. Planungs-PR (nur Doku) ist vom Betreiber gemergt; erst danach ein Verweis in `docs/PROJECT_STATUS.md` (eigener kleiner PR, abgestimmt mit der Video-Sitzung).

## Was in Phase A ausdrücklich nicht passiert

Keine neuen Agenten, kein `lib/enterprise/`-Code, keine Migration, keine Änderung an `lib/architecture/*`, keine Schalter, keine Secrets,
kein Branch-Schutz-Umbau ohne Betreiber, kein Merge.

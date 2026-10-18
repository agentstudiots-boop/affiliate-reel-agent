# Koordination Claude Code ↔ GPT Work

Maschinenlesbare Übergabestruktur (Konzept: `../05_ENTWICKLUNGSORGANISATION.md` §6–§8). Während der Planungsphase liegt sie unter
`docs/ai-business/coordination/`; ein Umzug auf Repo-Ebene ist eine spätere Entscheidung.

**Öffentliches Repository:** keine Geschäftsdaten, Finanzzahlen, Chancenbewertungen, Secrets oder personenbezogenen Daten in diese Dateien.

| Datei | Inhalt | Schreibrecht |
|---|---|---|
| `ownership.json` | Modulbesitz, Hot Files, gesperrte Bereiche, Migrationsreservierungen, Parallelsitzungen | per Koordinations-PR, Prüfung durch das andere System |
| `resources.json` | Kontingente, Kontextgrößen, Fähigkeiten, Checkpoint-Schwellen; `null` = unbekannt | Betreiber / mit Quelle |
| `schema/task.schema.json` | Aufbau einer Aufgabendatei inkl. Checkpoint (`session`) und Änderungsprotokoll (`log`) | – |
| `schema/review.schema.json` | Aufbau eines Review-Ergebnisses | – |
| `tasks/<ID>/task.json` | Stand der Aufgabe | **nur** implementierendes System |
| `tasks/<ID>/review-<n>.json` | Review-Runde n | **nur** prüfendes System |
| `tasks/<ID>/decision.json` | Betreiberentscheidung | **nur** Betreiber |

Regeln gegen veraltete Zustände: vor dem Schreiben `git fetch`; ist `revision` auf dem Remote höher als gelesen, neu lesen statt überschreiben;
`revision` bei jeder Änderung +1; `log[]` nur anhängen. Validierung gegen die Schemas erfolgt ab Aufgabe C-02 automatisch in CI.


## Betreiberbeschluss vom 18.10.2026: gemeinsamer Austausch auch im normalen ChatGPT-Chat

Neben **Claude Code** und **ChatGPT Work** darf auch **ChatGPT im normalen Chat** über die verbundene GitHub-Schnittstelle Architekturentscheidungen, Koordinationsnotizen und Übergaben auf dem Entwicklungsbranch dokumentieren, soweit die jeweils benötigte Schreibberechtigung tatsächlich vorhanden ist. Der normale Chat ist damit ein **dritter Kommunikations- und Dokumentationsbeteiligter**, aber kein automatisch dauerhaft laufender Entwicklungsprozess. Ein normaler Chat-Auftrag startet keine Sitzung des anderen Systems.

**Gemeinsame Quelle:** Diese bestehende `coordination/`-Struktur dient allen drei Beteiligten; kein paralleles Übergabesystem anlegen. ChatGPT im normalen Chat kann mit dem Betreiber Entscheidungen besprechen und sie als datierte Notiz hier dokumentieren oder, für aufgabenspezifische Inhalte, über den jeweils zuständigen Implementierer/Prüfer in den dafür vorgesehenen Task- und Review-Dateien einbringen. Die bestehenden exklusiven Schreibzuständigkeiten bleiben unverändert: `task.json` nur Implementierer, `review-<n>.json` nur Prüfer, `decision.json` nur Betreiber. Ein Chat-Eintrag in dieser README ersetzt keine formale Betreiberentscheidung in einer aufgabenspezifischen `decision.json`.

**Nachvollziehbarkeit und Konfliktschutz:** Vor jeder Änderung den aktuellen Remote-Dateistand erneut lesen, Änderungen mit eindeutigem Commit dokumentieren, keine konkurrierenden Schreibvorgänge blind überschreiben. Für Code und konfliktträchtige Koordinationsänderungen eigene Arbeitsbranches/PRs mit gegenseitiger Prüfung nutzen; keine Direktänderung an `main`, kein eigenständiger Merge in Production. Für Dokumentation auf dem separaten Architektur-Branch weiterhin den parallel arbeitenden GPT-Work-/Claude-Code-Stand beachten. Bei Konflikten zuerst abstimmen statt überschreiben.

**Rollen im geplanten KI-Unternehmen (Architektur-Leitlinie, noch keine implementierten Agenten):**
- Opportunity Scout ermittelt Vorschläge; Controlling prüft Wirtschaftlichkeit und Risiken.
- Executive priorisiert und koordiniert auf **Unternehmensebene** (Budgets, Abteilungen, Betreiberentscheidungen), nicht als technischer Roadmap-Autor und nicht als Alias des Affiliate-Jarvis.
- Eine von der Implementierung getrennte Architektur-/Planungsrolle erstellt pro genehmigtem Vorhaben die technische Roadmap mit Arbeitspaketen, Schnittstellen, Akzeptanzkriterien und Tests.
- Die Engineering-Implementierungsrolle programmiert anhand der Roadmap; ein anderes Modell führt das unabhängige Review durch. Claude Code und GPT/Codex können Planer, Implementierer und Prüfer aufgabenabhängig übernehmen; die Rollen werden je Task explizit festgelegt.
- Engineering soll später gezielt berechtigten GitHub-/Vercel-Zugriff erhalten. Produktive Eingriffe, neue Kosten und Secrets benötigen definierte Freigabe- und Sicherheitsregeln. API-Zugriffe sind ein Architekturziel, kein Nachweis bereits eingerichteter Agenten.
- Für die erste Entwicklungsphase ist ein **manueller Start morgens und abends** durch den Betreiber akzeptiert; automatische 24/7-Neustarts bzw. Token-Kapazitätssteuerung sind keine Voraussetzung für den Beginn der eigentlichen Entwicklung und erst nach echtem Nachweis als funktionsfähig zu dokumentieren.

**Status:** Dies dokumentiert die im Betreiber-Chat vereinbarten Architektur- und Koordinationsgrundsätze. Eine unabhängig überprüfte technische Implementierung oder ein End-to-End-Kooperationstest wird dadurch nicht behauptet.

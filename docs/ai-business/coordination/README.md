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

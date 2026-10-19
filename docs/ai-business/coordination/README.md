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
| `schema/decision.schema.json` | Betreiberentscheidung mit nachprüfbarer Quelle | – |
| `tasks/<ID>/task.json` | Stand der Aufgabe (Rollen, Kriterien, Budget, Lease, Wartezustand, Befundantworten) | Planer bis zum Lease, danach **nur** implementierendes System |
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

## Betreiberbeschluss vom 18.10.2026: Vorschläge kritisch und modellübergreifend prüfen

**Geltungsbereich:** Diese Regel gilt für die **Entwicklung der KI-Unternehmensarchitektur selbst** ebenso wie später für neue Geschäftsbereiche und Softwareprojekte. Ideen, Vermutungen und Fragen des Betreibers sind **Prüfhypothesen, keine automatisch freigegebenen technischen Vorgaben**. Auch die im Chat diskutierte mögliche Kombination aus Planungsrolle und zwei Engineering-Modellen (z. B. Claude/Opus und GPT/Codex) ist eine zu bewertende Option, keine beschlossene Verdopplung der Infrastruktur oder dauerhafte Modellbindung.

**Verfahren in der bestehenden Koordination (kein zweites System):**
1. Der normale ChatGPT-Chat bespricht die Idee mit dem Betreiber, prüft offensichtliche technische, wirtschaftliche und logische Schwächen und hält sie als datierten **Vorschlag mit vorläufiger Bewertung** in der bestehenden `docs/ai-business/coordination/`-Dokumentation fest. Fakten, Annahmen, Risiken und offene Fragen sind zu trennen.
2. **GPT Work/Codex und Claude Code** bewerten denselben Vorschlag jeweils unabhängig anhand der aktuellen Roadmap **und des realen Codes**. Sie ergänzen ihre Begründungen, Alternativen, Auswirkungen auf Komplexität, Stabilität, Kosten, Wartung, Sicherheit sowie prüfbare Erfolgskriterien in den vorhandenen Task-/Review- oder PR-Unterlagen. Keine bloße Zustimmung wegen des Betreiberwunsches oder der Position des anderen Modells.
3. Abweichende Einschätzungen werden transparent gegenübergestellt. Nur begründete, nachvollziehbare Änderungen gehen als Empfehlung in die bestehende Roadmap ein; grundlegende Zielkonflikte und Betreiberentscheidungen werden dem Betreiber vorgelegt. Die bestehenden Schreibrechte für `task.json`, `review-<n>.json` und `decision.json` bleiben bestehen; eine README-Notiz ist **keine** formale aufgabenspezifische Freigabe.
4. Die Abstimmung erfolgt asynchron über dieselben GitHub-Branches, PRs und Übergabedateien. Ein GitHub-Eintrag **startet keine Claude-Code- oder GPT-Work-Sitzung automatisch**. Es gibt keine Zusicherung autonomer Überwachung oder unmittelbarer Rückantwort.

**Konkreter aktueller Prüfpunkt:** Ist ein gemeinsames Engineering-System mit getrennten Rollen für technische Planung, Implementierung und unabhängiges Review besser als zwei eigenständige Engineering-Systeme? Modelle/Rollen sollten austauschbar bleiben. Entscheidung anhand von Testaufwand, Berechtigungsgrenzen, Parallelisierbarkeit, Qualität, Betriebs- und Tokenkosten treffen; zunächst offen lassen.

## Betreiberbeschluss vom 18.10.2026: keine zusätzlichen KI-Credits

**Verbindliche Kostengrenze für die Entwicklungskoordination:** Der Betreiber kauft für ChatGPT Work/Codex oder Claude Code **keine zusätzlichen Credits, Aufladungen oder nutzungsabhängigen Zusatzkontingente**. Entwicklungsplanung, Implementierung und Reviews müssen innerhalb der bereits bezahlten Abonnements und ihrer tatsächlich verfügbaren Inklusivkontingente erfolgen. Neue kostenpflichtige Tarife oder Upgrades sind dadurch **nicht** genehmigt. Diese Regel betrifft KI-Entwicklungs-Credits; andere laufende Infrastrukturkosten werden hierdurch nicht neu freigegeben.

**Für GPT Work/Codex und Claude Code (Opus) gleichermaßen lesbare Arbeitsregel:**
- Vor größeren Arbeitspaketen Kapazität und Aufwand einschätzen, kritische Aufgaben priorisieren und möglichst kleine, testbare Pakete wählen. Keine Annahme unbegrenzter Modellkapazität.
- Bei Credits-/Sitzungslimits keine kostenpflichtige Umgehung. Fortschritt, Commit/Branch, offene Fragen, nächste konkrete Aktion und den Grund des Stopps in den vorhandenen, rollenberechtigten Übergabedateien sichern. Wenn der Reset-Zeitpunkt unbekannt ist, ausdrücklich **unbekannt** vermerken.
- Aufgaben bis zur nächsten regulären Verfügbarkeit auf Warten stellen; nur bereits autorisierte, verfügbare Modelle können andere geeignete Aufgaben übernehmen, ohne unabhängige Prüfung und Ownership-Regeln zu umgehen.
- Zwei manuelle Anstöße pro Tag sind eine **Oberflächenroutine, keine Garantie gleichzeitiger Verfügbarkeit** beider Systeme. Eine GitHub-Übergabe startet keine weitere Session automatisch.
- Verbrauch je Arbeitspaket nur erfassen, soweit belastbare Nutzungswerte vorliegen; fehlende Credit-Daten nicht schätzen oder als gemessen ausgeben. Prozessaufwand reduzieren, bevor zusätzliche Koordinationsautomatisierung vorgeschlagen wird.

**Aktuelle Auswirkung:** Die unabhängige GPT-Work-Gegenprüfung von Draft-PR #82 bleibt bei aufgebrauchtem Work-Guthaben ausstehend. Keine Freigabe oder Merge allein wegen bestandener CI. Claudes Sitzungslimit ist ebenfalls zu beachten; keine unbestätigte Wiederaufnahme behaupten.

## Runde 2 (18.10.2026, A-01): was sich an der bestehenden Struktur ändert

Keine neue Struktur, nur Ergänzungen dieser Dateien (Begründung: `../07_OFFENE_FRAGEN_RISIKEN_ENTSCHEIDUNGEN.md` §0):
- `task.schema.json` Revision 2 (additiv, alte Instanzen bleiben gültig): `planner`, Wartezustände (`waiting_capacity`, `waiting_review`,
  `waiting_operator`), `lease` mit `generation`, `waiting`, `acceptance_criteria`, `test_requirements`, `budget`, `claims.foreign_paths`,
  `responses_to_review`; Teilnehmer `chatgpt-chat`.
- Neu `decision.schema.json`. Eine von einem Modell eingetragene Entscheidung gilt nur mit nachprüfbarer Quelle.
- **Zustands-Commits (ADR-13, kooperatives Lease-Protokoll laut `05` §6 – nicht technisch erzwungen):** Lease, Status, Checkpoint und eigene review-/decision-Dateien dürfen als kleiner Fast-Forward-Commit
  direkt auf `architecture/ai-business-roadmap` geschrieben werden (Connector: `expected_sha`). Abgelehnter Push = neu lesen. Inhaltliche
  Änderungen (Architektur, Schemas, Regeln) weiter per PR mit Review des anderen Systems.
- Prüfen lokal z. B. mit `python3` + `jsonschema` (Draft 2020-12). Ein CI-Validator folgt erst bei nachgewiesenem Bedarf.

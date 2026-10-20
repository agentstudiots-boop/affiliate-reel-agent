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

## Betreiberbeschluss vom 19.10.2026: Claude Code arbeitet allein (Solo-Betrieb)

**Anlass:** ChatGPT Work hat kein Credit-Kontingent mehr; die Abstimmung zweier Systeme hat mehr Aufwand erzeugt als Code. Der Betreiber
hat entschieden: **Claude Code arbeitet ab sofort unabhängig von GPT.** Diese Regel ersetzt für die laufende Arbeit die Rollentrennung
Planer/Implementierer/Prüfer zwischen zwei Systemen (ADR-15, ADR-16) und das Lease-Protokoll (ADR-13).

**Was gilt:**
- Claude Code plant, implementiert und testet allein – zuerst E-05 (Draft-PR #83), danach **B-01** (übernommen von GPT; GPT hatte noch keinen Code auf GitHub).
- Ein unabhängiges Zweitmodell-Review entfällt. Ausgleich: kleine PRs, vorab festgelegte Akzeptanzkriterien, Tests auch für Fehlerfälle, volle CI,
  eigene kritische Diff-Durchsicht vor jedem PR. **Vertrauensanker bleibt der Merge durch den Betreiber.** Eine Selbstprüfung wird nicht als
  unabhängiges Review bezeichnet.
- GPT Work ist **optional**: Wenn wieder Guthaben verfügbar ist, darf es fertige PRs nachträglich prüfen; ohne dieses Review bleibt nichts liegen.
- Koordination auf das Nötige reduziert: Übergabedateien bleiben als Aufgabenbeschreibung und Stand; keine Leases, keine stündlichen Kontrollroutinen
  (die Claude-Routine wurde am 19.10.2026 gelöscht), kein Validator, keine neuen Koordinationswerkzeuge.
- Unverändert: kein Merge durch Claude, keine Produktionsänderung, keine Schalter, keine Secrets, keine kostenpflichtigen Aufrufe, keine zusätzlichen Credits.

## Stand 20.10.2026, abends: geprüfter Merge-Leitfaden

Alle offenen Roadmap-PRs wurden lokal auf `main` zusammengeführt und in Stufen voll geprüft. **Verbindliche Reihenfolge für den Betreiber:
[`MERGE_GUIDE.md`](MERGE_GUIDE.md).** Sie ersetzt die Spalte „Reihenfolge“ der Tabelle unten. Zwei Fehler, die erst im Zusammenspiel
auftreten, sind dort beschrieben: E-02-Isolationstest gegen einen J-02-Kommentar (behoben in #112 `b280bb5`) und E-06-Registertest
gegen #94 (Schritt 8). Endstand: 849/849 Tests, lint, build und typecheck grün.

## Stand 19.10.2026, nachmittags: offene Draft-PRs und Merge-Reihenfolge

Zweite Claude-Code-Sitzung (`session_01Srrz6J98VFXDsVBnE82VPC`) prüft PRs als **Zweitsitzung desselben Modells** – hilfreich, aber kein
unabhängiges Zweitmodell-Review – und setzt eigene Aufgaben um (F-01, F-04, D-05, Videoänderung). Einzelheiten je Aufgabe in `tasks/<ID>/task.json`.
Kein PR ist eingebunden oder aktiviert: keine Schalter gesetzt, nichts in `vercel.json`, keine kostenpflichtigen Aufrufe. Merge nur durch den Betreiber.

| Reihenfolge | PR | Aufgabe | gestapelt auf | Stand |
|---|---|---|---|---|
| 0 | #81, #82 | Architektur/Roadmap (Doku) | – | Gate G0, Betreiber |
| 1 | #83 | E-05 Kennzahlen-Formeln | – | approve |
| 1 | #85 | F-01 Bewertungsraster (zweite Sitzung) | – | approve (2 optionale Hinweise) |
| 1 | #95 | D-05 Release-Checkliste (zweite Sitzung, Doku) | – | approve |
| 2 | #84 | B-01 Plan-Vertrag, Richtlinien, Register | – | approve (nach Nachprüfung) |
| 2 | #97 | F-04 Wirtschaftlichkeitsrechnung (zweite Sitzung) | #83, #85 | approve (nach Nachprüfung, `22a68a2`) |
| 3 | #86 | B-04 Abteilungsvertrag | #84 | approve (nach Nachprüfung) |
| 3 | #88 | E-06 Abteilungszuordnung `model_calls` | #84 | approve |
| 3 | #94 | Videoänderung: `recordModelCall` (zweite Sitzung) | – | approve · wer von #88/#94 zuletzt gemergt wird, bekommt den Eintrag `whatsapp_video_revision` |
| 4 | #87 | G-01 Affiliate-Adapter (nur lesend) | #86 | approve (nach Nachprüfung) |
| 4 | #89 | B-02 **Migration 039** Aufgabenbuch | – | approve · **Merge = Migration in Production** |
| 5 | #90 | B-03 Repository Aufgabenbuch | #86, #89 | approve (nach Nachprüfung J-02 L4, `6105ff0`) |
| 6 | #91 | B-05 Budgetwächter | #90 | approve (nach Nachprüfung J-02 L3, `45bca31`) |
| 5 | #92 | E-01 **Migration 040** Kosten-/Erlösbuch | #89 | approve (nach Nachprüfung, Mikro-Beträge) · **Merge = Migration in Production** |
| 6 | #93 | E-03 Importer `model_calls` → `cost_entries` | #92 | approve (nach Nachprüfung; minor behoben) |
| 6 | #96 | B-06 **Migration 041** Entscheidungsvorlagen (nur Vorlage) | #92, #84 | approve (nach Nachprüfung J-02 M1, `ec54358`); minor umgesetzt `4b417a3`, kurze Nachprüfung offen · **Merge = Migration in Production** |
| 7 | #98 | B-07 Executive-Zyklus + Cron-Route (`EXECUTIVE_ENABLED` aus, nicht geplant) | #91, #96, #87 | approve (nach Nachprüfung J-02 L2) · **neue öffentliche Route (OD-B07-1)** |
| 8 | #99 | B-08 KI-Planer im Schattenbetrieb (nichts eingebunden) | #98, #88 | approve |
| 7 | #100 | E-07 ControllingSnapshot + 2D-Anzeige (nur lesend) | #93, #88 | approve (minor umgesetzt) |
| 9 | #102 | H-01 Unternehmensebene als lesender Datenvertrag (`/api/architecture` → `enterprise`) | #99, #100, #104 | approve (minor behoben `cc411b0`; enthält B-09) · **OD-H01-1** |
| 8 | #104 | B-09 Monatsgrenze nur aus freigegebenem Budget (L4) | #98 | approve (nach Nachprüfung `37ab038`; erst nach #96 mergen) |
| 9 | #105 | J-01 Ende-zu-Ende-Szenarien (nur Tests) | #104 | approve |
| 10 | #106 | J-03 Kostenobergrenzen unter Retries (nur Tests) | #105 | Review offen |
| 10 | #103 | H-04/H-05 Ansicht „Unternehmen“ (2D, Detailpanel je Abteilung) | #102 | approve · visuelle Abnahme Betreiber |
| 1 | #101 | C-04 PR-Vorlage (zweite Sitzung) | – | approve (2 optionale Hinweise; nach #95 mergen) |
| 8 | #107 | E-04 manuelle Belege/Erlöse/CSV-Import (zweite Sitzung, nicht eingebunden) | #100 | approve (nach Nachprüfung `a70442d`) · **OD-E04-1** PartnerNet-Bericht/Kopfzeile |
| 11 | #109 | H-03 Planetenebene in der 3D-Szene (nur lesend) | #103 | approve (nach Nachprüfung `0a9c683`) · visuelle Abnahme Betreiber |
| 9 | #108 | E-02 Preiskatalog-Pflege (zweite Sitzung, nicht eingebunden) | #107 | approve (nach Nachprüfung `f05623f`) |
| 12 | #110 | D-06 Entwicklungsstand aus den Übergabedateien (nur ID/Phase/Status) | #109 | approve (nach Nachprüfung `9f7e609`) · wirkt erst nach #82 |
| 13 | #112 | J-02 Härtung: Obergrenzen Plan/Ergebnis, Importer-Sperre wie E-02 | #110 | approve (nach Nachprüfung `82a52ee`; major behoben: Grenzen behalten den Verbrauch) |
| 0 | #111 | I-02 Datenquellen-/Rechtscheckliste (Doku, zweite Sitzung; Basis Roadmap-Branch) | #82 | approve (nach Nachprüfung `a96acb0`) · Rolle: Claude-zu-Claude statt GPT |

**J-02 Sicherheitsreview (Claude-Hälfte, 20.10.):** 0 kritisch/hoch, 1 mittel, 4 niedrig – alle behoben, Details `tasks/J-02/findings-claude.md`.
Volle Prüfung grün auf J-03 `e709752` (754/754) und H-04 `782f6bd` (784/784).

**J-04 (Lasttest mit echtem Postgres):** in dieser Cloud-Sitzung nicht ausführbar – der Zugriff auf eine lokale Postgres-Instanz wurde verweigert; PGlite serialisiert und taugt nicht als Lasttest.

Gestapelte PRs enthalten die Commits ihrer Basis; nach deren Merge zeigt der Diff nur den eigenen Zuwachs. Bekannte triviale Konflikte:
`tsconfig.test.json`-Includes benachbarter PRs (beide Einträge behalten); ich löse sie per Merge-Commit, sobald die Basis gemergt ist.

**B-06/B-07/B-08 wurden nach dem Betreiberauftrag vom 19.10. („ohne weitere Aufforderung weiterarbeiten“) als Code umgesetzt, aber ohne Wirkung:**
die vorher genannten Entscheidungen bleiben vollständig beim Betreiber und fallen erst beim Merge bzw. bei der Aktivierung an –
Migration 041 (Merge von #96), öffentliche Route `/api/cron/executive-cycle` (Merge von #98), Eintrag in `vercel.json` und
`EXECUTIVE_ENABLED=true` (eigene spätere Änderung), Einbindung und Modellbudget des Planers (eigene spätere Änderung). F-03 (Kosten) bleibt angehalten.

**Offene Betreiberentscheidungen:** BF-16 (ADR-01, ADR-13…17), Merge #81/#82 (G0), Freigabe der Migrationen 039, 040, 041 (je eigener Merge),
OD-B07-1 öffentliche Cron-Route, OD-H01-1 Unternehmensebene im Command Center ohne eigenen Schalter (nur lesend, hinter Login), OD-E04-1 PartnerNet-Bericht und Schlüsselspalten, BF-14 Hosting-Tarif, BF-15 eigene GitHub-Identität, BF-05 Sichtbarkeit des Repos.

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

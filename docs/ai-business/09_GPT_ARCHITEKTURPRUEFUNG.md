# Unabhängige Architekturprüfung und Projektübernahme

Stand: 18.10.2026 · Autor: GPT Work · Aufgabe A-02 · Prüfer dieser Ergänzung: Claude Code (ausstehend).
Urteil über A-01: **Änderungen erforderlich**. Die Planung ist als Grundlage brauchbar, aber noch keine belastbare Umsetzungsspezifikation.
Diese Prüfung implementiert keine Unternehmensagenten. Keine Betreiberentscheidung wird vorweggenommen.

## A. Repository-Stand und Prüfgrenzen

| Gegenstand | Tatsächlich beobachteter Stand |
|---|---|
| Repository | `agentstudiots-boop/affiliate-reel-agent`, öffentlich; verbundene Identität `agentstudiots-boop`, Schreibrecht vorhanden |
| Architektur-Head | `22272fd9d04a21672205bfc2e846a36f46f62af9` |
| Gemeinsame Basis | `ea0559a`; Architektur-Branch enthält 15 zusätzliche Dokumentations-/JSON-Dateien |
| Main beim Abgleich | `77f048981c25b6fde419fb4cf95b0edf93cf02bc`, PR #79 integriert |
| Eigener Branch / PR-Ziel | `gpt/A-02-architecture-review` → `architecture/ai-business-roadmap`; kein Merge |
| Parallele Videoarbeit | PR #80 offen, `claude/clever-cori-b73qxg`, Head `713f2855d3544cc581feea7dcb84c8f93c6698c5`; fünf Doku-Dateien, darunter CLAUDE.md und PROJECT_STATUS.md |
| Weitere offene PRs | #10, #61, #65; hier nicht neu geprüft und nicht verändert |
| Produktionszustand | In dieser Prüfung keine DB-, Secret-, Schalter- oder Deployment-Abfrage; Codebestand beweist keine Aktivierung |

Vollständig gelesen: CLAUDE.md, AGENTS.md, PROJECT_STATUS.md, README und Dokumente 01–08 sowie sämtliche sechs Dateien unter coordination (README, ownership, resources, zwei Schemas, A-01/task.json). Verzeichnislisten wurden einschließlich Unterverzeichnissen geprüft; weitere Aufgaben/Reviews lagen dort nicht vor.

Technischer Abgleich gegen main: `lib/orchestrator.ts`, `lib/content/orchestrator.ts`, `lib/publishing/authority.ts`, `approval-gate.ts`, `lib/security/runtime-guard.ts`, `lib/observability/{events,model-calls}.ts`, `lib/memory/migrations.ts`, Migration 037, `vercel.json`, CI-Workflow. Ergänzend Produktionsbudget-Muster im Architektur-Basiscode gelesen. Kein vollständiger Produktions- oder Sicherheitsaudit.

**Korrekturen gegenüber 01:** Migration 038 ist bereits registriert; sie darf nicht erneut reserviert werden. `vercel.json` enthält jetzt 12 Einträge: sechs Affiliate-, einen Wochenbericht-, zwei Themen-Scout- und drei Themenvideo-Einträge. `/continue` bleibt ungeplant. Die alte Aussage „Themen-Pipeline ohne Cron“ ist überholt. PR #80 pflegt den Status nach; diese Prüfung überschreibt dessen Dateien nicht.

Der äußere Orchestrator steuert Abläufe deterministisch und verwendet KI-Zulieferer. Im Content-Orchestrator existieren zusätzlich eigene KI-Urteile (`generate("orchestrator", STRATEGY_INSTRUCTION, ...)` und semantisches Review), mit höchstens acht Modellaufrufen und zwei automatischen Revisionen. „Das gesamte Jarvis-System ist rein regelbasiert“ ist deshalb falsch; ein eigenständiger Unternehmens-Executive existiert trotzdem nicht.

## B. Vollständiger Architekturüberblick und Executive-Vorschlag

| Ebene | Aufgabe | Technische Grenze |
|---|---|---|
| Betreiber | Ziele, Budgets, Freigaben, strategische Entscheidungen | bleibt einzige aktive Veröffentlichungsinstanz |
| Executive | Ziele zerlegen, Alternativen entwickeln, Abteilungsergebnisse bewerten, nächste Schritte planen | KI-Vorschläge werden durch einen deterministischen Kern geprüft |
| Executive-Kern / Infrastruktur | Aufgabenbuch, Zustände, Leases, Policy, Budget, Audit, Zustellung | keine Berechtigungen aus Modellausgaben übernehmen |
| Controlling | Kosten-/Erlösbuch, Abgleich, Kennzahlen, Szenariorechnung | Berechnungen deterministisch; interpretierende Texte optional und getrennt |
| Opportunity Scout | Geschäftsideen recherchieren, Evidenz sammeln, Unsicherheit und Gegenargumente benennen | gedeckelte Recherche; kein autonomer Kauf oder Geschäftsstart |
| Engineering | Aufgaben, Implementierung, Reviews, CI, Releases außerhalb der Produktions-App | getrennte Ausführungsumgebung und begrenzte Repo-Rechte |
| Affiliate Content Studio | bestehende erste Geschäftsabteilung mit eigenem Jarvis/Content-Orchestrator | Integration zuerst nur lesend; bestehende Gates bleiben maßgeblich |
| Weitere Geschäftsabteilungen | später z. B. Immobilienanalyse | eigene Machbarkeit, Datenquellen und Budgetentscheidung |
| Unternehmens-Command-Center | Unternehmensübersicht plus bestehende Studio-Detailansicht | nur nachgewiesene Zustände und klar markierte fehlende Daten |

**Empfehlung für ADR-01:** Hybrid-Executive mit echter, begrenzter Planungsfähigkeit. Ein Plan enthält Ziel, Belege, Annahmen, Alternativen, Teilaufgaben mit Abhängigkeiten, erwarteten Nutzen als Spanne, Kostenobergrenze, Abbruchkriterien und offene Entscheidungen. Ein Modell darf erlaubte interne Analysen vorschlagen; der Kern leitet die Berechtigungsstufe aus der Aktion ab, validiert Verträge, reserviert Budget und begrenzt Tiefe, Laufzeit und Wiederholungen. Finanzielle/rechtliche Außenwirkungen bleiben freigabepflichtig. Bei ungültigem Plan oder fehlenden Daten: stoppen/eskalieren, keine stillschweigende Ausweitung.

Qualität nicht an identischen Antworten messen: feste Evaluationsfälle für widersprüchliche Ziele, fehlende Daten, Quellen-Injection, unrealistische Renditeversprechen, abgelaufene Freigaben und Budgetmangel. Prüfen: Belegtreue, brauchbare Zerlegung, Ungewissheit, Regelkonformität und akzeptierter Nutzen je Modellkosten. Erst im Schattenbetrieb gegen Betreiberentscheidungen vergleichen. Modellwahl bleibt offen, bis Messdaten und Kostenfreigabe vorliegen.

## C. Roadmap-Bewertung und priorisierte Befunde

| ID | Schwere | Befund / konkrete Korrektur |
|---|---|---|
| GPT-01 | blocker | README/02/03/ADR-01 beschränken KI auf Sprache; 08 und Betreiberauftrag verlangen offene KI-Planung. Vor Umsetzung eine konsistente Hybrid-Spezifikation entscheiden. |
| GPT-02 | major | E-07 benötigt H-Grundlage, H benötigt E-07: Abhängigkeitskreis. E-07 zunächst in vorhandener 2D-Oberfläche; H konsumiert dessen fertigen Datenvertrag. |
| GPT-03 | major | 08 verlangt waiting_capacity und Task-Leases; task.schema erlaubt den Status nicht und hat weder Lease noch strukturierte Akzeptanzkriterien/Testanforderungen/Ressourcenbudget. 05 nennt foreign_paths, das Schema verbietet es. Schema/Validator gemeinsam spezifizieren. |
| GPT-04 | major | A-01 beansprucht docs/ai-business/**, einschließlich fremder Review-Dateien. Ownership setzt gesamten Baum auf Claude. Reviewer-Ausnahme und aufgabengenaue Claims fehlen. Read-then-write mit revision schützt zudem nicht atomar gegen zwei Schreiber. |
| GPT-05 | major | Ein gemeinsames GitHub-Konto ist keine unabhängige GitHub-Reviewer-Identität. PR-Autor kann eigene PRs nicht genehmigen. Modellkennungen in JSON sind Selbstauskünfte. Separaten Reviewer/Bot oder verifizierten Check mit geschützter Vertrauensgrenze planen. |
| GPT-06 | major | UNIQUE idempotency_key in Postgres garantiert keine genau-einmalige Wirkung bei externen APIs. Provider-Aufruf kann erfolgreich sein, bevor DB-Bestätigung ausfällt. Outbox/Inbox, externe Idempotenz oder Reconciliation und Zustand outcome_unknown spezifizieren. |
| GPT-07 | major | model_calls ist best effort, verschluckt Speicherfehler und hat keine task_id/department. Kostenbuch daraus ist weder vollständig noch ein harter Budgetwächter. Reservierung vor Aufruf, unabhängiges Settlement und Rechnungsabgleich nötig. |
| GPT-08 | major | Besitz-/Migrationsstand und Cron-Bestandsaufnahme sind veraltet (038, #78/#79). Vor B/E/H aktuelle Basis und Claims abgleichen; PR #80 berücksichtigen. |
| GPT-09 | major | Hobby ist laut offizieller Doku nur nichtkommerziell. Sofern der dokumentierte Tarif noch gilt, Hostingentscheidung vor kommerzieller Nutzung klären; kein eigenständiger Tarifwechsel. |
| GPT-10 | minor | L3 erfasst jede WhatsApp-Nachricht und verlangt Freigabe, obwohl dieselbe Nachricht die Freigabe erst anfordern soll. Vorab autorisierte Benachrichtigung von Veröffentlichung/Ausgabe unterscheiden; Kanal- und Kostenregeln beibehalten. |
| GPT-11 | minor | Null Euro-Zusatzkosten für DB/Controlling/Command Center sind nicht belegt; zusätzliche Nutzung und Entwicklung haben Grenz-/Opportunitätskosten. Als ungemessen ausweisen. |
| GPT-12 | minor | Kalender und Betreiberfenster dominieren 04/05 trotz Ergänzung 08; M1 ist im Abhängigkeitsbild einmal Wirtschaftlichkeit, in Tabelle Koordination. Auf DAG und eindeutige Gates umstellen. |

`blocker` bezieht sich auf die Freigabe der ursprünglichen Architektur zur Umsetzung, nicht auf das Ablegen dieses Prüfberichts. Die Einzelbefunde stehen maschinenlesbar in `coordination/tasks/A-01/review-1.json`.

## D. Verbesserungsvorschläge für Schnittstellen, Daten und Wirtschaftlichkeit

1. **Verträge:** Version, Eingabe-/Ausgabeschema, erlaubte Aufgabenarten, Cancellation, Deadline, Retry-Klasse, Evidenz und Fehlerklasse verbindlich machen. Abteilungszugriffe durch begrenzte Fähigkeiten statt ungefiltertem DB-Handle begrenzen.
2. **Queue:** Lease-Owner und monotoner Fencing-Token; abgelaufener Worker darf keinen neuen Zustand überschreiben. Transaktion für Zustandsänderung + Ereignis + Outbox; Heartbeat, Wiederaufnahme und Dead-Letter/Manuellprüfung definieren. Keine DB-Transaktion über einen langen Modellaufruf halten.
3. **Budget:** Geld in kleinsten Einheiten mit Währung; Reservierung, tatsächlicher Verbrauch, offene Reservierung und Korrekturbuchung unterscheiden. Unbekannter Anbieterstatus löst keine automatische Freigabe der Reservierung aus. Mehrere Quellen desselben Aufrufs dürfen keine Doppelkosten erzeugen.
4. **Kostenbuch:** Preisversion/Abrechnungsbasis (Tokens ODER Laufzeit je Tarif), FX-Stichtag, Erstattungen, Periodenabgrenzung, fehlende Messwerte und Zuordnung abbilden. Keine Umsatzattribution pro Post aus bloßen Landing-Klicks ableiten.
5. **Sicherheit:** Runtime-Guard ist im Preview nur bei gesetzter Vercel-Umgebung sperrend; local lässt Wirkungen zu, Sandbox-Isolation ist Betreiberdeklaration. Entwicklungsprüfungen ohne Produktionszugänge; echtes isoliertes Testsystem vor Wirkungs-E2E. Geplante neue Agenten brauchen dauerhaften Audit und versionsgebundene Entscheidungsevidenz.
6. **Wirtschaftlichkeit:** Erlöse wurden hier nicht gelesen; aus fehlender Erfassung folgt nicht „keine Erlöse“. Affiliate-Profitabilität darf kleine, budgetierte Alternativrecherche nicht grundsätzlich verhindern. M5 soll Messreife, Verlustbudget und Ausbauentscheidung trennen. Neue Abteilung erst nach belastbarer eigener Hypothese und kleinem Test.
7. **Keine Agenteninflation:** Ein Executive-Planer plus Fachmodule reicht zum Start. Controlling-Rechnung benötigt kein LLM; Interpretation von Abweichungen kann der Executive übernehmen. Engineering bleibt aus der Produktions-App heraus, kann aber später in isolierter Umgebung automatisiert werden.

## E. Realistische Beschleunigung

April 2027 ist ein Planungsszenario, kein Mindesttermin. Startfähige Aufgaben beginnen nach erfüllten Abhängigkeiten und Kapazität. Keine seriöse neue Endterminzusage ohne gemessenen Durchsatz.

| Reihenfolge | Claude Code | GPT Work | Voraussetzung |
|---|---|---|---|
| Jetzt | Befunde A-02 beantworten, 01–08 konsolidieren | Architekturreview/Handoff liefern | aktueller Auftrag |
| Danach | Reviewer-Identität/Koordinationsregeln gegenprüfen | C-02-Validator klein spezifizieren, dann implementieren | gemeinsame Architekturprüfung, Umsetzungsfreigabe |
| Parallel danach | Abteilungsvertrag/Queue/Policy spezifizieren | Controlling-Datenvertrag und reine Formeln spezifizieren | Claims ohne Überschneidung |
| Erste Implementierungen | Executive-Kern, lesender Affiliate-Adapter | Validator, Kostenimport und Kennzahlen | gemeinsame Verträge; Migrationen seriell reservieren |
| Später | begrenzter Planer/Scout-Orchestrierung, Unternehmensansicht | Scoring, Kosten-/Sicherheitsreviews | Messdaten, Budget, bestandene Gates |

Review fertiger Arbeit vor neuer Implementierung. Maximal zwei aktive Code-PRs als Startwert, aber keinen starren Claude/GPT-Anteil erzwingen. Durchlaufzeit, Nacharbeit, Reviewwartezeit und Kosten pro akzeptiertem Paket messen. Vollständige Integrationstests nicht bis März verschieben, sondern je vertikalem Funktionsschritt durchführen.

## F. Tatsächliche GPT-Work-Funktionen

| Fähigkeit | Nachweis und Status |
|---|---|
| Repository lesen | erfolgreich über GitHub-Connector und öffentliches git clone |
| Separaten Branch anlegen | lokal und per Connector erfolgreich; gpt/A-02-architecture-review |
| Dateien/Commits schreiben, PR öffnen | Werkzeuge vorhanden; Ausführungsergebnis im A-02-Checkpoint/PR nachtragen |
| Reviews/Zeilenkommentare | Werkzeug vorhanden, in dieser Sitzung nicht als GitHub-Review getestet; Review-JSON ist kein GitHub-Approve |
| Automatische Kontextkomprimierung | in dieser Umgebung vorgesehen; hier nicht als ausgelöster Sitzungswechsel getestet |
| Prozentuale Kontextmessung / verbleibende Abo-Tokens | keine verlässliche Abfrageschnittstelle in dieser Sitzung; null, keine 80%-Behauptung |
| Zeitgesteuerte Aufgaben | Tools vorhanden; private Bestandsabfrage erfolgreich; keine neue Entwicklungsautomation eingerichtet |
| GitHub als Ereignisquelle | list_event_sources liefert GitHub; offizielle Doku beschreibt PR-Ereignisse; konkreter Trigger und Empfängerlauf ungetestet |
| Selbstständige neue Sitzungen / Claude starten | kein direkter Claude-Startzugriff nachgewiesen; Automationslauf ist kein dauerhaft laufender Worker |
| Wiederaufnahme aus Checkpoint | Verfahren vorbereitet; Folgesitzung muss es erst nachweisen |

Offizielle Dokumentation [S1] beschreibt Zeitpläne sowie unterstützte App-Ereignisse und unterscheidet Web/Cloud von Desktop. Web-Aufgaben behalten keinen lokalen Arbeitsordner zwischen Läufen. Repository und Commit sind deshalb das dauerhafte Projektgedächtnis. Die Bereitstellung einer Fähigkeit im Produkt beweist weder ihre Einrichtung für dieses Projekt noch einen erfolgreich abgeschlossenen Lauf.

## G. Technische Kooperationsmöglichkeiten

GitHub ist die gemeinsame asynchrone Schnittstelle. Fachlich unabhängige Modellreviews sind möglich; beide Zugänge können dennoch dieselbe Kontoidentität besitzen. Aktuell ist GPT als `agentstudiots-boop` verbunden, PR #80 wurde ebenfalls unter diesem Konto erstellt. GitHub erlaubt keine Selbstgenehmigung [S4]. Ein späterer CI-Validator darf daher ein beliebig geschriebenes reviewer-Feld nicht als manipulationssicheren Beleg behandeln.

Kurzfristig: Review-JSON + Kommentar/PR mit genauem Commit und offenem Betreiber-Merge. Mittelfristig: separater Reviewer-Zugang oder signierter, vertrauenswürdig erzeugter Check; Einrichtung separat prüfen. GitHub-Ereignistrigger für GPT sind grundsätzlich dokumentiert und als Quelle sichtbar, aber hier weder angelegt noch ausgelöst. Claude-Trigger aus 05 bleiben Fremdbericht. Kein 24/7-Kooperationsnachweis.

## H. Übergabe- und Sitzungsmanagement

Bestehende Struktur weiterverwenden: eigener `tasks/A-02/task.json`, fremde Aufgabe A-01 bleibt unangetastet; deren Review schreibt GPT in `tasks/A-01/review-1.json`. Ressourcenbefunde ergänzen resources.json im separaten Review-PR. Noch keine produktive Claim-Sperre behaupten: A-01s breiter Claim und Reviewer-Ausnahme müssen konsolidiert werden.

Checkpoint nach abgeschlossenem Paket, vor langen Prüfungen, spätestens nach 40 großen Werkzeugausgaben oder 90 Minuten; diese Schwellen sind Heuristiken, keine Kontextmessung. Enthalten: Ausgangscommit, Branch, letzter bekannter Commit, verantwortliches System, Tests, offene Befunde, nächste ausführbare Aktion. Kein Commit kann seine eigene SHA im Inhalt tragen; Test-/Checkpoint-SHAs referenzieren deshalb einen bereits existierenden Stand, neue Artefakte zusätzlich über ihren Inhalt/Hash.

Neue Sitzung: CLAUDE.md → PROJECT_STATUS.md → AGENTS.md → ai-business/README → A-02/task.json → A-01/review-1.json → PR/CI/Remote-Heads. Bei neuer Revision neu lesen; Änderungen nur mit erwarteter Branch-SHA bzw. erwarteter Datei-SHA. Doppelte Aufnahme über zentralen Task-Lease verhindern, nicht über zwei voneinander unabhängige Branch-Dateien.

## I. Aufgabenverteilung und Verantwortlichkeit

A-01: Claude erstellt, GPT hat diesen Stand unabhängig geprüft; Befunde offen. A-02: GPT erstellt Bericht/Review/Checkpoint, Claude muss diese Ergänzungen prüfen. Keine neue Runtime-Implementierung; keine integrierten Änderungen dieser Sitzung. A-03 (Fähigkeiten) teilweise durch reale Werkzeugnutzung belegt. A-04 (Konfliktkarte) im Bericht aktualisiert, ownership.json bleibt zur Konsolidierung durch Claude offen. A-07 teilweise recherchiert; tatsächliche Tarif-/Branchschutz-Einstellungen nicht live geprüft.

## J. Koordinationsdateien und Validierung

Vorhanden sind ownership.json, resources.json, task.schema.json, review.schema.json und A-01/task.json plus README. Es fehlen ein decision-Schema, Akzeptanzkriterien-/Budgetfelder, Wartezustände, Lease-/Claim-Protokoll und technisch erzwungene Schreibrechte. JSON-Syntax allein genügt nicht. Ein gültiges Schema erzwingt weder unterschiedliche Implementierer/Prüfer noch fremde Signaturen oder Remote-Konfliktfreiheit.

Der Prüf-PR ergänzt A-02 und das Review nach den bestehenden Schemas; neue Anforderungen stehen bis Schemaänderung ausdrücklich in known_issues/next_steps und in diesem Bericht. resources.json enthält Quellen und getrennte Nachweisstände. App-Tests wurden nicht als erneut bestanden ausgegeben: reine Dokumentationsänderung, keine installierten App-Abhängigkeiten. CI muss den PR prüfen; die Abfrage zum beobachteten main lieferte keine Workflow-Runs, daher kein aktuelles CI-Grün behauptet.

## K. Erster Kooperationstest (konkret vorbereitet)

1. GPT liefert diesen Branch, Review-JSON, A-02-Checkpoint und PR gegen den Architektur-Branch. Testdaten sind ausschließlich technische Projektdaten.
2. Claude startet eine eigenständige Sitzung, liest nur den dokumentierten Einstieg und findet PR/Commit ohne erneut kopierten Gesamtchat. Es prüft die Änderungen und schreibt `tasks/A-02/review-1.json` mit überprüfter SHA, Tests und Ergebnis; es ändert nicht A-02/task.json.
3. Claude beantwortet A-01-Befunde durch eigene Änderungen; GPT nimmt die neue Revision auf, prüft den Diff und aktualisiert nur seine eigenen Dateien. Belegt wird, welche Teilstrecken tatsächlich funktioniert haben.
4. Nach gemeinsamer Architekturprüfung: C-02 als kleine Codeprobe (Validator mit gültigen/ungültigen Fixtures, Claim-Kollision, fehlendem Budget, gleichem Implementierer/Prüfer und stale Review). GPT implementiert, Claude prüft, CI läuft. Keine App-Wirkung.
5. Betreiber entscheidet Merge. Danach neue Sitzung mit Checkpoint-Wiederaufnahme; optional genau ein enger PR-Ereignistrigger nach geprüfter Prompt-/Triggerkonfiguration. Trigger-ID, Event, Run und gelesene SHA dokumentieren. Erst dann „automatisch getestet“.

Bestehender Schemakonflikt: Review-Dateien sind ausdrücklich Eigentum des Prüfers, kollidieren aber mit A-01s pauschalem Claim. Dieser PR isoliert die Änderungen und dokumentiert die Ausnahme aus dem direkten Betreiberauftrag; er fingiert keine Zustimmung Claudes oder erfolgreiche Claim-Prüfung.

## L. Offene technische Einschränkungen

Keine belastbare Kontingent-/Reset-API, keine getestete direkte Claude-Steuerung, kein erfolgreicher Cross-Sitzungs-/Webhook-Lauf, kein separat authentifizierter Reviewer. Lokales Clone ist gelungen; Connector-Schreibweg wird für nachvollziehbare Remote-Änderungen verwendet. Unterschiedliche Umgebungen benötigen erneute Fähigkeitsprüfung. Production/Schalter, tatsächlicher Vercel-Tarif, Branchschutz und reale Kosten bleiben außerhalb dieses Code-/Planungsreviews.

Vercel-Doku [S2] beschränkt Hobby auf persönliche nichtkommerzielle Nutzung. [S3] nennt 100 Cron-Einträge, mindestens Tagesintervall je Job und stundengenaue Ausführung auf Hobby. Die zwölf Einträge beweisen weder den gebuchten Tarif noch die erfolgreiche Ausführung; daraus keinen Deploymentfehler ableiten. Ein kontinuierlicher schneller Scheduler darf nicht auf garantierte minutengenaue Hobby-Crons bauen.

## M. Erforderliche Betreiberentscheidungen

Jetzt entscheidungsreif: Hybrid-Executive als Zielrichtung bestätigen oder ändern; bis dahin Empfehlung, keine Implementierungsfreigabe. Nach Claudes Gegenprüfung: korrigierte Architektur und ersten C-02-Codeversuch freigeben. Vor Automatisierung: Reviewer-Identität und eng begrenzten Triggerbetrieb entscheiden. Vor kommerziellem Hosting/zusätzlicher Laufzeit: Tarif, Budget und Aktivierung klären. Bestehender Auftrag autorisiert diesen Review-PR, keinen Merge, keine neuen bezahlten API-Läufe und keine Produktionsänderungen.

## Quellen (abgerufen 18.10.2026)

- S1: https://learn.chatgpt.com/docs/automations — geplante Aufgaben, GitHub-Ereignisse, Cloud-/Desktop-Grenzen.
- S2: https://vercel.com/docs/plans/hobby — nichtkommerzielle Nutzung, Tarifgrenzen.
- S3: https://vercel.com/docs/cron-jobs/usage-and-pricing — Cron-Intervalle und Präzision.
- S4: https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews — keine Selbstgenehmigung, Wirkung von Reviews/Rulesets.
- Repository-Nachweise gelten ausschließlich für die oben genannten SHAs; Betriebsdaten wurden nicht daraus abgeleitet.

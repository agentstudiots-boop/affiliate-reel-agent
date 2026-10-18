# Ergänzung zur Roadmap: kapazitätsgesteuerte Entwicklung und GitHub-Handoff

Stand: 18.10.2026. Status: **Vorschlag zur gemeinsamen Prüfung**, keine Betreiberfreigabe, keine automatische Aktivierung.

## Ziel und Priorität

Der Betreiber wünscht keine künstliche Streckung der Umsetzung bis April 2027. Der Kalender aus `04_ROADMAP.md` ist eine konservative Kapazitätsannahme, **kein Warteplan und kein Mindesttermin**. Aufgaben sollen nach erfüllten Abhängigkeiten, verfügbaren Ausführungskontingenten, erfolgreicher CI und unabhängiger Prüfung möglichst früh weiterlaufen. Eine Phase endet mit überprüfbaren Akzeptanzkriterien, nicht durch Ablauf einer Kalenderwoche. Terminprognosen regelmäßig aus Durchsatz, Blockern und realen Kosten aktualisieren.

**Priorität vor neuen Unternehmensagenten:** tatsächliche Cross-Modell-Koordination nachweisen und etablieren. Ein kleiner Ende-zu-Ende-Test muss Task-Datei → eigener Branch → Implementierung → PR → Review des anderen Systems → CI → Betreiberfreigabe → Merge → Handoff/Checkpoint einschließlich Folgesitzung abdecken.

## Wie Claude Code und GPT Work tatsächlich kommunizieren können

Gemeinsame **asynchrone Mailbox** ist GitHub: `coordination/tasks/<ID>/task.json`, `review-<n>.json`, PR-Beschreibungen/Kommentare, Commits und CI-Checks. Jeder Eintrag nennt Zielmodell, Auftrags-ID, Referenz-Commit, Status, erwartete Aktion, offene Fragen, Zeitpunkt und nächste Übernahme. Vor Schreiben Remote-Revisionsstand prüfen; keine fremden Task-Dateien überschreiben. API-Schlüssel, Geschäftsgeheimnisse und private Betreiberinformationen gehören nicht in das öffentliche Repository.

**Wichtige technische Grenze:** Das Schreiben einer GitHub-Datei startet **keine** Claude-Code- oder GPT-Work-Sitzung und garantiert keine Benachrichtigung oder Bearbeitung. Eine echte autonome Zusammenarbeit benötigt nachgewiesene Trigger-/Automationsmöglichkeiten *beider* Produkte bzw. einen externen Orchestrator mit expliziten Berechtigungen und Kostenkontrolle. Insbesondere darf nicht angenommen werden, dass GPT Work GitHub-Kommentare als automatischen Starttrigger akzeptiert oder dauerhaft im Hintergrund läuft. Diese Fähigkeiten in `coordination/resources.json` erst nach echtem Test als verfügbar vermerken. Bis dahin: GitHub-Handoff ist real, aber der Empfänger muss manuell oder über einen separat eingerichteten, unterstützten Trigger aktiviert werden.

## Kapazitätsgesteuerter Ablauf (Soll, nach Fähigkeitsprüfung)

1. Scheduler liest nur freigegebene, nicht blockierte Tasks; prüft Abhängigkeiten, konkurrierende Datei-Claims, offene PRs und gebuchte Budgets.
2. Er prüft per tatsächlich verfügbarer Schnittstelle, ob Claude Code bzw. GPT Work gestartet werden *kann*. Keine Token-Rücksetzzeiten oder Abo-APIs erfinden; unbekannte Kontingente = unbekannt, nicht unendlich.
3. Ein Implementierer erhält exklusiven Task-Lease und arbeitet auf eigenem Branch. Zeit-/Token-/Kostenlimits begrenzen einzelne Läufe; nach Ende Commit, Testnachweis und maschinenlesbaren Checkpoint schreiben.
4. Unabhängiges System prüft Diff, Tests, Sicherheit, Freigaben, Kosten, Integrationskonflikte. Ohne dessen belegtes Review + grüne CI kein Merge.
5. Betreiber bleibt Genehmigungsinstanz für Production, neue Kosten, Secrets, privilegierte Aktionen und Architektur-Grundsatzentscheidungen. Keine Freigaben fingieren.
6. Bei erschöpfter Kapazität oder technischen Sperren Task sauber auf `waiting_capacity` bzw. `blocked` setzen; später nur durch *tatsächlich konfigurierte* unterstützte Auslöser fortsetzen. Kein autonomes 24/7-Versprechen ohne End-to-End-Nachweis.

## Architektur- und Fortschrittsmessung

Executive ist ein eigenständiger Unternehmens-Koordinator, nicht identisch mit dem Affiliate-Jarvis. Die konkrete Mischung aus deterministischen Sicherheitsregeln und KI-gestützter Planung/Entscheidungsvorbereitung ist **offene Architekturentscheidung**; keinen rein regelbasierten Executive ohne Betreiberentscheidung als endgültig festschreiben.

Messgrößen: abgeschlossene und unabhängig geprüfte Arbeitspakete je Woche, Test-/Review-Fehlerquote, Nacharbeitsquote, Durchlaufzeit pro PR, blockierte Kapazität, tatsächliche Kosten und Anzahl nötiger Betreiberaktionen. Der April-Termin wird als Szenario/äußerer Planungshorizont geführt, nicht als Ziel, das die Ausführung künstlich drosselt.

## Nächste Prüfung durch Claude Code und GPT Work

- `04_ROADMAP.md` und `05_ENTWICKLUNGSORGANISATION.md` anhand dieser Ergänzung überarbeiten, ohne deren bisherige Prüfschranken abzuschwächen.
- Technisch belegen, welche Events/Funktionen die jeweiligen Produkte wirklich unterstützen; fehlende Triggers explizit als Blocker dokumentieren.
- Einen kleinen Cross-Modell-Handoff praktisch erproben. Erst nach dessen Erfolg höhere Autonomiestufen planen.
- Änderungen weiterhin ausschließlich auf dem separaten Architektur-Branch; keine produktive Pipeline ändern oder neue Agenten implementieren.

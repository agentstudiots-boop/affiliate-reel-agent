# Übergabe: erste zwei Programmierpakete
Stand: 19.10.2026. Verfasser GPT Work. Bestehende Koordination, kein zweites System.

## Auftrag und Grenzen
Der Betreiber möchte Aufgabenverteilung und Programmierbeginn statt weiterer allgemeiner Planungsrunden. Diese Übergabe bereitet dafür zwei isolierte Codepakete vor. Kein Merge, keine Produktionsänderung, keine Aktivierung und keine zusätzlichen KI-Credits. Eine pauschale Zustimmung zu allen ADRs oder ein erfülltes G0 wird nicht behauptet.
Der nächste Betreiberanstoß soll ausdrücklich die isolierte Implementierung auf Arbeitsbranches erlauben. Diese eng begrenzte Codevorbereitung ist von späterer Architektur-Integration, Merge und Aktivierung zu trennen. Sie benötigt keine laufende Datenbank oder fertige Unternehmensarchitektur.

## Neuester gelesener Claude-Stand
PR #82 Head 7aacf8807d8ccf2bccac9e1f854f1c45e103c34a.
Claude hat laut A-01/task.json die fünf Review-Befunde beantwortet; B-01 enthält bereits die konkrete Zuordnung Aufgabenart/Aktion/Handler, eindeutige IDs und gesperrte Nachfolger. Kein erneuter Auftrag, dieselben fünf Punkte von vorn zu bearbeiten.
Das ist keine abschließende Freigabe aller Architekturdateien. Die noch offene Gesamtprüfung wird nicht als erledigt ausgegeben.

## Arbeitsteilung
| Paket | Planer | Implementierer | Prüfer |
|---|---|---|---|
| B-01 Steuerungsbaustein | Claude | GPT/Codex | Claude |
| E-05 Kosten-/Rentabilitätsfunktionen | GPT/Codex | Claude | GPT/Codex |

## Claude: unmittelbar nächster Arbeitsgang
1. Diese Datei und tasks/E-05/task.json vom Branch gpt/A-01-review-2 lesen. Aktuellen Remote-Stand und vorhandene Arbeit prüfen; keine Aufgabe doppelt anfangen.
2. Im eigenen B-01/task.json drei kleine Spezifikationsklarstellungen vornehmen, keine neue Gesamtrunde:
   - AC-3 muss auch blocked im Rückgabeobjekt enthalten (AC-9 fordert es bereits); Verweise auf AC-1…8 auf AC-1…10 aktualisieren.
   - L3a explizit behandeln: in v0 nie ausführbar, sondern Entscheidungsvorlage; Nachfolger ebenfalls sperren. Es gibt in B-01 keine Nachrichtenfunktion.
   - Tests prüfen strukturierte action/taskKind-Werte. Freitext allein löst keine Aktion aus; von einem deterministischen Validator keine semantische Interpretation des Plantextes verlangen. Tatsächliche Handler-Ausführung bleibt außerhalb B-01.
3. E-05 nach dem ausdrücklichen Betreiberanstoß auf eigenem Branch von aktuellem main implementieren. Nur metrics.ts, dessen Testdatei und erforderlicher exakter Test-Include. Keine DB/Route/Cron/Modellaufrufe. Neue Task-Datei übernehmen, danach pflegt Claude deren Implementierungsstand.
4. E-05-Schnittstellen im Task beachten: AC-3 zu nichtnegativen Beträgen bezieht sich auf contributionMargin-Eingaben; simpleRoi erlaubt ausdrücklich einen negativen netReturn, simplePayback erkennt nichtpositive Zuflüsse und liefert unknown. MoneyInput.amountCents muss daher negative Werte darstellen können; domänenspezifische Prüfung pro Funktion.
5. Projektprüfungen durchführen, Draft-Code-PR öffnen, geprüfte SHA und Testergebnisse in der Übergabe dokumentieren. GPT übernimmt das unabhängige Code-Review. Kein Merge.

## GPT: eigener nächster Arbeitsgang
Aktualisierten B-01-Auftrag lesen und den isolierten Steuerungsbaustein auf eigenem Codebranch implementieren; Claude prüft anschließend den tatsächlichen Code. Keine App-Integration und kein automatischer Produktionsstart.
Schema-Kompatibilität und decision.schema.json bleiben als klar benannte Restprüfung bei GPT; sie sind hier nicht als abgeschlossen dargestellt. Keine zusätzliche Koordinationsautomatisierung für diese beiden reinen Module bauen.

## Konfliktvermeidung
E-05 und B-01 haben getrennte Quell-/Testdateien. Einziger gemeinsamer Punkt: tsconfig.test.json.
Claude fügt für E-05 ausschließlich lib/enterprise/controlling/metrics.ts hinzu, falls noch nicht abgedeckt. GPT prüft vor B-01 den aktuellen Include-Stand. Keine gegenseitigen Überschreibungen und keine Force-Pushes.
Der Review-Branch basiert auf einem älteren Stand als Claudes jüngste Korrekturen. Deshalb nur die beiden neuen Übergabedateien übernehmen, niemals ältere Architekturdateien darüberkopieren.

## Prüfnachweis dieser Übergabe
Task-Felder und Pflichtfelder gegen das gelesene task.schema.json manuell abgeglichen. Keine automatische Schema-Validierung und keine Code-Tests behauptet; dies ist Planung, keine Implementierung.

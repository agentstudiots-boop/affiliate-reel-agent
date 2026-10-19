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

## Nachtrag 19.10.2026: parallele Arbeit und gegenseitige Übergabekontrolle
Betreiberauftrag aus dem laufenden Gespräch: GPT soll seinen B-01-Arbeitsauftrag in der Übergabe dokumentieren; gewünscht ist außerdem eine Prüfung, ob beide Systeme die Übergabedateien autonom etwa alle zehn Minuten kontrollieren können.

- GPT ist für B-01 (isolierter Executive-Steuerungsbaustein) verantwortlich; Claude für E-05. Jeweils eigenes Modell als unabhängiger Prüfer der anderen Implementierung.
- Tatsächlicher GPT-Stand bei diesem Eintrag: Programmierauftrag und Übergabe vorbereitet; noch kein B-01-Anwendungscode geschrieben und noch kein Code-PR erstellt. Frühere Gesprächsformulierungen zum „Start“ sind keine Implementierungsnachweise.
- Der Betreiber berichtet, Claude habe die ausdrückliche Freigabe zur isolierten E-05-Codearbeit erhalten. Das ist eine berichtete Freigabe, keine eigenständig geprüfte Fertigstellung.
- Während einer aktiven Arbeitssitzung: vor Aufgabenübernahme, vor Änderungen gemeinsamer Dateien, beim Abschluss eines Arbeitspakets und vor dem Review den aktuellen Remote-Stand der betroffenen Task-/Review-Dateien lesen. Nur neue Revisionen/Commits bearbeiten; keine Doppelarbeit und keine Selbstfreigabe.
- Gewünschter Zehn-Minuten-Hintergrundtakt: mit der in dieser GPT-Sitzung verfügbaren Automationsfunktion nicht unterstützt; höchste planbare Frequenz einmal pro Stunde. Deshalb keine Zehn-Minuten-Aufgabe angelegt und auch nicht stillschweigend auf stündlich geändert.
- Eine GitHub-Übergabe startet Claude nicht automatisch. Claudes wiederkehrender Start muss in dessen eigener Umgebung geprüft und eingerichtet werden; hierfür liegt kein Nachweis vor. Keine kostenpflichtige API-/Action-Umgehung einrichten.
- Alternative zur Abstimmung: stündliche GPT-Kontrolle; ggf. später ereignisgesteuerte Kontrolle bei relevanter PR-Aktualisierung. Beides ist hier nur eine Option, nicht aktiviert oder Ende-zu-Ende getestet.
- Unverändert: kein Merge, keine Produktion, keine neuen Credits. Die Prüfung einer Automatisierung soll den Bau von B-01/E-05 nicht durch ein neues Koordinationsprojekt ersetzen.

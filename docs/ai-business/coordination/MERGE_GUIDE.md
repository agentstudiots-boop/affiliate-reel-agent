# Merge-Leitfaden für die offenen Draft-PRs (geprüft am 20.10.2026)

Für den Betreiber. Die Merges führt nur der Betreiber aus. Claude hat alle offenen PRs lokal auf `origin/main` (`c56711e`)
zusammengeführt. Gepusht wurde dabei nichts außer der Korrektur in #112. Danach liefen auf jedem genannten Zwischenstand die
vollen Prüfungen (lint, `npm test`, build, typecheck). Die Zahlen unten stammen aus diesen Läufen.

## Kurzfassung

- **35 offene PRs; 29 davon sind Roadmap-PRs gegen `main`.** Die meisten sind gestapelt. #112 (J-02) enthält 18 andere PRs. Wird es gemergt,
  markiert GitHub die enthaltenen PRs selbst als gemergt.
- **Gefundene Probleme:**
  1. Ein Textkonflikt in `tsconfig.test.json`, zwischen #97 und #112. Die Lösung ist, beide Einträge zu behalten.
  2. Zwei Fehler, die erst im Zusammenspiel auftreten. Einzeln ist jeder PR grün.
- **Behoben bzw. vorbereitet:**
  - Fehler 1 ist in #112 behoben (`3f35aaa`).
  - Fehler 2 und der Textkonflikt werden mit einem Update von #112 erledigt, sobald Stufe 1 auf `main` liegt.
- **Endstand nach allen Stufen:** 849/849 Tests, lint (2 bekannte Warnungen), build und typecheck grün.

## Stufen

### Stufe 1: ohne Migration, ohne Laufzeitwirkung außer zusätzlicher Protokollierung

| Schritt | PR | Inhalt | bringt mit |
|---|---|---|---|
| 1 | #101 | C-04 PR-Vorlage (Doku) | – |
| 2 | #95 | D-05 Release-Checkliste (Doku) | – |
| 3 | #97 | F-04 Wirtschaftlichkeitsrechnung (reine Funktionen) | #83 E-05, #85 F-01 |
| 4 | #94 | Videoänderung: Modellaufrufe in `model_calls` protokollieren | – |

Geprüfter Zwischenstand: lint ✔, 708/708 ✔, build ✔, typecheck ✔.

### Stufe 2: Migrationen, je ein eigener Merge (Betreiberfreigabe je Migration nötig)

Ein Merge nach `main` wendet die Migration automatisch in Production an. Das geschieht über `ensureAutomationSchema` beim nächsten
Aufruf. Alle drei Migrationen sind additiv, und kein Code schreibt in diese Tabellen, bevor Schalter oder Einbindung folgen.

| Schritt | PR | Migration | bringt mit |
|---|---|---|---|
| 5 | #89 | 039 Aufgabenbuch, Outbox, Budgetreservierungen | – |
| 6 | #92 | 040 Preis-, Kosten-, Erlös- und Budgetbuch | – |
| 7 | #96 | 041 Executive-Entscheidungsvorlagen | #84 B-01 |

Geprüfte Zwischenstände: siehe Abschnitt „Prüfnachweise“.

### Stufe 3: der Rest des Executive-Kerns und des Command Centers

| Schritt | PR | Inhalt | bringt mit |
|---|---|---|---|
| 8 | – | **Claude aktualisiert #112:** Merge von `main`, `tsconfig.test.json` vereinigt, Zuordnung `whatsapp_video_revision → affiliate` samt Testeintrag. Danach volle Prüfung und Push. Der Betreiber wartet auf CI grün. | – |
| 9 | #112 | J-02 Härtung | #86, #87, #88, #90, #91, #93, #98, #99, #100, #102, #103, #104, #109, #110 |
| 10 | #106 | J-03 Kostenobergrenzen (nur Tests) | #105 J-01 |
| 11 | #108 | E-02 Preiskatalog-Pflege (nicht eingebunden) | #107 E-04 |

Mit Schritt 9 fallen die schon bekannten Betreiberentscheidungen an:
- **OD-B07-1:** öffentliche Route `/api/cron/executive-cycle`. Sie ist durch `CRON_SECRET` geschützt, nicht geplant und durch `EXECUTIVE_ENABLED` aus.
- **OD-H01-1:** Unternehmensebene im Command Center, nur lesend und hinter Login.
- **Visuelle Abnahme** von #103 und #109.

Mit Schritt 11 fällt **OD-E04-1** an.
Nicht gegen `main` und nicht Teil dieses Leitfadens: #81, #82 und #111 (Roadmap-Doku, Gate G0) sowie #10, #61 und #65 (ältere PRs außerhalb der Roadmap).

## Gefundene Fehler im Zusammenspiel

1. **E-02-Isolationstest gegen J-02-Kommentar.**
   - Der Test in `tests/controlling-price-catalog.test.cjs` meldet jede Datei, die `controlling/price-catalog` erwähnt.
   - Der J-02-Importer nannte diesen Pfad in einem Kommentar.
   - Behoben in #112 `3f35aaa`: Nur der Kommentar ist geändert, kein Verhalten.
2. **E-06-Registertest gegen #94.**
   - `tests/enterprise-agent-departments.test.cjs` verlangt, dass jeder in `model_calls` protokollierte Agent einer Abteilung zugeordnet ist.
   - #94 bringt `whatsapp_video_revision`. Der Eintrag ist erst möglich, wenn beide auf `main` liegen: Ein Eintrag ohne Aufrufer wäre laut demselben Test „veraltet“.
   - Deshalb ist er Teil von Schritt 8.

## Falls der Betreiber anders mergen will

- Werden die gestapelten PRs einzeln statt über #112 gemergt, entstehen weitere triviale `tsconfig.test.json`-Konflikte zwischen
  Geschwister-PRs: #90 und #91 gegen #87, #93 gegen #88, #96 gegen #86/#87. Claude löst sie dann je PR per Merge von `main`.
- Wird #94 nach #112 gemergt, wird #94 nach dem Merge von #112 rot. Die zweite Sitzung ergänzt dann die Zuordnung in #94.

## Prüfnachweise (lokal, Hauptcheckout, Node-Test mit PGlite, keine echten Netzaufrufe)

| Zwischenstand | lint | Tests | build | typecheck |
|---|---|---|---|---|
| Stufe 1 (`main` + #101, #95, #97, #94) | ✔ | 708/708 | ✔ | ✔ |
| + #89 (039), merge ohne Konflikt | – | 714/714 | – | – |
| + #92 (040), merge ohne Konflikt | – | 720/720 | – | – |
| + #96 (041), merge ohne Konflikt | ✔ | 739/739 | ✔ | ✔ |
| Endstand (+ #112 aktualisiert, #106, #108) | ✔ | 849/849 | ✔ | ✔ |
| #112 allein (`3f35aaa`) | ✔ | 796/796 | ✔ | ✔ |

Auf dem Stand nach #96 zeigt ein Probe-Merge von #112 nur den erwarteten Konflikt in `tsconfig.test.json`. Schritt 8 löst ihn auf.
Der Endstand wurde zweimal geprüft: einmal mit allen Merges in Stapelreihenfolge, einmal in der Stufenreihenfolge oben. Beide
Bäume unterscheiden sich nur in der Reihenfolge der `tsconfig.test.json`-Einträge und im Wortlaut eines Kommentars.

**Gegenprüfung (zweite Sitzung, 20.10. abends):** Die zweite Sitzung hat die Reihenfolge unabhängig nachgespielt, auf eigener Basis
`c56711e`, nur lokal. Es gibt keine Abweichung: Stufe 1 708/708, #89 714/714, #92 720/720, #96 739/739, jeweils ohne Konflikt. #112 zeigt nur
den `tsconfig.test.json`-Konflikt, die Vereinigung ergibt 44 Einträge ohne Dubletten. Ohne die Zuordnung aus Schritt 8 stehen 848/849 Tests
grün, rot ist genau der Registertest, mit der Zuordnung 849/849. Alle offenen PR-Köpfe gegen `main` sind im Endstand enthalten.

Hinweis: #112 wurde nach dem Review neu geschrieben, ohne inhaltliche Änderung. Der Commit trug eine Modellkennung im Trailer, entgegen
CLAUDE.md §8. Neuer Kopf ist `3f35aaa`, Baum identisch mit dem geprüften Stand.

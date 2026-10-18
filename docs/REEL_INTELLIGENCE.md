# Reel Intelligence – kontrollierter Einstieg

## Ziel
Reichweite und Vertrauen aufbauen, ohne Viralität zu versprechen oder fremde Reels zu kopieren.

## Implementiert
- `lib/content/reel-intelligence.ts` validiert kuratierte Beobachtungen (Quelle, Datum, Nische, Zielgruppe, Hook, Overlay-/Caption-Struktur, Emotion und Mechanik).
- Thematisch passende Beispiele werden dedupliziert und auf höchstens drei je Anfrage begrenzt.
- Der Orchestrator bietet den optionalen Callback `loadReelPatterns(opportunity)`; geprüfte Beispiele fließen in den KI-Brief des Creative Agents ein.
- Ohne konfigurierte Quelle bleibt der bestehende Workflow unverändert; der Referenzmodus bekommt kein neues Erfolgssignal.
- Externe Texte gelten als nicht vertrauenswürdige Inspiration. Keine fremden Medien oder Captions übernehmen, keine automatischen Instagram-Zugriffe.

## Noch nicht angeschlossen (bewusst nicht produktiv)
1. Betreiberseitige Erfassung über ein Eingabeformular oder WhatsApp (Links, manuelle Transkription und Rechtehinweise); Speicherung mit Deduplikation in Postgres.
2. Sicheres, beschränktes `loadReelPatterns` aus dieser Datenbank am produktiven Aufrufer von `runContentJob`. Keine unautorisierte Instagram-Scraping-Integration.
3. Eigene Meta-Insights über unterstützte offizielle APIs sammeln: Reichweite, Plays, durchschnittliche Wiedergabezeit sofern verfügbar, Shares, Saves und Follower-Zuwachs; fehlende Werte nicht erfinden.
4. Auswertung mit Mindeststichprobe, Format- und Account-Kontext, Zeitfenster und explizitem Betreiberreview vor Strategieanpassungen; kein Autoposting.
5. Tests für Datenmigration, Auswahl, Opt-in und bestehende Freigaben sowie Dry-Run gegen Production-Schreibzugriffe.

## Sicherheit
Aufrufzahlen sind Beobachtungen, keine kausale Aussage. Quellen müssen HTTPS sein und die Verwendung bleibt auf Analyse beschränkt. Keine Aktionen auf Affiliate-URLs, keine automatischen Klicks. Kein Eingriff in Veröffentlichungsfreigaben oder Crons.

## Prüfung
`npm test`, `npm run typecheck`, `npm run lint` vor Merge ausführen.

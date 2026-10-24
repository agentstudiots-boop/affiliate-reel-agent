# Übergabe an Claude – Content-Qualität, organisches Wachstum und Avatar-Videos
**Datum:** 2026-10-24 · **Status:** Konzept / nicht implementiert · **Priorität:** nach Stabilisierung bestehender Production-Pipeline · **Verantwortung:** Claude Code für eigenständige technische Analyse und Umsetzungsvorschlag

## Auftrag und Entscheidungsfreiheit
Ziel: Das bestehende Affiliate-Content-Studio „Alltäglich leichter“ soll künftig relevantere, überraschendere, nützlichere und messbar bessere Inhalte für Menschen erzeugen, die den Account noch nicht kennen. Keine neue parallele Influencer-Plattform bauen.

**Claude soll kritisch prüfen, ob und wie die folgenden Funktionen den Zielen dienen.** Die genannten Module, Begriffe, Reihenfolgen und Metriken sind **keine verbindlichen Implementierungsvorgaben**. Bestehende Architektur, verfügbare Provider, Datenflüsse, Risiken, Kosten und Testbarkeit untersuchen; sinnvollere oder schlankere Alternativen ausdrücklich vorschlagen und begründen. Bestehende Komponenten bevorzugt wiederverwenden. Unbelegte Marketing-Behauptungen nicht als Algorithmus-Regeln hartkodieren.

## Ausgangslage verifizieren, nicht voraussetzen
- Zuerst `CLAUDE.md`, `AGENTS.md`, `docs/PROJECT_STATUS.md`, `docs/SCRIPT_WRITER_MANIFEST.md` und einschlägige Themen-/Video-/HeyGen-Dokumentation lesen; anschließend den **aktuellen Code** und Deploy-Status prüfen. Statusbegriffe implementiert/getestet/gemergt/deployed/aktiviert/live verifiziert auseinanderhalten.
- Bekannter Stand laut Projektstatus vom 23.10.: Themen-Pipeline existiert, Nutzer empfindet Vorschläge als langweilig. Video-/HeyGen-Pfade sind teilweise vorgesehen; `HEYGEN_API_KEY` ist genannt, aber `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `HEYGEN_ENABLED`, Videolimits fehlen laut Status in Production. **Der Nutzer hat den Avatar bereits erstellt; keinen neuen Avatar generieren.** Diese Angaben auf Aktualität prüfen und keine Verfügbarkeit vorspiegeln.
- Funktionierende WhatsApp-Freigaben, bestehendes Publishing, Provider, Cron-Jobs, Kostenlimits und Production/Preview-Isolation dürfen nicht regressieren.

## Gewünschte Fähigkeiten (Ergebnis statt starrem Bauplan)
1. **Kreativere Themenfindung:** Kombination aus externen, tatsächlich relevanten Signalen und selbst generierten kreativen Ideen. Inhalte aus dem Alltag statt generischer Nachrichtenzusammenfassungen: Storytelling, Aha-Momente, praktische Hacks, überraschende Erkenntnisse, Humor, emotionale oder philosophische Impulse. Nutzer kann per WhatsApp selbst ein aktuelles Thema vorgeben. Relevanz für Marke, Zielgruppe, belegbare Aussagen und Variation sichern; Duplikate und ermüdende Standards vermeiden.
2. **Redaktionelle Qualitätsentscheidung:** Hooks für erste Sekunden/erste Karussellfolie, verständliche Sprache für Nicht-Follower, klarer Nutzen, Spannungsbogen, Teil- und Speicherwürdigkeit. Prüfen, welche Bewertungslogik überhaupt belastbar ist; heuristische Scores nicht mit realen Erfolgswahrscheinlichkeiten verwechseln. Kein Engagement-Bait oder irreführende Aussagen.
3. **Passende Formatwahl:** Für jedes Thema entscheiden, ob Einzelbild, Karussell, gewöhnliches Video/Reel oder ein sprechendes Avatar-Video am sinnvollsten ist; Kosten, Plattformfähigkeit, kreative Qualität und Verfügbarkeit berücksichtigen. Bestehende Router und Produktionspfade nutzen oder gezielt vereinfachen.
4. **HeyGen als optionaler Avatar-Provider:** Bestehenden Avatar via verifizierter ID anbinden, Skript/Text für Avatar-Video nutzen, Renderstatus/Fehler/Timeouts, gesicherte Asset-Ablage, Untertitel und Freigabeschritte berücksichtigen. Keine doppelte Renderauslösung bei Retries/Webhooks; harte Monats-/Auftragsbudgets und Fallback auf andere Formate. Keine echten Produktionsaufrufe ohne erforderliche Konfiguration und ausdrücklich kontrollierte Aktivierung. Prüfen, was bereits implementiert ist und was tatsächlich fehlt.
5. **Messbarer Lernzyklus:** Plattform-Insights wo rechtmäßig/technisch verfügbar: Reichweite unter Nicht-Followern, Watchtime/Retention in formatspezifischer Interpretation, Shares, Saves, Interaktionen, Follower-Konversion, Profilbesuche sowie Affiliate-Klicks/Umsätze **nur soweit wirklich messbar**. Kleine, kontrollierte Format-/Hook-Experimente planen; Ergebnisse in künftige Themen- und Formatentscheidungen zurückführen. Fehlende Metriken als unbekannt kennzeichnen. Kein automatisches Erhöhen des Produktionsvolumens ohne Evidenz.
6. **Compliance und Wirtschaftlichkeit:** Werbung/Affiliate und synthetische Inhalte korrekt kennzeichnen; keine erfundenen Tests, Produkteigenschaften, Heilversprechen oder Erfolgsgarantien. Rechte für Medien/Stimmen/Avatar sowie API-Bedingungen prüfen. Erzeugungskosten, Conversion und tatsächlichen Deckungsbeitrag gegen Reichweitenziele abwägen.

## Kritische Annahmen
- „Instagram testet immer erst an 100–300 Nicht-Followern“, „70 % Retention ist nötig“ und „danach skaliert es automatisch“ sind **keine zuverlässigen technischen Regeln**.
- 50.000 Follower und Millionenumsätze sind keine planbaren Resultate. Erfolg weder zusichern noch auf Reichweite allein optimieren.
- Zwei Posts täglich sind kein Selbstzweck: Qualität, verfügbare Kapazität und Wirtschaftlichkeit gehen vor Quantität.
- Bloß mehrere Referenzbilder anzuhängen gewährleistet bei Bild-/Videomodellen keine konstante Charakteridentität.

## Vorgehen und Grenzen
1. Zunächst knappe Soll-Ist-Analyse mit Fundstellen im Code, vorhandenen Komponenten und tatsächlichen Blockern.
2. Optionen und Trade-offs (Minimalvariante vs. umfassendere Lösung) aufzeigen; **Claude darf Architektur und Reihenfolge fachlich abweichend wählen**, sofern Ziele und Betriebsregeln eingehalten werden.
3. Zuerst bestehende Produktionsprobleme/Integration stabilisieren; anschließend inkrementelle, reversible Änderungen mit Feature-Flags, Tests, Kosten-/Fehlergrenzen und aussagefähiger Telemetrie.
4. Ausschließlich isolierten Arbeits-/Testbranch benutzen; PR nach `main` mit Testbelegen und Review. **Kein Direktcommit, kein automatischer Merge, keine Aktivierung von Live-Flags oder Secret-Manipulation ohne explizite Freigabe.**
5. Vor Abschluss Übergabedokument, `docs/PROJECT_STATUS.md` und betroffene Dokumentation aktualisieren: was geprüft, was geändert, was getestet, was noch blockiert, welche Betreiberaktion nötig und welche Produktionswirkung real verifiziert ist.
6. Keine neue Abteilung oder neuen Agenten erzwingen, wenn bestehende Komponenten die Ziele besser abdecken. Immobilien-Agent derzeit nachrangig.

## Abnahmekriterien (technologieneutral)
- Überprüfbare Verbesserung der kreativen Themenvielfalt und redaktionellen Eignung gegenüber einer dokumentierten Baseline.
- Ausgewähltes Format nachvollziehbar; Nutzerthema via WhatsApp bleibt möglich; bestehende Freigabe zwingend.
- HeyGen nur bei bestätigter Konfiguration und innerhalb der Budgets nutzbar; andere Formate bleiben unabhängig funktional.
- Analytics kennt Datenquellen, Datenlücken und Grenzen und ermöglicht kontrolliertes Lernen statt Algorithmus-Mythen.
- Tests, Isolierung, Sicherheits- und Kostenkontrollen nachgewiesen; keinerlei unautorisierter Livebetrieb.

**Aufgabe an Claude:** Entwickle auf dieser Basis den fachlich besten Lösungsvorschlag, hinterfrage ausdrücklich auch diese Übergabe und priorisiere nach Nutzen, Risiko und Aufwand. Beginne nicht mit großem Refactoring, bevor der Ist-Zustand belegt ist.

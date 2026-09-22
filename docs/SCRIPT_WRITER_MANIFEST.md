# Manifest für den Drehbuch-Agenten

Festgelegt mit Thorsten am 21.09.2026.

## Auftrag

Zeige, warum das Produkt im Alltag nützlich sein kann. Denke mögliche Anwendungen
mit, statt nur Namen, Merkmale oder mitgelieferte Stichpunkte zu wiederholen.
Verkaufsargumente entstehen aus einem nachvollziehbaren Anwendungsfall.

## Pflichtablauf für jedes Produkt

1. Produktart, Zielgruppe und Linkziel bestimmen. Eine Suchauswahl ist kein
   konkretes Modell; eine Kuscheldecke ist keine elektrische Heizdecke.
2. Relevante Alltagssituationen sammeln: Welches Problem tritt wann auf?
   Welche Handlung erleichtert das Produkt? Was bringt das der Zielgruppe?
3. Funktion, Anwendung und Nutzen verbinden. Mindestens einen starken
   Hauptanwendungsfall und sinnvolle ergänzende Anwendungen herausarbeiten.
   Keine künstlichen Zusatznutzen erfinden, um eine Zahl zu erreichen.
4. Behauptungen einordnen: belegte Modelleigenschaft, allgemeine Möglichkeit
   der Produktart oder noch offene Annahme. Suchtreffer allein verifizieren
   keine Eigenschaft. Ungeprüfte Modellbehauptungen nicht als Fakten sprechen.
5. Voraussetzungen benennen, wenn sie für das Ergebnis nötig sind:
   geeignetes Zubehör, Kühlung, zusätzliches Gerät oder korrekte Anwendung.
6. Einen Hauptnutzen für den Hook wählen und den Anwendungsfall visuell zeigen.
   Weitere Nutzen in passende Folgeszenen oder die Caption aufnehmen.
7. CTA auf das echte Linkziel abstimmen: „Auswahl ansehen“ bei einer Suche,
   Modellinformationen nur bei einer konkreten Produktseite versprechen.

## Qualitätsprüfung vor Freigabe

- Ist ohne Vorwissen erkennbar, wer das Produkt wann wofür nutzt?
- Zeigt jede Nutzenszene eine konkrete Handlung statt nur das Produkt auf dem Tisch?
- Könnte der Text unverändert für einen völlig anderen Artikel gelten?
  Falls ja, ist er zu allgemein und muss überarbeitet werden.
- Passen Behauptungen, Einschränkungen, Bildmaterial und Linkziel zusammen?
- Keine erfundenen Erfahrungen, Preise, Rabatte, Leistungswerte oder Garantien.
- Keine pauschalen Versprechen wie „immer perfekt“, „garantiert kinderleicht“
  oder „fünfmal länger haltbar“ ohne passenden Nachweis und Bedingungen.
- Werbekennzeichnung und menschliche Freigabe bleiben erforderlich.

## Referenz: Vakuumierer für Lebensmittel

Hauptgeschichte: Einkauf → portionieren → vakuumieren → passend lagern →
später zubereiten.

| Alltagssituation | Anwendung | Kaufargument und Grenze |
| --- | --- | --- |
| Ein größerer Einkauf soll für mehrere Mahlzeiten reichen | Lebensmittel portionsweise verpacken | Benötigte Portionen vorbereitet griffbereit haben |
| Vorräte sollen bis zur nächsten Verwendung aufbewahrt werden | Vakuumieren und je nach Lebensmittel kühlen/einfrieren | Kann bei geeigneten Lebensmitteln und korrekter Lagerung die Haltbarkeit verlängern; ersetzt keine Kühlung/Hygiene |
| Zuhause soll Sous-vide gekocht werden | Lebensmittel in geeigneten, temperaturbeständigen Beuteln verschließen | Vorbereitung für Sous-vide; temperiertes Wasserbad und passendes Garprogramm zusätzlich nötig |

Nicht behaupten: Jeder Vakuumierer verarbeitet Flüssigkeiten, jeder Beutel ist
zum Garen geeignet oder Vakuumieren allein macht Lebensmittel sicher haltbar.
Keine Haltbarkeitsfristen aus der Produktart ableiten.

Fachliche Grundlage für die bedingte Haltbarkeitsaussage:
https://www.gov.uk/government/publications/vacuum-packaging/vacuum-packaging

## Neue Umsetzung und Grenzen

Die Content-Planung läuft über einen zentralen Orchestrator mit getrennten
Creative-, Video-, Bild-, Text- und Marketing-Agenten. Es gilt nicht mehr
„jedes Produkt wird ein Reel“. Mehrere Ideen und eine begründete Formatwahl
stehen vor der Produktion. Höchstens zwei Überarbeitungen sind erlaubt.

Der Referenzmodus bleibt regelbasiert und wird so bezeichnet. Im optional
freigeschalteten KI-Modus liefert ein Sprachmodell strukturierte Ideen und
Entwürfe; der Orchestrator prüft die Ergebnisse. Keine Modellantwort ersetzt
menschliche Faktenprüfung oder Veröffentlichungsfreigabe.

Die Vakuumierer-Video-Referenz ist jetzt eine inszenierte 37-Sekunden-
Familiengeschichte: Omas Überraschung → Rückblende mit Vakuumierer → separates
Sous-vide-Wasserbad → auspacken und anbraten → appetitlicher Anschnitt → CTA.
Rosa Fleisch, Kruste, Geräusche und Reaktionen dienen dem Storytelling, dürfen
aber nicht als garantierter Produkterfolg oder echter Kundenbericht erscheinen.
Vorratshaltung bleibt als eigener Carousel-/Text-Anwendungsfall erhalten.

Der bisherige Runway-Renderer erstellt weiterhin nur einzelne stumme
10-Sekunden-Clips. Die neuen Drehbücher werden nicht in diesen Renderer
gepresst. Schnitt, Sprecher und Einblendungen benötigen einen weiteren
Produktionsschritt. Details stehen in ARCHITECTURE.md.

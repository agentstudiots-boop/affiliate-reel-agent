# Architektur v0.2

## Redaktionelle Vorgabe

Für Verkaufsargumente und Drehbücher gilt [das Drehbuch-Manifest](SCRIPT_WRITER_MANIFEST.md):
Alltagssituation → Anwendung → konkreter Nutzen → visuelle Demonstration.
Der derzeitige Drehbuch-Code ist vorlagenbasiert; das Vakuumierer-Beispiel setzt
die Vorgabe exemplarisch um. Eine freie Nutzenanalyse für beliebige Produkte
ist noch nicht implementiert.

## Ablauf

`Trend-Scout → Produkt-Prüfer → menschliche Auswahl → Amazon-Linkdienst → Drehbuch-Agent → menschliche Freigabe → Runway-Clip → Sichtprüfung → Veröffentlichung → Messwerte`

Der Orchestrator steuert nur die Reihenfolge. Inhaltliche Aufgaben bleiben in getrennten Modulen. Der Amazon-Link wird deterministisch erzeugt und nicht von einem Sprachmodell erfunden.

## Verantwortlichkeiten

- **Produkt-Scout:** recherchiert aktuelle Signale, Saisonprodukte und Dauerläufer mit Google-Suche.
- **Produkt-Prüfer:** prüft Nutzenargumente und markiert offene Behauptungen.
- **Amazon-Linkdienst:** ergänzt die Partner-ID reproduzierbar.
- **Drehbuch-Agent:** verarbeitet nur geprüfte und freigegebene Angaben.
- **Orchestrator:** verbindet die Schritte und vereinheitlicht die Ausgaben.
- **Video-Agent:** startet genau einen asynchronen Runway-Auftrag und prüft vorher das Monatsbudget.
- **Medienspeicher:** legt Bilder und fertige MP4s dauerhaft in Vercel Blob ab.
- **Menschliche Freigabe:** bleibt vor Drehbuch und Veröffentlichung erforderlich.

## Verzeichnisstruktur

```text
app/api/trends/route.ts        Produktsuche
app/api/verify/route.ts        Produktprüfung
app/api/generate/route.ts      Drehbucherstellung
app/api/assets/upload/route.ts Produktfoto in Vercel Blob
app/api/video/start/route.ts   Kostenprüfung und Runway-Start
app/api/video/status/route.ts  Status und dauerhafte MP4-Ablage
lib/agents/product-scout.ts    Scout-Abteilung
lib/agents/product-reviewer.ts Prüfabteilung
lib/agents/script-writer.ts    Drehbuch-Abteilung
lib/amazon.ts                  deterministische Partnerlinks
lib/orchestrator.ts            Ablaufsteuerung
lib/runway.ts                  Runway-Konfiguration und Budget
lib/schema.ts                  Ein- und Ausgabeverträge
lib/types.ts                   gemeinsame Datentypen
```

## Noch bewusst nicht automatisiert

- Exakte Amazon-Produktdaten und Preise benötigen später die Freischaltung der Amazon Product Advertising API.
- Social-Media-Veröffentlichung bleibt bis zu einer gesonderten Freigabe manuell.
- Google-Drive-Archivierung bleibt bis zur Einrichtung eines eigenen Google-OAuth-Zugangs manuell.

## Kostenschutz

- Zehn Sekunden `gen4_turbo` im Hochformat pro Auftrag.
- Keine automatische kostenpflichtige Wiederholung.
- Echte Runway-Monatsnutzung wird vor jedem Start geprüft.
- Standardlimit: 1.800 Credits bzw. 18 US-Dollar als Puffer für ein Monatsziel von etwa 20 Euro.
- Runway-Ausgabe wird wegen ihrer kurzen URL-Laufzeit sofort in Vercel Blob kopiert.

# Affiliate Reel Agent v0.2

Die kleinste messbare Version des Agenten-Projekts:

1. Ein Produkt erfassen
2. Ein Reel-Konzept per KI erzeugen
3. Inhalt bewusst prüfen und freigeben
4. Veröffentlichung dokumentieren
5. Klicks, Verkäufe und Provision auswerten

## Technischer Aufbau

- Next.js App Router + TypeScript
- Vercel AI SDK mit `ToolLoopAgent`
- Tavily-Suche mit regelbasierten, stabilen Entwurfsvorlagen
- Tavily-Suche für aktuelle und saisonale Produktsignale
- Automatische Amazon-Partnerlinks mit `AMAZON_ASSOCIATE_TAG`
- Runway `gen4_turbo` für kontrollierte 10-Sekunden-Clips
- Vercel Blob für Produktbilder und dauerhafte MP4-Dateien
- Browser-Speicher für einen v0.1-Testlauf
- Keine automatische Veröffentlichung und keine ungeprüften Werbeversprechen

## Lokal starten

```bash
npm install
cp .env.example .env.local
npm run dev
```

Für aktuelle Webrecherche `TAVILY_API_KEY` und für Amazon-Links `AMAZON_ASSOCIATE_TAG` in `.env.local` setzen. Für Videos werden zusätzlich `RUNWAYML_API_SECRET` und `BLOB_READ_WRITE_TOKEN` benötigt. Die Datei wird von Git ignoriert.

## Runway-Videos mit Schutzlimit

Nach der menschlichen Freigabe erzeugt der MVP genau einen 10-Sekunden-Clip. Vor jedem
Start liest der Server den echten Runway-Verbrauch des laufenden Monats. Bei standardmäßig
1.800 Credits wird kein weiterer Auftrag gestartet. Fehlgeschlagene Aufträge werden nicht
automatisch wiederholt. Das entspricht bei 0,01 US-Dollar pro Credit einem Schutzlimit von
18 US-Dollar. Der Puffer hält das Monatsziel trotz Wechselkursschwankungen ungefähr unter 20 Euro.

Das Produktfoto muss selbst erstellt oder zur werblichen Nutzung freigegeben sein. Die App
kopiert das fertige Video als dauerhafte MP4 in Vercel Blob. Anschließend kann es nach einer
Sichtprüfung über Windsor.ai veröffentlicht und in Google Drive archiviert werden.

## Auf GitHub bereitstellen

```bash
git init
git add .
git commit -m "Initial affiliate reel agent v0.1"
git branch -M main
git remote add origin https://github.com/DEIN-NAME/affiliate-reel-agent.git
git push -u origin main
```

## Mit Vercel deployen

1. Repository in Vercel importieren.
2. Framework-Preset `Next.js` verwenden.
3. `TAVILY_API_KEY` für die aktuelle Webrecherche hinterlegen.
5. `AMAZON_ASSOCIATE_TAG` mit der Tracking-ID, z. B. `alltaeglichle-21`, hinterlegen.
6. Einen Vercel-Blob-Store verbinden; dadurch wird `BLOB_READ_WRITE_TOKEN` gesetzt.
7. `RUNWAYML_API_SECRET` und `RUNWAY_MONTHLY_BUDGET_CREDITS=1800` hinterlegen.
8. Deploy ausführen.

Alternativ nach Anmeldung über die CLI:

```bash
npx vercel link
npx vercel env pull .env.local
npx vercel deploy
```

## Bewusste Grenzen der v0.1

- Daten liegen nur im jeweiligen Browser.
- Klickzählung erfasst nur Klicks über den Button in dieser Anwendung.
- Produktideen basieren auf Such- und Saisonsignalen, nicht auf garantierten Verkaufszahlen.
- Exakte Amazon-Produktdaten werden ohne Freischaltung der Amazon Product Advertising API nicht automatisch eingelesen.
- Das Reel wird gerendert, aber nicht automatisch veröffentlicht.
- Vor jeder Veröffentlichung ist eine menschliche Freigabe erforderlich.

Diese Grenzen halten den ersten Test klein. Erst nach einem vollständigen Durchlauf werden Datenbank und automatische Social- oder Drive-Aktionen ergänzt.

# Affiliate Reel Agent v0.1

Die kleinste messbare Version des Agenten-Projekts:

1. Ein Produkt erfassen
2. Ein Reel-Konzept per KI erzeugen
3. Inhalt bewusst prüfen und freigeben
4. Veröffentlichung dokumentieren
5. Klicks, Verkäufe und Provision auswerten

## Technischer Aufbau

- Next.js App Router + TypeScript
- Vercel AI SDK mit `ToolLoopAgent`
- Vercel AI Gateway (`openai/gpt-5.6-luna`)
- Browser-Speicher für einen v0.1-Testlauf
- Keine automatische Veröffentlichung und keine ungeprüften Werbeversprechen

## Lokal starten

```bash
npm install
cp .env.example .env.local
npm run dev
```

Für lokale KI-Ausgaben `AI_GATEWAY_API_KEY` in `.env.local` setzen. Die Datei wird von Git ignoriert.

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
3. AI Gateway im Projekt aktivieren bzw. `AI_GATEWAY_API_KEY` hinterlegen.
4. Deploy ausführen.

Alternativ nach Anmeldung über die CLI:

```bash
npx vercel link
npx vercel env pull .env.local
npx vercel deploy
```

## Bewusste Grenzen der v0.1

- Daten liegen nur im jeweiligen Browser.
- Klickzählung erfasst nur Klicks über den Button in dieser Anwendung.
- Produktdaten werden noch nicht automatisch aus Shops eingelesen.
- Das Reel wird nicht automatisch gerendert oder veröffentlicht.
- Vor jeder Veröffentlichung ist eine menschliche Freigabe erforderlich.

Diese Grenzen halten den ersten Test klein. Erst nach einem vollständigen Durchlauf werden Datenbank, Produktquellen, Videogenerierung, Partnerprogramme und Social-APIs ergänzt.


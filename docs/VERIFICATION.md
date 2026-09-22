# Prüfung der Content-Erweiterung

Stand: 22. September 2026. Basis: `8ed3176492d1dca882ba31a026000f4dc1f96c71`.

## Ergebnis

- 12 automatisierte Tests bestanden: drei Formate, Ziel-/Budgetwechsel,
  technische Fachbeiträge, Vorratshaltungs-Carousel, maximal zwei Revisionen /
  acht Modellaufrufe, Qualitätsstopp vor Marketing, ungültige Antworten,
  Abbruch, inkompatible Plattform, Zeitbudget, Wiederherstellung,
  Spezialisten-Isolation und Gemini-Vertrag ohne Netzwerkzugriff.
- `npm run typecheck`, `npm run lint`, `npm run build` erfolgreich.
- Zusätzlich DOM-Funktionstest gegen die echte lokale Next.js-API:
  Produktbriefing → NDJSON-Job → 37-Sekunden-Drehbuch → Marketing → Nutzerfreigabe
  → Neuladen ohne erneuten POST. Ein weiterer Auftrag mit Community-Ziel liefert
  einen Textpost und einen getrennten Verlaufseintrag.
- SSR-Seite und API erreichbar; ungültige Eingaben werden mit HTTP 400 abgewiesen.
- Kein kostenpflichtiger Modell-, Bild-, Runway- oder Veröffentlichungsauftrag.
  Gemini-Transport mit Testantworten geprüft; kein Live-Modell-Qualitätstest.
- Der Cloud-Browser konnte den lokalen Server nicht öffnen
  (`ERR_BLOCKED_BY_CLIENT`). Kein visueller Browser-Test oder Deployment-Test
  behauptet. Der Funktionstest verwendete eine DOM-Testumgebung.

## Repository und Secrets

GitHub REST meldete das Repository `agentstudiots-boop/affiliate-reel-agent`
am 22.09.2026 als **public**. Privatstellung war nicht möglich: Connector-Aufrufe
scheiterten mit `Invalid MCP request metadata`; im Browser bestand keine
GitHub-Anmeldung, und Git-Push konnte ohne Zugangsdaten nicht authentifizieren.
Das ist eine offene Aufgabe, keine bereits erledigte Sicherheitsänderung.

Mustersuche über 22 lokal vorhandene historische Commits / 78 eindeutige Blobs
sowie den neuen Arbeitsstand: keine Treffer für private Schlüssel, bekannte
Provider-Tokenformate oder lange wörtlich zugewiesene Secrets. Lockdatei und
TypeScript-Buildcache wurden bei der Inhaltsprüfung ausgelassen. Keine sensiblen
Konfigurationsdateien außer der leeren `.env.example` getrackt. Ein Musterscan
kann unbekannte oder verschleierte Secrets nicht ausschließen.

`.env*` bleibt ausgeschlossen, mit Ausnahme `.env.example`. Zusätzlich sind
Schlüssel-/Zertifikatdateien und typische Credential-/Service-Account-Dateinamen
ausgeschlossen. Der früher getrackte TypeScript-Buildcache wurde aus Git entfernt.
Neue Modellzugänge bleiben ausschließlich serverseitige Environment Variables.

## Ausstehende Freischaltung

1. Authentifizierten GitHub-Zugriff wiederherstellen und Repository privat stellen.
2. Den geprüften Branch übernehmen und Vercel-Bereitstellung kontrollieren.
3. Falls freie KI-Planung gewünscht: `CONTENT_AI_ENABLED`, `CONTENT_MODEL`,
   `GOOGLE_GENERATIVE_AI_API_KEY`, `CONTENT_STUDIO_PASSWORD` in Vercel setzen.
   Ohne diese Freischaltung bleibt der kostenlose Referenzmodus nutzbar.

Jobs werden in dieser Ausbaustufe im Browser gespeichert; serverseitige dauerhafte
Job-Ablage, längere fertig geschnittene Videos und automatisches Posting sind
keine Bestandteile dieser Änderung. Details und Erweiterungspunkte stehen in
ARCHITECTURE.md.

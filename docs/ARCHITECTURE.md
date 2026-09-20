# Architektur v0.1

## Ablauf

`Produktdaten → Reel-Agent → menschliche Freigabe → manuelle Veröffentlichung → Messwerte`

## Verzeichnisstruktur

```text
app/
  api/generate/route.ts   Server-Endpunkt für den Agenten
  globals.css             vollständiges responsives Design
  layout.tsx              Metadaten und Schriftarten
  page.tsx                Workflow-Oberfläche
lib/
  agent.ts                Rolle, Modell und strukturierte Ausgabe
  schema.ts               Eingabe- und Ausgabekontrolle
  types.ts                gemeinsame Datentypen
docs/
  ARCHITECTURE.md         diese Übersicht
.github/workflows/
  quality.yml             Build-, Typ- und Lint-Prüfung
```

## Nächste sinnvolle Ausbaustufe

Eine persistente Datenbank wird erst benötigt, wenn mehrere Produkte, Geräte oder Nutzer unterstützt werden. Dann kann der Browser-Speicher durch Vercel Postgres/Neon ersetzt und echtes serverseitiges Link-Tracking ergänzt werden.


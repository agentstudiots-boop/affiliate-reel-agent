# Content-Architektur v0.4

Aktuelle Speicherarchitektur: [POSTGRES_MEMORY.md](POSTGRES_MEMORY.md).
Die nachstehende Browser-Speicherung beschreibt die vorherige v0.3; neue Jobs
verwenden ausschließlich Postgres. Historische Performance wird jetzt vor der
Formatwahl regelbasiert abgefragt. Betrieb benötigt DATABASE_URL und Migration.

## Zentrale Steuerung

`lib/orchestrator.ts` bleibt der öffentliche Einstieg. Der Content-Workflow liegt
in `lib/content/orchestrator.ts`. Nur dort werden Spezialagenten importiert und
beauftragt. Spezialisten bekommen ein strukturiertes Briefing und einen isolierten
JSON-Generator. Sie haben weder Tools noch Zugriff auf andere Agenten oder den
Orchestrator. Agentenantworten können keine weiteren Aufträge auslösen.

1. Opportunity validieren; Suchauswahl und unbestätigte Modellangaben einordnen.
2. Creative liefert drei unterschiedliche Ideen für Video, Bild und Text,
   einschließlich Alltagssituation, Story, Nutzen, Voraussetzungen und Cross-Sell.
3. Der Orchestrator gewichtet Zielgruppenpassung, Glaubwürdigkeit, Demonstration,
   Kaufinteresse und Aufwand gemäß Kommunikationsziel und Budget.
4. Nur der ausgewählte Video-, Bild- oder Text-Agent erstellt einen Entwurf.
5. Der Orchestrator prüft Format, Anwendung, Zeitbudget, kritische Aussagen und
   bei KI-Modus zusätzlich die redaktionelle Qualität durch einen Modellaufruf.
6. Höchstens zwei Überarbeitungen, jeweils mit konkretem Feedback und Vorversion.
   Bleibt die Qualität schwach, endet der Job mit `needs_input`, ohne Marketing.
7. Marketing schlägt Plattform, Anpassungen, Linkplatzierung und Messgrößen vor.
   Der Orchestrator prüft die Formatkompatibilität und übergibt zur Nutzerfreigabe.

Die Rangfolge ist eine redaktionelle Heuristik, keine Performance-Prognose.
Budget bedeutet relativen Produktionsaufwand, keine garantierte Euro-Kalkulation.
Cross-Sell-Empfehlungen sind Rechercheaufträge, keine automatisch ausgewählten
oder verifizierten Zusatzprodukte.

## Recherche, Planung und Kostengrenzen

- **Content-Planung:** keine externen generativen Modellaufrufe. Drei regelbasierte Ideen und
  formatbezogene Vorlagen, mit ausgearbeitetem Vakuumierer-Beispiel. Für beliebige
  Produkte nur ein Ausgangsentwurf; keine freie kreative Produktanalyse.
- **Tavily:** aktuelle Trend-, Produkt- und Quellenrecherche über die bestehende
  Basic Search API. Tavily wird nicht als allgemeiner Creative-/Drehbuch-Generator
  ausgegeben. `TAVILY_API_KEY` bleibt ausschließlich serverseitig.
- Ein späterer generativer Provider muss separat mit Kostenlimit, strukturierten
  Verträgen und ausdrücklicher Freischaltung ergänzt werden. Es gibt keine
  automatische kostenpflichtige Ersatzroute.
- Der Zugangscode wird nur als Request-Header übermittelt und nicht gespeichert.
  Das ist ein Zugangsschutz für das private Content Studio, kein vollständiges
  Mehrbenutzer- oder serverweites Rate-Limit-System. Pro Browser verhindert Web
  Locks überlappende Planungen, soweit vom Browser unterstützt.
- Keine erfundenen Euro-Kosten oder garantierten Conversion-Werte.

## Jobs, Protokolle und Wiederherstellung

`POST /api/content` streamt validierte Job-Snapshots als NDJSON. Der Server steuert
den gesamten Ablauf; der Client bestimmt keine Agentenfolge. Ein Job enthält ID,
Version, Opportunity-Snapshot, Modus, Status, Ideen, Entscheidung, Content, Review,
Marketing, Revisions-/Aufrufzähler und ein sequenziertes Ereignisprotokoll.

Status: `queued`, `checking`, `ideating`, `selecting`, `producing`, `reviewing`,
`revising`, `marketing`, `awaiting_approval`, `needs_input`, `failed`,
`interrupted`, `approved`.

Vollständige strukturierte Antworten und Entscheidungen bleiben im Job-Verlauf
im Browser (`affiliate-content-jobs-v1`, letzte zehn Jobs) und sind als JSON
exportierbar. Serverlogs enthalten ausschließlich Job-ID, Phase, Ereignisnummer,
Agent und Ereignisart; keine Secrets oder vollständigen Produktbriefings.

Das ist bewusst noch keine dauerhafte serverseitige Job-Datenbank. Beim Schließen
kann ein bereits gestarteter Provideraufruf noch Kosten verursachen; Folgeaufrufe
werden bei Abbruch nicht gestartet. Ein unvollständiger Browser-Job wird nach
Neuladen als unterbrochen markiert, niemals automatisch wiederholt. Ein Neustart
ist ein neuer expliziter Auftrag. Browser-Speicherfehler werden angezeigt; ein
Download bleibt möglich. Geräteübergreifende Wiederaufnahme erfordert später
einen authentifizierten persistenten Job-Store und eine langlebige Queue.

## Vorhandene Funktionen bleiben erhalten

Trend-Scout und Quellenrecherche bleiben über die bestehenden Routen erreichbar.
Gefundene Quellen gelten nicht als Nachweis einzelner Produkteigenschaften. Die
Oberfläche bezeichnet sie deshalb nicht mehr als bestandene Faktenprüfung.

Alte Reel-Entwürfe und zugehörige Runway-Jobs bleiben in einem separaten aufklappbaren
Bereich erhalten. Änderungen am neuen Produktbriefing verändern deren gespeicherten
Produktsnapshot nicht. `/api/generate` bleibt als alte Vorlagen-API kompatibel,
ist aber nicht mehr der normale Einstieg der Oberfläche.

Die neue Content-Freigabe startet weder Runway noch Bildgenerierung noch Posts.
Der Video-Agent schreibt 10–40-Sekunden-Drehbücher; der vorhandene Runway-Renderer
produziert weiterhin einzelne stumme 10-Sekunden-Clips (`gen4.5`, Hochformat).
Ein vollständiger Filmschnitt mit Szenenkonsistenz, Ton und Untertiteln ist ein
separater nächster Produktionsschritt. Bild-Agent liefert Layouts/Prompts,
Text-Agent liefert einen Textentwurf. Marketing veröffentlicht nicht selbst.

## Erweiterung und Tests

Neue Spezialisten (Trendscout, Produktfinder, Finanz-, KDP- oder Qualitätsagent)
werden mit eigenen Verträgen hinter der zentralen Steuerung ergänzt. Kein Import
zwischen Spezialisten. Spätere Kosten-/Performancewerte können `selectIdea`
beeinflussen; derzeit gibt es dafür keine vorgetäuschten Messdaten.

`npm test` prüft Format-Routing, Revisions-/Aufrufgrenzen, Qualitätsstopps,
Abbruch, Wiederherstellung, Schemakonformität und Importisolation ohne echte
API-Aufrufe. CI führt Tests, Typecheck, Lint und Build aus.

# Meta-Verbindung und sichere Veröffentlichungsvorbereitung

## Betrieb

`GET /api/meta/connection` prüft ausschließlich lesend den Systemnutzer, die erwartete Facebook-Seite, ihr verknüpftes Instagram-Konto und `content_publishing_limit`. In der Webapp startet der Button „Facebook & Instagram prüfen“ den Test. Ergebnisse werden pro Serverinstanz zwei Minuten zwischengespeichert. Maximal 14 Graph-Aufrufe mit je acht Sekunden Timeout, keine automatischen Wiederholungen.

Erforderlich ist nur `META_SYSTEM_USER_TOKEN` als serverseitige Vercel-Environment-Variable. Standardziele: `affiliatecontentsystem`, „Alltäglich leichter“, `alltaeglich.leichter`. Graph-Version: `v25.0`. `.env.example` dokumentiert optionale Überschreibungen.

Page- und Instagram-ID werden über zugewiesene Seiten, ersatzweise `me/accounts`, und `instagram_business_account` ermittelt. Optional können `META_PAGE_ID`, `META_INSTAGRAM_USER_ID` und `META_BUSINESS_ID` die Suche eingrenzen. Eine zusätzliche App-ID ist für diese lesenden Abfragen nicht erforderlich. Ein API-Fehler kann fehlende Objektberechtigung und unbekannte Objekt-ID nicht immer eindeutig unterscheiden; die Diagnose benennt diese Grenze.

Öffentliche Antworten enthalten nur Diagnosezustände, Berechtigungsnamen und Konfigurations-Flags. Keine Tokens, aufgelösten IDs oder unverarbeiteten Provider-Antworten. Logs enthalten nur Ereignisname, Status und Verbindungs-Flags. Der Token steht ausschließlich im Authorization-Header an die feste Graph-API-Origin; Weiterleitungen werden abgelehnt. Es gibt keinen Publishing-Endpunkt.

## Publishing-Vertrag

`lib/meta/publishing-plan.ts` bereitet einen Auftrag mit Content-ID, Instagram-ID, HTTPS-Asset-URL, Asset-Hash und Caption vor. Er bleibt `awaiting_approval`, `publishingEnabled: false`. Eine spätere Umsetzung muss die menschliche Freigabe dauerhaft an Content/Asset-Hash binden, Container-/Publishing-IDs und Idempotenz in Postgres speichern, begrenzt pollen und unklare Ergebnisse vor einem erneuten Publish abgleichen. Der Orchestrator ist der einzige Auftraggeber; kein Spezialagent darf direkt veröffentlichen.

Ein erfolgreicher lesender Test bestätigt die erreichbaren Konten und den Publishing-Vorabtest, ersetzt aber keinen separat freigegebenen tatsächlichen Veröffentlichungstest.

## Einmaliger Gemini-Test

`GET /api/gemini/check` liefert nur, ob API-Key und Schutzschlüssel konfiguriert sind; er prüft keine Quota.

`POST /api/gemini/check` benötigt `x-diagnostics-secret`, passend zu `DIAGNOSTICS_SECRET` oder ersatzweise `CONTENT_STUDIO_PASSWORD`. Schlüssel ausschließlich serverseitig setzen, niemals committen oder in öffentliche Frontend-Konfiguration übernehmen. Der Test führt einen minimalen Gemini-Aufruf aus, ohne Wiederholungen, mit 15-Minuten-Cache pro Instanz. Modell über `GEMINI_DIAGNOSTICS_MODEL`, Standard `gemini-2.5-flash`. Er unterscheidet fehlenden Key, Credits, Quota, Zugriff, Konfiguration und Verfügbarkeit. Ohne Schutzschlüssel erfolgt kein Gemini-Aufruf.

## Prüfung

`npm test`, `npm run lint`, `npm run build`. Tests nutzen simulierte Graph-/Gemini-Antworten, keine Tokens, öffentlichen Posts oder kostenpflichtigen Generierungen. Production muss zusätzlich mit ihrem eigenen Environment praktisch geprüft werden.

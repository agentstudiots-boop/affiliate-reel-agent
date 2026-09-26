# Übergabe – OpenAI Bildgenerator-Schnittstelle vorbereiten

Projekt: `agentstudiots-boop/affiliate-reel-agent`

## Aktueller Stand

Arbeitsbranch:
`feat/parallel-revisions-weekly-report`

Draft-PR:
`#9`

Letzter bekannter Commit:
`e4fe7bc318c637218b314231543bdbc45e8283a5`

Zuletzt bestätigt:
- GitHub Quality grün
- 57/57 Tests bestanden
- TypeScript erfolgreich
- ESLint erfolgreich
- Next.js Build erfolgreich
- Vercel Preview READY
- Creative-Quality-Gates implementiert
- generische Symbol-/Textgrafiken sind nicht publishbar
- `card.tsx` ist ausschließlich Debug-/Fallback-Preview
- schwache Legacy-Creatives dürfen keine `publication_requests` erzeugen
- aktuell noch kein produktiver Bildprovider

## Ziel

OpenAI als produktiven Bildgenerator vollständig vorbereiten, sodass nach dem späteren Eintragen von:

`OPENAI_API_KEY`

in Vercel möglichst nur noch Redeploy und ein kontrollierter E2E-Test nötig sind.

Der echte API-Key wird erst später durch den Betreiber in Vercel gesetzt.

Bis dahin:
- keinen kostenpflichtigen OpenAI-Bildaufruf durchführen
- kein echtes Bild generieren
- keinen Facebook-Post erzeugen
- keine echte WhatsApp-Publishing-Freigabe auslösen
- keine Secrets erfinden oder committen

## 1. Bestehenden Stand schützen

Vor Änderungen:
- aktuellen Branch und Head-Commit prüfen
- PR #9 prüfen
- nicht auf `main` arbeiten
- PR #6 nicht unbeabsichtigt verändern
- bestehende WhatsApp-, Faceless-, Reporting-, Revision- und Publication-Gates nicht zurückbauen
- bestehende fail-closed-Logik erhalten

## 2. Aktuelle OpenAI-Dokumentation prüfen

Vor Implementierung die aktuelle offizielle OpenAI-Dokumentation zur Bildgenerierung prüfen.

Insbesondere:
- aktueller Images-Endpunkt
- unterstützte Bildmodelle
- Request-Schema
- Response-Schema
- unterstützte Größen / Seitenverhältnisse
- Base64- oder URL-Ausgabe
- Fehlerverhalten
- Node.js/serverseitige Nutzung
- relevante Retry-/Idempotenz-Regeln

Keine veralteten Modellnamen oder Request-Felder aus Erinnerung verwenden.

## 3. Environment vorbereiten

`.env.example` ergänzen:

```env
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=
```

Regeln:
- API-Key ausschließlich serverseitig
- niemals `NEXT_PUBLIC_`
- keine Secrets committen
- kein Beispiel-Key

Wenn `OPENAI_IMAGE_MODEL` nicht gesetzt ist, aktuellen sinnvollen Default im Servercode verwenden.

## 4. OpenAI Image Provider implementieren

Bestehende Abstraktion in:
`lib/content/image-provider.ts`

weiterverwenden.

Optional sauber auslagern nach:
`lib/content/providers/openai-image.ts`

Ohne `OPENAI_API_KEY`:
- `imageProviderStatus()` => `configured: false`
- Provider sinngemäß `openai`
- klare Begründung: `OPENAI_API_KEY fehlt`
- `getOriginalVisualProvider()` => `null`
- System bleibt fail-closed

Mit `OPENAI_API_KEY`:
- `configured: true`
- Provider `openai`
- echter `OriginalVisualProvider`

Provider-Schnittstelle sinngemäß:

```ts
render(job: ContentJob): Promise<OriginalVisualAsset>
```

## 5. Bildprompt aus bestehendem Creative-System erzeugen

Keinen zweiten unabhängigen Creative-Prozess erfinden.

Nutzen:
- `job.content.visualConcept`
- `job.content.title`
- `job.content.hook`
- `job.content.productIntegration`
- relevante Slides
- Produktname / Produktkategorie
- Use Case
- Zielgruppe
- `verifiedFacts`
- `sourceKind`
- `representation`

V1:
- genau EIN finales Social-Media-Hauptbild
- bevorzugt Hochformat / möglichst 4:5
- hochwertiger Editorial-/Lifestyle-Look
- klare Alltagssituation
- realistische Materialien
- natürliche Beleuchtung
- klare visuelle Hauptidee
- ausreichend negative space für spätere Text-Overlays

Im Prompt verbieten:
- Logos
- Amazon Branding
- Händlerbranding
- Shop-UI
- Marketplace-Screenshots
- Preisfelder
- Sternebewertungen
- gefälschte Verpackungen
- erfundene Marken
- erfundene Produkteigenschaften
- irreführende Produktdarstellungen
- reine Textkarten
- Symbolgrafiken
- Icon-only Creatives
- Legacy-Fallback-Grafik
- unnötig eingebrannte Werbetypografie

Bei `sourceKind = search` oder `category`:
- nur Produktkategorie darstellen
- kein konkretes Modell imitieren
- keine modellbezogenen Eigenschaften erfinden
- keine Amazon-Suchergebnisse nachbauen

Bei `representation = generic_category`:
- neutraler, nicht markengebundener Produktlook

Konkrete Produkteigenschaften nur aus `verifiedFacts`.

## 6. OpenAI-Aufruf

OpenAI-Client ausschließlich serverseitig.

Anforderungen:
- genau ein Bild pro Produktionsversuch
- kein automatischer zweiter Versuch auf Verdacht
- Timeout
- saubere Fehlerbehandlung
- keine Secrets in Logs
- Providerfehler nur sanitisiert protokollieren
- kein stiller Fallback auf `card.tsx`

Unklare Response => FAIL CLOSED.

## 7. Bildvalidierung

Vor Blob-Upload prüfen:
- Ergebnis vorhanden
- Bilddaten vorhanden
- zulässiger MIME-Type
- plausible Dateigröße
- keine leere Datei
- keine offensichtlich ungültige Response

Wenn ohne unnötigen Aufwand möglich:
- SHA-256 berechnen
- für Dateiname/Logging/Wiedererkennung nutzen

Kein OCR.
Keine zusätzliche KI-Analyse des fertigen Bildes nötig.

## 8. Vercel Blob

Bestehenden `BLOB_READ_WRITE_TOKEN` verwenden.

Beispielpfad:
`generated/facebook/{jobId}/{sha256}.png`

Anforderungen:
- öffentlich abrufbare Blob-URL
- korrekter Content-Type
- eindeutiger/stabiler Dateiname
- möglichst keine doppelten Uploads desselben Assets
- Upload erst nach erfolgreicher Validierung

`OriginalVisualAsset` mindestens:

```ts
{
  url: string;
  provider: "openai";
  mediaType: "image";
}
```

Optional, wenn ohne unnötigen Umbau:

```ts
{
  model?: string;
  sha256?: string;
  generatedAt?: string;
}
```

## 9. Publication-Reihenfolge

Ablauf:

1. ContentJob laden
2. Creative-Quality-Gate prüfen
3. OpenAI-Provider-Konfiguration prüfen
4. Bild erzeugen
5. Bild validieren
6. Bild in Blob speichern
7. ERST DANACH Publication Request erzeugen
8. Bild-URL binden
9. ERST DANACH WhatsApp-Publishing-Freigabe senden
10. Facebook-Veröffentlichung erst nach explizitem `Freigeben`

Fail-closed:
- Provider fehlt => keine Publication Request
- OpenAI-Fehler => keine Publication Request
- unklare Response => kein Retry, keine Publication Request
- Bildvalidierung fehlschlägt => keine Publication Request
- Blob-Upload fehlschlägt => keine Publication Request
- Creative Quality fehlschlägt => keine Publication Request

## 10. Kosten-/Usage-Erfassung vorbereiten

Serverseitig erfassbar machen:
- Provider
- Modell
- Job-ID
- Zeitpunkt
- genau ein Generation-Versuch

Wenn OpenAI einen belastbaren Usage-/Cost-Wert liefert:
- speichern bzw. für Reporting bereitstellen

Wenn kein realer Kostenwert geliefert wird:
- keine Kosten erfinden
- Schätzung niemals als Ist-Kosten speichern

Kein automatischer zweiter Bildversuch ohne bewusste Freigabe.

## 11. Tests

Bestehende Tests erhalten und ergänzen:

1. kein `OPENAI_API_KEY` => Provider unavailable / fail-closed
2. Key vorhanden => Provider wird ausgewählt
3. Kuscheldecken-Suchseite => kategorisch, keine Modellbehauptung, keine Amazon-Optik
4. Einzelprodukt ohne `verifiedFacts` => keine unbelegten Merkmale
5. Einzelprodukt mit `verifiedFacts` => nur belegte Eigenschaften
6. erfolgreicher gemockter OpenAI-Request => genau ein Request, gültige Bilddaten, Blob-Upload, URL
7. OpenAI-Fehler => keine Publication Request
8. unklare Response => kein Retry, keine Publication Request
9. ungültige Bilddaten => kein Blob, keine Publication Request
10. Blob-Fehler => keine Publication Request
11. `card.tsx` niemals als publishbares Asset
12. echtes OriginalVisual erforderlich
13. erfolgreicher Mock-Flow => Publication Request erst nach Medienerfolg
14. schwaches Legacy-Creative => weiterhin 0 `publication_requests`
15. Specialist-Agent-Grenzen weiterhin einhalten

OpenAI und Blob in Tests mocken.
Keine echten externen Kosten erzeugen.

## 12. UI

Wenn ohne großen Umbau möglich:

Ohne Key:
`OpenAI-Bildgenerator noch nicht konfiguriert.`
`OPENAI_API_KEY fehlt.`

Mit Provider:
`Bildprovider: OpenAI`

Optional:
`Modell: ...`

Nie Secret anzeigen.

## 13. Dokumentation

`docs/CREATIVE_QUALITY.md` aktualisieren:

- OpenAI = vorgesehener produktiver Bildprovider
- benötigte Env-Variablen
- Default-Modell
- `card.tsx` bleibt Preview-only
- Prompt-Sicherheitsregeln
- Blob-Speicherung
- Fail-Closed-Reihenfolge
- spätere Live-Testschritte

## 14. Qualitätssicherung

Ausführen:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Danach:
- GitHub CI prüfen
- Vercel Preview prüfen
- Runtime-Logs auf neue Fehler prüfen

Keine Production-Freigabe.
Nicht nach `main` mergen.
Draft-PR behalten.

## 15. Live-Schritte nach Eintragen des API-Keys

Später durch Betreiber:

1. `OPENAI_API_KEY` in Vercel Preview setzen
2. optional `OPENAI_IMAGE_MODEL`
3. Redeploy
4. Providerstatus prüfen
5. genau EIN kontrolliertes Testbild erzeugen
6. Bild visuell prüfen
7. Blob-URL prüfen
8. kontrollierten WhatsApp-Publishing-Flow testen
9. keine zweite Generation bei unklarem Ergebnis
10. erst danach echte Facebook-Veröffentlichung testen

## Abschlussbericht

Am Ende berichten:

1. aktueller Branch
2. finaler Commit-SHA
3. PR-Nummer
4. geänderte Dateien
5. implementierte OpenAI-API-/Modellkonfiguration
6. später benötigte Env-Variablen
7. ob OpenAI real aufgerufen wurde — erwartet: NEIN
8. TypeScript-Status
9. ESLint-Status
10. Tests: Anzahl / bestanden / fehlgeschlagen
11. Build-Status
12. GitHub Quality
13. Vercel Preview
14. Nachweis, dass `card.tsx` Preview-only bleibt
15. Nachweis, dass fehlendes echtes Bild Publication Requests weiterhin blockiert
16. exakte spätere Live-Schritte

Arbeite selbstständig bis zu diesem Zustand weiter.

Nur stoppen, wenn zwingend Betreiberaktion, Secret, kostenpflichtige Aktion oder externe Zustimmung erforderlich ist.

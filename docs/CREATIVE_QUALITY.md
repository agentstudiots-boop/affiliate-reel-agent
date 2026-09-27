# Creative Quality Gate

Stand: 24. September 2026

## Ziel

Facebook-Bildposts dürfen nicht mehr über die frühere grüne Text-/Symbolgrafik bis zur WhatsApp-Veröffentlichungsfreigabe gelangen. Ein Bildplan ist erst redaktionell freigabefähig, wenn er ein konkretes visuelles Konzept besitzt.

## Product-Link-Inspiration

`lib/content/product-inspiration.ts` klassifiziert den Quelllink als:

- Einzelproduktseite
- Such-/Auswahlseite
- Kategorie-/Collection-Seite
- unbekannten Linktyp

Daraus werden ausschließlich redaktionelle Signale für Produktkategorie, Nutzungssituation, visuelle Richtung und Kaufkriterien gebildet. Such- und Kategorieseiten bleiben kategorisch und dürfen kein einzelnes Modell vortäuschen. Konkrete Modellmerkmale werden nur aus `verifiedFacts` als belegbar behandelt.

Die bestehende Tavily-Integration bleibt Recherchewerkzeug. Dieser Quality-Patch löst bewusst **keinen** zusätzlichen externen Tavily- oder sonstigen kostenpflichtigen API-Aufruf aus.

## Quality Gate

`lib/content/creative-quality.ts` blockiert unter anderem:

- fehlendes eigenständiges Visual-Konzept
- überwiegend typografische Textkarten
- Symbol-/Fallback-/Platzhaltergrafiken
- zu unkonkrete visuelle Hauptidee
- fehlende Alltagssituation oder fehlenden Produktbezug
- konkrete Modellrepräsentation aus Such-/Kategorieseiten
- Händler-/Amazon-Screenshots, kopierte Logos oder Shop-UI
- Slides ohne ausreichend konkretes Visual-Briefing

Der Orchestrator führt diese Prüfung zusätzlich zur bestehenden redaktionellen Prüfung aus. `publicationRepository.prepare()` ruft weiterhin `facebookPagePublicationError()` **vor** dem INSERT in `publication_requests` auf; ein schwaches Bild-Creative erzeugt deshalb keine Publication Request.

## Original-Visual-Provider: Replicate primär, OpenAI sekundär

Mit serverseitigem `REPLICATE_API_TOKEN` verwendet das System Replicate. Ohne Replicate-Token und mit `OPENAI_API_KEY` verwendet es OpenAI. Ein Fehler oder Timeout bei Replicate löst **keinen** automatischen OpenAI-Aufruf aus: Ein unklarer kostenpflichtiger Versuch bleibt gesperrt. `imageProviderStatus()` meldet `configured`, `provider`/`primary`, `fallback`, `available` und das Modell. Ein ungültig konfiguriertes Replicate-Modell sperrt die Produktion.

Replicate verwendet standardmäßig das offizielle Modell `black-forest-labs/flux-1.1-pro` (aktuell laut Replicate 0,04 USD pro erzeugtem Bild; Preis vor größeren Produktionsläufen erneut prüfen). Mit `REPLICATE_IMAGE_MODEL` ist auch `black-forest-labs/flux-1.1-pro-ultra` unterstützt. Die serverseitige REST-Anbindung erzeugt eine Prediction für genau ein Bild mit `aspect_ratio: "4:5"` und `output_format: "png"`, wartet kurz synchron und fragt bei Bedarf dieselbe Prediction lesend ab. Das Zeitlimit stoppt den Versuch; es gibt keine automatische zweite Generierung. Die Replicate-Ausgabe-URL ist nur vorübergehend gültig. Das Bild wird unmittelbar als PNG validiert und in Vercel Blob gespeichert. Replicate-Metriken enthalten die Prediction-ID und gegebenenfalls die Laufzeit, **keine verlässlichen Ist-Kosten**. Diese werden nicht als gemessene Kosten ausgegeben.

`lib/content/image-provider.ts` aktiviert OpenAI als sekundäre Option nur mit serverseitigem `OPENAI_API_KEY` und einem unterstützten Modell. Ohne beide Tokens liefert es keinen Provider und bleibt fail-closed. Optional kann `OPENAI_IMAGE_MODEL` auf `gpt-image-2.5-flare` (Default) oder `gpt-image-2.5-sunburst` gesetzt werden. Ein unbekannter Modellname blockiert die jeweilige Konfiguration.

Die Implementation verwendet `POST https://api.openai.com/v1/images/generations`, `n: 1`, `1024x1280` (4:5), `quality: medium`, `output_format: png` und prüft genau ein Base64-Ergebnis. Der Prompt übernimmt Visual-Konzept, redaktionelles Briefing und belegte Fakten aus dem ContentJob. Such- und Kategorieseiten bleiben kategorisch. Verboten sind Logos, Amazon-/Händlerbranding, Shop-UI, Preis-/Bewertungsfelder, fiktive Produktmerkmale, reine Textkarten und generische Symbole. Ein Modell wird nicht aus einem Suchlink abgeleitet. Die erzeugte Datei muss PNG-Signatur, plausible Dimensionen und Dateigröße erfüllen; danach wird SHA-256 berechnet.

Der Server speichert das Original als öffentlichen Vercel Blob unter `generated/facebook/{jobId}/{sha256}.png` mit `image/png` und `addRandomSuffix: false`. Er verwendet das bestehende serverseitige `BLOB_READ_WRITE_TOKEN`. Nur eine passende Blob-URL und ein Asset des zuvor reservierten Providers und Modells können gebunden werden; `lib/meta/card.tsx` bleibt **Preview-only** und ist als Veröffentlichungsasset gesperrt.

Ablauf: Job laden → Creative-Quality-Gate → Providerstatus → dauerhaften Bildversuch in `original_visual_attempts` reservieren → genau ein Generierungsaufruf → PNG validieren → Blob-Upload → Publication Request samt Bild-URL atomar anlegen → WhatsApp-Freigabe → Facebook-Veröffentlichung nur nach explizitem „Freigeben“. Bei Provider-/Blob-/Bildfehler entsteht **keine** Publication Request und **keine** WhatsApp-Publishing-Freigabe. Ein unklarer Versuch wird nicht automatisch wiederholt; der Datensatz verhindert auch parallele Doppelaufrufe. Ein erneuter Versuch für dasselbe Creative erfordert bewusste Klärung und einen neuen geprüften Entwurf. `009_original_visual_attempts.sql` und `010_replicate_visual_provider.sql` müssen vor dem ersten Replicate-Versuch in der jeweiligen Umgebung angewendet sein.

Modell, Zeitpunkt, Job-ID und Anzahl der Versuche stehen im Versuchsdatensatz. Soweit OpenAI Tokens in `usage` liefert, werden diese nach erfolgreichem Medienerfolg gespeichert. Ohne API-Kostenwert werden **keine** Ist-Kosten erfunden. Es erfolgen keine automatischen Retries.

### Kontrollierter Live-Test nach Betreiberkonfiguration

1. `009_original_visual_attempts.sql` und `010_replicate_visual_provider.sql` in Preview über die bestehende Migration anwenden und Schema prüfen.
2. `REPLICATE_API_TOKEN` als Vercel-Preview-Secret setzen; optional `REPLICATE_IMAGE_MODEL`. Für die sekundäre Option `OPENAI_API_KEY` und optional `OPENAI_IMAGE_MODEL`. `BLOB_READ_WRITE_TOKEN`, Datenbank und WhatsApp-Konfiguration müssen bestehen.
3. Preview neu deployen und den Providerstatus in der UI prüfen.
4. Einen freigegebenen Bildjob wählen und **genau einen** bewussten Testversuch auslösen. Kosten entstehen erst dann.
5. Originalbild visuell prüfen und öffentliche Blob-URL kontrollieren. Bei unklarem Ergebnis keinen zweiten Bildversuch auslösen.
6. Den getrennten WhatsApp-Publishing-Flow kontrolliert testen und erst danach eine Facebook-Veröffentlichung ausdrücklich freigeben.

## Carousel

Der Bild-Agent erzeugt im Referenzmodus nun ein bildgeführtes Carousel:

1. emotionale bzw. konkrete Anwendungsszene
2. bis 4. kurze Kauf-/Anwendungskriterien
3. sachlicher Vergleichs-/Prüf-CTA

Bei einer Kuscheldecken-Suchseite werden beispielsweise Material, Größe und Pflege als redaktionelle Kriterien behandelt. Händlerbilder, Shop-Kacheln, Preise, Sternebewertungen und konkrete Modellbehauptungen bleiben ausgeschlossen.

## Lernfähigkeit

Der bestehende Lernspeicher erhält keine künstlichen Performancewerte. Für Bildinhalte werden `visualConcept.kind` und `layout` zusammen mit der ausgewählten Idee im vorhandenen `content_jobs.creative`-JSON gespeichert. Damit sind Lifestyle/Application/Comparison/Carousel-Merkmale für eine spätere Auswertung mit echten Performance-Beobachtungen vorhanden, ohne eine neue Datenbankmigration zu erzwingen.

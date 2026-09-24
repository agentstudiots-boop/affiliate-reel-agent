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

## Original-Visual-Provider

Aktuell ist **kein produktiver Bildgenerator** im Repository angeschlossen. Es gibt nur Runway/Faceless für Video, Tavily für Recherche und Vercel Blob für kontrollierte Medienablage.

`lib/content/image-provider.ts` definiert deshalb nur eine fail-closed `OriginalVisualProvider`-Schnittstelle. `getOriginalVisualProvider()` liefert aktuell bewusst `null`.

Damit gilt:

1. `lib/meta/card.tsx` bleibt ausschließlich Debug-/Fallback-Preview.
2. `requestFacebookApproval()` stoppt **vor** `publicationRepository.prepare()`, solange kein echter Original-Visual-Provider vorhanden ist.
3. Es wird in diesem Zustand keine Publication Request angelegt.
4. Es wird keine WhatsApp-Publishing-Freigabe versendet.
5. Es wird kein Facebook-Post ausgelöst.

### Noch benötigte externe Integration

Ein konkreter Bildgenerator wurde bewusst noch **nicht** erfunden oder festgelegt. Der verbleibende Integrationsschritt ist daher eine Betreiberentscheidung für einen real verfügbaren Bildprovider plus dessen serverseitigen API-Schlüssel. Erst danach wird eine konkrete Implementierung von `OriginalVisualProvider.render()` ergänzt und das erzeugte Asset kontrolliert in Vercel Blob persistiert.

Es wurde deshalb auch **kein neuer Secret-Name** in `.env.example` vorgetäuscht.

## Carousel

Der Bild-Agent erzeugt im Referenzmodus nun ein bildgeführtes Carousel:

1. emotionale bzw. konkrete Anwendungsszene
2. bis 4. kurze Kauf-/Anwendungskriterien
3. sachlicher Vergleichs-/Prüf-CTA

Bei einer Kuscheldecken-Suchseite werden beispielsweise Material, Größe und Pflege als redaktionelle Kriterien behandelt. Händlerbilder, Shop-Kacheln, Preise, Sternebewertungen und konkrete Modellbehauptungen bleiben ausgeschlossen.

## Lernfähigkeit

Der bestehende Lernspeicher erhält keine künstlichen Performancewerte. Für Bildinhalte werden `visualConcept.kind` und `layout` zusammen mit der ausgewählten Idee im vorhandenen `content_jobs.creative`-JSON gespeichert. Damit sind Lifestyle/Application/Comparison/Carousel-Merkmale für eine spätere Auswertung mit echten Performance-Beobachtungen vorhanden, ohne eine neue Datenbankmigration zu erzwingen.

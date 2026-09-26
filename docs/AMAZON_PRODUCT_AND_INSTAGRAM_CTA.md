# Ein Affiliate-Inhalt, ein Amazon-Produkt

Stand: 26.09.2026. Ergänzung zu PR #6 auf `feat/production-gates-whatsapp`.

## Produktvertrag

Nur HTTPS-Detailseiten auf `amazon.de` / `www.amazon.de` mit genau einer ASIN
(`/dp/ASIN`, optional mit Produktslug, oder `/gp/product/ASIN`) werden normalisiert.
Such-, Kategorie-, Bestseller-, Start-, Kurz- und Redirect-Links liefern keinen
Affiliate-Link. Fehlende oder widersprüchliche Produktzuordnung endet im vorhandenen
Job als `needs_input` mit `error: product_unresolved`; kein Spezialist, Medienkauf
oder Freigabe folgt. Es gibt keinen Suchlink-Fallback.

Der Server ordnet eine konkrete ASIN nur mit einem passenden Amazon-Detailtreffer
und dessen Produkttitel aus der vorhandenen Tavily-Recherche zu. Das ist ein
Identitätsnachweis anhand des indexierten Amazon-Treffers, **keine** Bestätigung
von Verfügbarkeit, Preis oder Produktmerkmalen. Fehlende Evidenz und Recherchefehler
blockieren. Clientseitige Prüfzeitpunkte werden bei der Content-Erstellung nicht
übernommen. Der ermittelte Produkttitel wird zum Namen des Inhalts; ein abweichendes
manuelles Produktbriefing wird abgelehnt.

Gespeichert in `content_jobs.opportunity.product` und `snapshot.opportunity.product`:

| Feld | Inhalt |
| --- | --- |
| `name`, `productVerifiedName` | zugeordneter Amazon-Produkttitel |
| `asin` | eindeutige ASIN |
| `sourceUrl`, `productUrl` | dieselbe kanonische Detailseite |
| `affiliateUrl` | diese Detailseite mit Tracking-ID |
| `trackingId` | vorhandenes `AMAZON_ASSOCIATE_TAG`, sonst bestehender Projektwert `alltaeglichle-21` |
| `productVerifiedAt` | serverseitiger Zeitpunkt der Identitätszuordnung |

Die existierende `content_jobs.id` verbindet Planung, Assets, Produktionslauf,
WhatsApp und Veröffentlichung. `products.id = amazon.de:ASIN` bleibt die bestehende
Produktidentität. Kein zusätzliches `content_id`-System, keine Datenbankmigration.
Eine bestehende Job-ID darf nicht auf ein anderes Produkt umgebunden werden.

Kontrollen erfolgen vor Planung und Marketing, vor Content-/WhatsApp-Freigaben,
vor dem bezahlten Videostart sowie innerhalb der atomaren Facebook- und
Instagram-Veröffentlichungsclaims. Caption und gespeicherter Content-Hash müssen
unverändert sein. Fremde ASINs und andere URLs im Creative werden abgelehnt.
Auch ältere bereits genehmigte Suchlink-Jobs scheitern an diesen Schranken.
Der historische `/api/video/start`-Weg hatte nur Name/Prompt ohne gespeicherte
Produktidentität oder Kostenfreigabe und liefert deshalb jetzt HTTP 410 ohne Kauf.

Die vorhandenen generierten Bilder bleiben als illustrative Anwendungsszenen
gekennzeichnet; ohne freigegebene Produktreferenz werden keine exakten Modellfotos
oder Eigenschaften vorgetäuscht. Menschliche Sichtprüfung der Medien bleibt nötig.

## Instagram: kein frei belegbarer externer Shopping-Button im vorhandenen Flow

Direkt geprüft am 26.09.2026 in der offiziellen Meta-Referenz (Seitenstand
12.08.2026):

- [IG User Media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
- [Meta-eigene Postman-Reel-Anfrage](https://www.postman.com/meta/instagram/request/5kkpkh6/upload-a-reel-to-an-ig-container)
- [Available Catalogs](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/available_catalogs/)

Der Code nutzt Instagram API with Facebook Login: `POST /{ig-user-id}/media`
mit `media_type=REELS`, `video_url`, `caption`, `share_to_feed=false`; anschließend
`POST /{ig-user-id}/media_publish` mit `creation_id`. Die konfigurierte Graph-Version
bleibt erhalten (Code-Fallback v25.0); die aktuelle Referenz zeigt v26.0.

Die vollständige Parametertabelle enthält keinen frei belegbaren externen
`call_to_action`-, `shopping_url`- oder Link-Button-Parameter. `video_url` bezeichnet
ausschließlich die hochzuladende Videodatei und ist kein Shopping-Ziel.
`product_tags` ist ein anderer Mechanismus: Katalog-`product_id`, zusätzliche
Berechtigungen `catalog_management` und `instagram_shopping_tag_products` sowie
Adminrolle im Business Manager des Instagram Shops. Eine Amazon-ASIN oder
Affiliate-URL ersetzt diese Katalog-ID nicht. Dieser App fehlen eine verifizierte
Katalogzuordnung und ein entsprechender Commerce-Flow.

Meta hat 2026 außerdem native Creator-Shopping-Funktionen angekündigt:
[offizielle Ankündigung](https://about.fb.com/ltam/news/2026/03/llega-una-nueva-era-de-descubrimiento-de-productos-impulsada-por-ia-y-los-creadores/).
Eine Funktion in der Instagram-App ist kein Nachweis, dass dieselbe freie URL über
den verwendeten öffentlichen Publishing-Endpunkt gesetzt werden kann. Daher wird
keine allgemeine Aussage gemacht, Instagram unterstütze grundsätzlich kein Shopping.

Implementierte Grenze: `ORGANIC_REEL_CAPABILITIES.externalShoppingButton=false`.
Der Payload-Builder weist einen angeforderten Shopping-Link zurück und erzeugt
nur die dokumentierten Felder. Keine Fake-Buttons, Shop-Overlays, behaupteten
Profil-Links, Produktkataloge oder Ads. Als zulässiger Weg enthält die Caption
Produktname, ASIN und genau den zugehörigen Affiliate-Link **als Text**; dessen
Klickbarkeit wird nicht zugesichert. Der gesprochene CTA verweist auf diesen
Beitragstext. Ein wirklich klickbarer Commerce-/Ads-Weg wäre ein gesonderter Auftrag.

## Prüfungen

96/96 Tests erfolgreich, einschließlich konkreter Detailseiten, Such-/Kategorie-
Sperren, serverseitiger Evidenz, Tracking-ID-Erhalt, unveränderlicher Jobidentität,
Reel-/CTA-Zuordnung, manipulierter Captions, alter Suchlink-Jobs, fehlender
Button-Unterstützung und Sperre des alten ungebundenen Clip-Endpunkts.
`npm run typecheck`, `npm run lint` und `npm run build` sind erfolgreich.
Die bestehenden Parallelitäts-, WhatsApp-, Medien- und Veröffentlichungsprüfungen
laufen weiterhin gegen echte PGlite-Transaktionen mit simulierten externen APIs.
Dies ersetzt keine reale Veröffentlichung nach WhatsApp-Freigabe.

# Content-Identität und Zeitreihen

## Migration und bestehende Daten

Migration `010_content_history.sql` nach `001`–`009` mit `npm run db:migrate` oder dem vorhandenen geschützten Migrationsendpunkt ausführen. Vorher ein Datenbank-Backup anlegen. Die Migration läuft mit dem vorhandenen Migrationswerkzeug in einer Transaktion und verändert keine alten Migrationsdateien.

`content_jobs.content_id` ist eindeutig, verpflichtend und durch einen Trigger unveränderlich. Bestehende Jobs erhalten deterministisch `cnt_legacy_` plus ihre UUID ohne Bindestriche. Diese Zuordnung bleibt über erneute Migrationsaufrufe stabil. Neue Jobs erhalten beim serverseitigen `memoryRepository.claim` eine UTC-Datumskennung plus 128 kryptografisch zufällige Bits (`cnt_YYYYMMDD_<32 hex>`). Der UNIQUE-Constraint fängt eine hypothetische Kollision auch bei parallelen Jobs ab. Die bisherige `job_id` bleibt als FK in Ereignissen, Drafts, Produktionsläufen, Freigaben, Revisionen und Veröffentlichungen bestehen; über `content_jobs` ist sie eindeutig auf die `content_id` abbildbar. Die gespeicherte Job-Kopie enthält dieselbe ID und die Revisionen übernehmen sie. Alte gespeicherte Job-Kopien dürfen die ID noch nicht enthalten; die Datenbankspalte ist in diesem Fall maßgeblich.

Ein Produkt (`products.id`) kann beliebig viele `content_jobs` und damit Experimente haben. Die historischen Kennzahlen liegen bei der `content_id`, nicht beim Produkt. Ein schwacher früher Messpunkt wird nie in ein endgültiges Produkturteil umgewandelt.

## Messwerte und Zuordnung

| Tabelle | Zweck | Identität und Quelle |
| --- | --- | --- |
| `content_performance_snapshots` | Kumulative Social-Messungen mit unbekannten Werten als `NULL` | `content_id`, `publication_id`, Plattform, echte externe Post-ID, Quelle, Zeitpunkt und stabiler Quell-Snapshot-Schlüssel |
| `affiliate_tracking` | Dauerhafte Zuordnung einer vom Partnerprogramm bestätigten Tracking-ID | Genau ein Provider und höchstens eine unveränderliche Tracking-ID pro Content |
| `affiliate_performance_snapshots` | Kumulative Klicks, Bestellungen und Provision in Cent | `content_id`, bestätigte Tracking-ID beim Import, Quelle, Zeitpunkt und Quell-Snapshot-Schlüssel |
| `product_price_history` | Preis in Cent und optional belegter Referenzpreis | Produkt, optionale konkrete Content-Entscheidung, Quelle und Zeitpunkt |
| `content_cost_events` | Tatsächlich zurechenbare Produktions- und API-Kosten in Cent | Content, Quelle und eindeutiges Kostenereignis |

Beide Snapshot-Tabellen und Kosten-/Preisereignisse sind append-only. Ein identischer Import mit demselben Quellschlüssel und denselben Werten liefert `created:false`; abweichende Werte für denselben Schlüssel werden abgelehnt. Für eine echte spätere Korrektur ist ein **neuer** Quellschlüssel mit neuem Beobachtungszeitpunkt erforderlich. `source_snapshot_id` muss vom Importer stabil und innerhalb der Quelle global eindeutig sein, zum Beispiel eine Kombination aus externer ID und Messzeitpunkt. Unbekannte Metriken bleiben `NULL`; der Importer soll nur belegte Felder senden. UTC ISO-Zeitstempel mit Offset sind Pflicht; `recorded_at` dokumentiert den tatsächlichen Datenbankeingang. Historische Werte und Fehler werden nicht überschrieben.

`content_performance_deltas` und `affiliate_performance_deltas` berechnen Differenzen per `lag` innerhalb derselben Quelle und desselben Contents. Ein fehlender Ausgangswert ergibt `NULL`. Negative Differenzen können eine Korrektur oder einen Zähler-Reset bedeuten und dürfen nicht als negative Verkäufe interpretiert werden. Für 24 h, 72 h, 7 und 30 Tage stehen Veröffentlichungs- und Messzeitpunkte bereit; Klassifikationslabels werden noch nicht vergeben.

Die Facebook-Veröffentlichung schreibt die von Meta tatsächlich zurückgegebene Post-ID in `publications.external_post_id`. Alte IDs werden nur aus bereits veröffentlichten `publication_requests` übernommen. Social-Snapshots werden abgelehnt, wenn die Post-ID, Plattform oder `content_id` nicht exakt zur Publication passt. Instagram-Publishing und der automatische Meta-Insights-Import existieren derzeit nicht. Deshalb entstehen ohne separaten Import keine Social-Snapshots.

## Geschützter Import und Abfrage

`POST /api/content/timeline` akzeptiert mit dem vorhandenen `x-content-password` die Aktionen `social`, `affiliate`, `price`, `cost` und `bindAffiliateTracking`. Alle Geldwerte sind **EUR-Cent als Ganzzahl**. Beispiel eines verifizierten Affiliate-Snapshots nach vorheriger Bindung einer wirklich eigenständigen Tracking-ID:

```json
{"action":"affiliate","data":{"contentId":"cnt_20260925_0123456789abcdef0123456789abcdef","trackingId":"bestaetigte-id-21","source":"amazon","sourceSnapshotId":"bestaetigte-id-21:2026-09-28T12:00:00Z","observedAt":"2026-09-28T12:00:00Z","clicks":18,"orders":1,"commissionCents":420}}
```

`GET /api/content/timeline?contentId=...` liefert Messreihen, Deltas und aktuelle Wirtschaftswerte. Der Endpoint ruft keinen externen Dienst auf. Ein Importer kann dieselbe Quelle später erneut abrufen und jeweils einen neuen Snapshot anfügen. Es ist noch kein automatischer Meta- oder PartnerNet-Importer und kein Import-Cron implementiert; ein API-Key allein beweist keine Zuordnung.

Eine **vor** dem Veröffentlichungsauftrag gebundene, echte Amazon-Tracking-ID ersetzt im Facebook-Post den gemeinsamen `tag`-Parameter des amazon.de-Direktlinks. Dieser konkrete Link geht in den Hash des WhatsApp-Freigabeentwurfs ein. Bei Kurzlinks oder anderen Hosts wird die Veröffentlichung mit gebundener ID abgelehnt, weil der effektive Tag nicht überprüft werden kann. Nach Erstellen eines Veröffentlichungsauftrags ist das Binden gesperrt.

`economics` verwendet die letzten kumulativen Werte je **nicht überlappender** Affiliate-Quelle. Für Amazon muss `source` exakt `amazon` sein, damit parallele Berichte nicht mehrfach addiert werden. `revenue = commission`, `cost = Summe bekannter Kostenereignisse`, `profit = revenue - cost`, `ROI = profit / cost` bei Kosten > 0. Fehlende Einnahmen oder Kosten ergeben `NULL`, auch wenn der jeweils andere Wert bekannt ist. Conversion Rate, Umsatz und Gewinn pro Klick setzen gemessene Klicks > 0 voraus. Credits von Faceless und OpenAI-Nutzungsdaten werden ohne belegte EUR-Bewertung **nicht** in Eurokosten umgerechnet. CTR braucht eine zuordenbare Impressionenzahl und einen tatsächlich gemessenen Klickzähler; der Endpunkt berechnet sie deshalb noch nicht.

## Grenzen der Amazon-Zuordnung

Der bisherige Amazon-Link verwendet eine gemeinsame `AMAZON_ASSOCIATE_TAG`. Damit lassen sich Verkäufe **nicht zuverlässig einem einzelnen Post** zuordnen. Die Zuordnung `affiliate_tracking.tracking_id` bleibt deshalb zunächst `NULL`; die Importfunktion verweigert Content-spezifische Amazon-Zahlen ohne individuell gebundene ID. Eine frei aus `content_id` erfundene PartnerNet-ID wäre ungültig. Amazon dokumentiert derzeit maximal 100 Tracking-IDs pro Partnerkonto; bei vielen Content-Stücken ist eine eigene PartnerNet-ID für jeden Post keine dauerhafte Skalierungslösung. Eine spätere alternative Attribution erfordert eine tatsächlich verfügbare und rechtlich zulässige Zuordnungsquelle. Ggf. kann ein eigener Linkpfad ausgehende Klicks je Content messen, ohne daraus Amazon-Bestellungen oder Provision abzuleiten.

## Betrieb

- Migration vor einem Deploy neuer Schreibpfade ausführen; der Test mit Bestandsdaten prüft den deterministischen Backfill.
- Bestehende `performance_observations` bleiben als manuelle, versionierte Altmesswerte erhalten. Sie werden nicht als Amazon-Snapshots umetikettiert, weil ihre `source` keine eindeutige Tracking-ID beweist.
- Produktpreise kommen nur mit Quelle und Zeitpunkt in `product_price_history`; es gibt keine automatisch erzeugten Rabattaussagen.
- Produktions- und API-Kosten werden nur nach tatsächlicher EUR-Belastung mit stabilem Ereignisschlüssel eingetragen; Angebote oder Provider-Credits sind noch keine Kosten in Cent.

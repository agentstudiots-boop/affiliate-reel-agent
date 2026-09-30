# Tägliche Entwürfe und Veröffentlichung

## 30. September 2026, 14:16 MESZ: falscher Einsatzort der Badewannenmatte

Ein vom Betreiber gezeigter produktiver WhatsApp-Entwurf nennt die ASIN
`B0C2C739KY` und einen Amazon-`/dp/`-Affiliate-Link. Sein Titel bezeichnet
eine **Badewannenmatte**, aber Text und Bildbriefing platzieren sie **vor der
Dusche**. Das ist ein konkreter sachlicher Widerspruch; die vorhandene
Inhaltsfreigabe ist nicht erteilt. Die Betreiberantwort „Das ist aber eine
Badematte für in die Badewanne“ erhielt um 14:16 MESZ nur eine allgemeine
Rückfrage. Production-Logs des Deployments `dpl_DdyFA6ZBWKVr4SBneccG5znyUifc`
zeigen um 12:16:07 UTC `instruction_parser_result` mit `intent=clarify`
(`openai/gpt-5.6-terra` über Replicate) und anschließend
`instruction_revision_blocked` mit `instruction_unclear`. Die Logs legen
keine genaue interne Ursache der ungültigen Modellantwort offen. Der
Produktname im gespeicherten Entwurf und die allgemeine Scout-Szene „vor die
Dusche“ belegen aber die zweite Fehlerquelle. Die WhatsApp-Antwort erklärt,
dass daraus kein Bild erzeugt und nichts veröffentlicht wurde. Die Amazon-
Detailseite wurde in dieser Nachprüfung nicht erneut abgerufen; die
Anwendung des konkreten Modells ist nur aus dem im Entwurf angezeigten Titel
abgeleitet, weitere Modellmerkmale bleiben ungeprüft.

Für künftige Entwürfe hat der verifizierte Titel „Badewannenmatte“ Vorrang
vor der allgemeinen Badematten-Szene. Eine enge redaktionelle Regel sperrt
eine Szene oder Caption vor der Dusche bereits vor der Inhaltsfreigabe und
auch vor Bildkauf/Veröffentlichungsauftrag eines älteren Plans. Die exakte
Betreiberkorrektur wird für einen weiterhin offenen Auftrag als Bild- **und**
Textänderung mit unveränderter ASIN und Affiliate-Link übernommen; dafür ist
kein weiterer Sprachmodellaufruf nötig. Der neue Entwurf benötigt wiederum
eine ausdrückliche Inhaltsfreigabe und danach eine getrennte
Veröffentlichungsfreigabe. Die alte WhatsApp-Nachricht bleibt dedupliziert;
ein eingegangener Änderungswunsch wird nicht als unbekannter POST wiederholt.
Der Betreiber muss die Korrektur nach dem Deployment einmal neu direkt auf
die offene Freigabe beziehungsweise ihre Rückfrage senden. Ein freier
Themen-Chat mit autonomer Post-Erstellung ist weiterhin ein eigener,
kosten- und sicherheitsgeprüft zu entwickelnder Ablauf.

## 30. September 2026: Vormittagsstatus und diversifizierte Auswahl

Der Betreiber zeigte die produktive WhatsApp-`Status?`-Antwort von **11:28 MESZ**.
Sie nennt für den 30.09. vormittags `Produktsuche: needs_input (Produkt in den
letzten sieben Tagen verwendet)` und für den 29.09. nachmittags denselben
Abbruch. Damit ist für beide gespeicherten Slots die Produktauswahl als
Abbruchstufe beobachtet; aus diesen Aufträgen ging keine Inhaltsfreigabe
hervor. Die Ansicht nennt weder Kandidat, ASIN, Amazon-Detailseite und
Affiliate-Link noch eine Job-ID oder einen konkreten Lock. Content-Plan,
redaktionelle Prüfung und WhatsApp-Sendestatus sind daraus nicht einzeln
lesbar. Der heute um 09:28 UTC beobachtete `POST /api/whatsapp/webhook` mit
HTTP 200 belegt die Verarbeitung der Statusanfrage auf Production, nicht den
ursprünglichen Cron-Aufruf. Ein lesender direkter Produktions-DB-Zugang liegt
weiterhin nicht vor. Die Abfragen der Cron-Runtime-Logs für den Morgen
lieferten keine passenden Einträge; daraus folgt kein Negativbeweis. Remote
`main` und Production waren vor dieser Änderung auf `08bb62f` (PR #24,
Deployment `dpl_GsTVfgJm1CxwGD7ahKagyUmJZqHk`, `READY`).

Der allgemeine Trendscout hat jetzt mehr eng unterscheidbare, ganzjährige
Produktideen. Vor einer Produktseiten-Abfrage liest er aktive Familien-Locks
und relevante frühere beziehungsweise offene Aufträge und überspringt
bekannt gesperrte Familien. Die verbleibenden Ideen rotieren je Berliner Tag
und Slot. Der Scout prüft pro Lauf weiterhin höchstens fünf Kandidaten; die
ASIN- und Familien-Sperre wird nach der Verifikation zusätzlich atomar bei
der Reservierung geprüft. Ein unbekannter exakter ASIN-Treffer kann die
Auswahl weiter scheitern lassen. Die Änderung startet keine zusätzliche
Suche und setzt den heutigen Claim nicht zurück. Lokal: Typprüfung, Lint,
Build und **178 Tests** bestanden, darunter ein Test mit gesperrter Familie,
Rotation zwischen zwei Slots und fünf Abfragen als Obergrenze. Ein
erfolgreicher Production-Lauf mit zwei WhatsApp-Inhaltsfreigaben ist damit
noch nicht beobachtet. Amazon-Verifikation, redaktionelles Gate und das
WhatsApp-Servicefenster bleiben Voraussetzungen; zwei Zustellungen pro Tag
sind deshalb nicht garantiert.

## Morgenlauf 30. September 2026: Prüfung um 10:48 MESZ

Remote-`main` und Production waren zu Beginn der Prüfung auf `1d23ae5`
(PR #23, Vercel-Deployment `dpl_HUNvF8HaHi5nN6rBDbqiDUr5fhgg`, `READY`).
Der Runtime-Eintrag um **08:25:30 UTC = 10:25:30 MESZ** zeigt für
`GET /api/cron/daily-draft` HTTP 200 und `daily_draft: already_claimed`.
Damit wurde der Morgen-Slot spätestens vor diesem zweiten Aufruf beansprucht.
Welcher frühere Aufruf ihn beanspruchte und welcher gespeicherte Zustand daraus
folgte, ist nicht gelesen: Die erste Ausführung liegt außerhalb der verfügbaren
Hobby-Log-Aufbewahrung; ein direkter rein lesender Datenbankzugang fehlt.
Insbesondere sind Kandidat, ASIN, Amazon-Antwort, Content-Review und
WhatsApp-Sendestatus des **heutigen** Jobs nicht belegt. Die fehlende
Inhaltsfreigabe beweist weder eine PartnerNet-Sperre noch einen WhatsApp-Fehler.
Keine unbekannten POSTs oder kostenpflichtigen Suchen zur Diagnose wiederholen.

Ein belegter struktureller Engpass im Code ist, dass der Trendscout bei einer
allgemeinen Suche bereits zwei Dauerläufer und zwei Saisonideen recherchiert
und auf Amazon prüft, der automatische Tageslauf aber bislang nur Saisonideen
übernommen hat. Sind beide gesperrt oder unverifizierbar, bleibt ein bereits
verifizierter Dauerläufer ungenutzt. Der Tageslauf bevorzugt deshalb weiterhin
Saisonideen und kann anschließend einen im **selben** Scout-Aufruf vorhandenen,
verifizierten, nicht gesperrten Dauerläufer wählen. Die atomare ASIN- und
Produktfamilien-Sperre bleibt vor der Content-Planung. Das verursacht keinen
zusätzlichen Trendscout- oder Bildprovider-Aufruf; es garantiert keinen
verifizierbaren Kandidaten und keinen WhatsApp-Versand. Der heutige Morgen-Claim
wird durch ein Deployment nicht zurückgesetzt. Der nächste planmäßige Slot
oder ein ausdrücklich neuer Betreiberauftrag ist nötig, um die Änderung live
zu beobachten.

Der Affiliate-Link wird im Projekt lokal aus der verifizierten Produkt-URL und
der bestehenden Tracking-ID zusammengesetzt. Dafür ruft es weder PartnerNet
noch eine Amazon-Link-API auf. Ein `Robot Check` oder HTTP 403 bei der
öffentlichen Produktdetailseite würde nur die Server-Abfrage blockieren; der
PartnerNet-Kontostatus lässt sich daraus nicht ableiten. Erst eine konkrete
Kontobenachrichtigung oder Anmeldung im PartnerNet würde eine Sperre belegen.

## Nachtrag 29. September 2026: gespeicherter WhatsApp-Status um 18:13 MESZ

Der Betreiber zeigte die Antwort auf `Status?` aus dem produktiven WhatsApp-Chat.
Sie nennt `2026-09-29 Vormittag · Produktsuche: needs_input (Produkt in den
letzten sieben Tagen verwendet)`. Damit ist jetzt ein gespeicherter
Vormittagsauftrag mit einem Abbruch **bei der Produktauswahl** beobachtet.
Der Status wird aus `daily_drafts` gelesen; der zugehörige Code schreibt
`product_repeat_blocked`, wenn keiner der aufgelösten Saisonkandidaten die
ASIN-/Produktfamilien-Sperre passieren kann. Diese Zuordnung zum Code ist
eine Schlussfolgerung, nicht ein gelesener Lock- oder Scout-Datensatz.
Insbesondere zeigt diese WhatsApp-Antwort weder Job-ID und konkrete Kandidaten
noch Amazon-Detailseite, ASIN und Affiliate-Link. Für den Vormittagsauftrag
ist kein Content-Plan, Review oder WhatsApp-Inhaltsfreigabe in dieser Ansicht
belegt. Der Abbruch vor `runContentJob` erklärt, warum aus diesem Auftrag
keine Inhaltsfreigabe kam. Der separate Cron-Runtime-Eintrag um 10:25:30
MESZ und der gespeicherte Vormittagsstatus passen zusammen; ohne Request-ID
oder direkte Datenbankabfrage ist ihre genaue Verknüpfung nicht unabhängig
bewiesen. Production ist inzwischen `READY` auf `90ab6c352827b36cf0d7fb2c2cf903bf068dcce7`
(PR #22, Deployment `dpl_2daYjLD7rAHtN7tZhYsKj1cKEHUo`). Die eng begrenzte
Runtime-Log-Abfrage liefert weiterhin `400 ExceedsBillingLimitError` statt
Einzelereignissen.

Die gleiche WhatsApp-Antwort zeigt einen **anderen**, auf Anfrage gestarteten
MEDION-Saugroboter-Auftrag vom 29.09. mit `needs_input`, aber ohne Abbruchgrund.
Aus der bloßen Produktbezeichnung lassen sich Verifikation, ASIN, Review und
Versand nicht ableiten. Die drei manuellen Suchen vom 28.09. stehen ausdrücklich
auf `needs_input (keine verifizierte Produktseite gefunden)`. Eine kleine
Statuskorrektur liest vorhandene redaktionelle Prüfmängel für künftige
`Status`-Antworten aus; sie startet keinen Auftrag und gibt nichts frei.
Ob der MEDION-Auftrag daran scheiterte, ist bislang unbekannt. Keine
identische Live-Suche zur Diagnose wiederholen.

Nach der Betreiberpräzisierung filtert der Trendscout vor der Ausgabe alle
bereits verifizierten Produkte heraus, deren ASIN oder eng definierte
Produktfamilie noch im Cooldown liegt. Die Prüfung verwendet dieselben
gespeicherten Locks, offenen Aufträge und Veröffentlichungszeiten wie die
endgültige, gegen Parallelität gesicherte Reservierung. Sind alle Treffer
gesperrt, entsteht kein Content-Plan und der Tagesauftrag erhält
`product_repeat_blocked`; es wird keine zusätzliche Live-Suche gestartet.
Unverifizierte Suchideen werden dadurch nicht als verifizierte Produkte
ausgegeben. Die lokale Prüfung belegt dieses Verhalten, noch keinen
erfolgreichen folgenden Production-Lauf.

## Morgenlauf 29. September 2026: lesende Nachprüfung um 12:19 MESZ

Remote-`main` und Vercel Production stehen auf
`e9df9d9b0515dd616d5248a914f77a4bedb192c3` (PR #21); das Deployment
`dpl_4dZLdhpq7SvDZFP5DHB1L9LpY3wu` ist `READY`. Vercels gruppierte
Runtime-Fehler zeigen für `/api/cron/daily-draft` einen Eintrag vom
29.09. um **08:25:30 UTC = 10:25:30 MESZ**. Der Eintrag enthält nur die
`pg`-Warnung zum SSL-Modus. Das belegt eine Invocation der Cron-Route und
Postgres-Initialisierung, aber weder den Tages-Claim noch ein erfolgreiches
Pipeline-Ergebnis. Die Route würde um diese Berliner Uhrzeit `morning`
zuordnen; das ist eine Schlussfolgerung aus dem deployten Code, kein gelesener
Datenbankwert.

Die Vercel-Runtime-Log-Abfrage scheitert sogar für das enge Fenster
08:20–08:31 UTC mit `400 ExceedsBillingLimitError`. Breitere Abfragen
lieferten „No logs found“, können wegen dieses Limits aber nicht als
Negativbeweis verwendet werden. Ein direkter lesender Produktions-DB-Zugang
liegt nicht vor. Der authentifizierte GET `/api/operations` wurde bewusst
nicht verwendet, da er bei fehlendem Schema Migrationen ausführen kann.

Deshalb bleiben für genau diesen Morgenlauf **unbekannt**: `(day,slot)`-Claim
und Job-ID, Produktkandidat, live verifizierte Amazon-Detailseite und ASIN,
Affiliate-Link, Content-Plan, redaktionelles Review, WhatsApp-Sendestatus
und gegebenenfalls die Abbruchstufe. Weder ein Erfolg noch ein Fehler der
Produkt- oder WhatsApp-Pipeline ist damit belegt. Keine Live-Suche und keinen
POST nur zur Diagnose wiederholen. Zur weiteren Prüfung ist ein tatsächlich
lesender Datenbankauszug oder der gespeicherte Tagesauftrag im
authentifizierten Content Studio nötig; bei einem Versandfehler zusätzlich
der konkrete Versandstatus. Änderungen an Amazon, Meta oder Modell sind aus
den bisher sichtbaren Daten nicht gerechtfertigt.

## WhatsApp-Modellwechsel am 29. September 2026

Der gebundene WhatsApp-Änderungsparser und der Video-Änderungsparser verwenden
`openai/gpt-5.6-terra` über den vorhandenen Replicate-Zugang. Das redaktionelle
Modell für neue Content-Pläne bleibt separat `openai/gpt-4.1`. Für die neuen
WhatsApp-Aufrufe gelten `reasoning_effort=none` und `verbosity=low` statt des
alten `temperature`-Parameters. Die maximale Antwortlänge bleibt auf 1.200
bzw. 3.000 Tokens begrenzt. Es gibt weiterhin genau einen Prediction-POST je
Betreibernachricht, ohne automatischen Ersatzaufruf bei unklarem Ergebnis.
Wörtliche Freigaben umgehen das Modell; Produktidentität, redaktionelle Prüfung
und getrennte Freigaben bleiben technische Gates. Ein Modellwechsel macht
aus dem Parser keinen allgemeinen WhatsApp-Chatbot.

Replicate nennt [für Terra](https://replicate.com/openai/gpt-5.6-terra)
$2,50/Mio. Eingabetokens und $15/Mio. Ausgabetokens. Das Rechenbeispiel aus
dem folgenden Abschnitt (2.000/500 Tokens) ergibt etwa **$0,0125** statt
$0,008 mit GPT-4.1, ohne WhatsApp-Gebühren und Steuern. Das tatsächliche
Ergebnis und der Verbrauch eines echten Aufrufs sind noch nicht live geprüft;
lokale Tests mit simulierten Providerantworten prüfen nur API-Payload,
Produktbindung, Ablehnung unsicherer Antworten und erneute Inhaltsfreigabe.

## Live-Prüfung 29. September 2026, 01:25 Uhr MESZ

`main` wurde erneut am Remote geprüft: `6363b89f5e8f92e76c859bfa0302c97fbc1290d2`
(Merge von PR #19). Vercel meldet für das Production-Deployment
`dpl_2pH8MuGhYvDWaxqjDfi9R59DGoFw` **READY**; die produktive Domain
`affiliate-reel-agent.vercel.app` ist ihm zugeordnet. Das eingecheckte
`vercel.json` enthält die vier Tages-Crons um 07:00/08:00 und 16:00/17:00 UTC.
Die Route ordnet nur 09:00–10:59 und 18:00–19:59 Berliner Zeit zu;
`daily_drafts` beansprucht `(day,slot)` eindeutig. Die Vercel-Projektansicht
belegt den Deployment-Zustand, nicht die Ausführung eines zukünftigen Cron-Laufs.

Bis zu dieser Prüfung gab es im neuen Deployment keine Runtime-Einträge. Der
erste Morgenlauf nach PR #19 hatte noch nicht stattgefunden. Deshalb sind für
ihn weder Kandidat, aktuelle Amazon-Detailseite und ASIN, Affiliate-Link,
Content-Plan und Review noch WhatsApp-Versand belegt. Ein ausbleibender
WhatsApp-Eingang allein unterscheidet Produktauflösung, Review-Fehler,
Servicefenster und Versandfehler nicht. Nach dem Lauf zuerst Runtime-Logs
(`daily_draft`, `amazon_resolution`, `reference_image_fallback`, Fehlerstufe)
und gespeicherte `daily_drafts`, `content_jobs` und Versand-IDs abgleichen.
Unklare POST-Ergebnisse nicht erneut anstoßen.

Die letzten beobachteten Saugroboter-Live-Probleme stammen aus einem älteren
Deployment. PR #18 verbessert die KI-Prüfgründe und protokolliert den
Referenz-Fallback; PR #19 bringt den konkreten Saugroboter-Referenzentwurf
und natürlichere WhatsApp-Textvorschläge. Ein lokaler Lauf auf aktuellem
`main` bestand Typprüfung, Lint, **172 Tests** und Production-Build, darunter
abgelehnter KI-Bildentwurf, geprüfter Saugroboter-Referenzentwurf,
Produktbindung, Textrevision und erneute Freigabe. Das ist kein Beweis für
einen erfolgreichen Live-Such-, Amazon- oder WhatsApp-Durchlauf. Die ältere
Angabe „173 Tests“ beschreibt nicht diesen aktuellen lokalen Testlauf.

Ein authentifizierter GET auf `/api/operations` ist derzeit keine garantiert
rein lesende Datenbankprüfung: `getOperationsSnapshot` ruft
`ensureAutomationSchema` auf und kann fehlende Migrationen anwenden. Deshalb
wurde diese Route für die hier ausdrücklich lesende Prüfung nicht aufgerufen;
ein direkter lesender Datenbankzugang lag nicht vor. Schema-Zustand, konkrete
Tageszeile und WhatsApp-Message-ID sind damit noch nicht unabhängig bestätigt.
Die gruppierten Vercel-Fehler zeigen bislang nur eine `pg`-SSL-Moduswarnung
aus älteren Deployments; sie erklärt keinen erfolgreichen oder gescheiterten
Morgenlauf.

### WhatsApp-Sprachdialog: Aufwand und laufende Kosten

Zum Zeitpunkt dieser Prüfung verarbeitete der Parser gebundene Änderungswünsche
mit genau einem Replicate-Aufruf von `openai/gpt-4.1`. Eindeutige Freigaben und Ablehnungen
bleiben wörtliche Befehle; der Parser darf weder Produkt/ASIN/content_id
wechseln noch eine Veröffentlichung auslösen. Die Tests belegen, dass ein
natürlicher Textvorschlag den Affiliate-Hinweis und eine neue Inhaltsfreigabe
erhält. Sie belegen keine beliebige Mehrturn-Konversation im Live-Betrieb.

Ein vollwertiger Dialog bräuchte klar benannte Befehle (Status,
Artikelsuche, Entwurf ändern, Rückfrage zum gebundenen Produkt, Abbruch),
eine eindeutige Zuordnung bei mehreren offenen Aufträgen, begrenzte
Gesprächshistorie und einen reinen Leseweg für Status. Alle schreibenden
Aktionen müssten über dieselben Produkt- und WhatsApp-Gates laufen;
Bildkauf, Post und Modellwechsel dürfen nicht aus einer freien Antwort folgen.
Für offene Fragen zu Produkten wären verifizierte Quellen und eine
Nichtwissen-Antwort nötig. Ein Modellwechsel allein behebt weder Amazon-
Verifikation noch Cron-/Servicefensterprobleme.

Replicate listet für GPT-4.1 **$2 je Mio. Eingabetokens und $8 je Mio.
Ausgabetokens**; GPT-4.1 mini kostet $0,40/$1,60, nano $0,10/$0,40.
Ein **Rechenbeispiel** von 2.000 Eingabe- und 500 Ausgabetokens kostet damit
etwa $0,008 / $0,0016 / $0,0004 pro Modellantwort, vor Steuern und ohne
WhatsApp-Gebühren. Der tatsächliche Kontext des Projekts kann größer sein;
Tokenverbrauch, Qualität und Fehlerrate müssen vor einer Umstellung gemessen
werden. Ein regelbasierter Befehl kostet keinen zusätzlichen Modellaufruf.
Preise: [GPT-4.1](https://replicate.com/openai/gpt-4.1),
[mini](https://replicate.com/openai/gpt-4.1-mini),
[nano](https://replicate.com/openai/gpt-4.1-nano).
Meta kündigt außerdem ab **1. Oktober 2026** eine Abrechnung für
Service-Nachrichten an; die künftigen länder- und kategorienabhängigen
WhatsApp-Kosten sind hier nicht beziffert. Keine Business-Vorlage aktivieren
oder anderes Modell produktiv schalten, bevor Kosten und Verhalten konkret
geprüft sind: [Meta-Preise](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing),
[Service-Nachrichten](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages).

## Stand 29. September 2026

Production ist inzwischen mit den Änderungen aus PR #12–#19 auf `main` deployed. Der
Meta-Webhook wurde auf `https://affiliate-reel-agent.vercel.app/api/whatsapp/webhook`
verifiziert; eine `Status`-Nachricht und mehrere gezielte Artikelsuchen wurden
in Production angenommen und beantwortet. Der erste produktive Morgen- und
Abendlauf mit dem neuen Zeitplan steht noch aus. Das ist kein Nachweis für eine
automatische WhatsApp-Zustellung zu einer bestimmten Minute.

Die Suche `Artikelsuche Saugroboter` am 29.09. um 00:30 Uhr lokaler Zeit kam
nach der Korrektur des `Robot`-Titelfilters über die Produktauflösung hinaus,
endete aber bei der redaktionellen Bildprüfung mit `content_review_failed`.
Die WhatsApp-Antwort zeigte positive Szenenbeschreibungen als Prüfmängel.
PR #18 verlangt echte Mängel mit Korrekturen vom KI-Prüfer und zeichnet einen
gescheiterten regelbasierten Ersatzentwurf ohne Kundendaten auf. Ob der nächste
echte Auftrag die vollständige Inhaltsfreigabe erreicht, ist offen. Kein Bild
wurde für diesen Versuch erzeugt oder veröffentlicht; redaktionelle Modellaufrufe
können Guthaben beansprucht haben. Weitere identische Live-Suchen nicht nur
für Diagnostik auslösen.

Der Tages-Cron hat vier einzelne, jeweils einmal täglich geplante UTC-Aufrufe:
07:00, 08:00, 16:00 und 17:00. Die Route nimmt einen Morgenlauf nur zwischen
09:00 und 10:59 Uhr deutscher Zeit und einen Abendlauf nur zwischen 18:00 und
19:59 Uhr an. Der eindeutige Datenbank-Claim verhindert doppelte Aufträge.
Diese Anordnung deckt Sommer- und Winterzeit ab und ist mit der
Einmal-pro-Tag-Grenze je Cron-Eintrag im Vercel-Hobby-Plan vereinbar. Hobby
garantiert den Aufruf nur innerhalb der geplanten Stunde, nicht minutengenau.
Eine WhatsApp um exakt 09:00 oder 18:00 ist damit nicht zugesichert.

Der Content-Claim prüft jetzt den tatsächlichen Primärschlüssel auf
`(day,slot)`. Die Migrationen 019 und 020 reparieren den Schlüssel bei Bedarf
und reservieren ASINs sowie eng definierte Produktfamilien sieben Tage lang,
bevor eine kostenpflichtige Planung beginnen kann. Die Freigabe für einen
Facebook-Bildpost zeigt die vollständige geplante Veröffentlichungscaption.
Außerhalb des WhatsApp-Servicefensters bleibt ohne ausdrücklich aktivierte,
genehmigte Business-Vorlage der Entwurf gespeichert und es kommt keine
automatische WhatsApp. Eine solche Vorlage kann Gebühren verursachen.

Die Migrationen 019/020 wurden bei produktiven Status- und Suchaufrufen über
`ensureAutomationSchema` geprüft oder angewendet. Die Zustellung von `Status`
und von Fehlerantworten ist belegt; eine komplette Bild- und
Veröffentlichungsfreigabe aus dem neuen täglichen Ablauf wurde noch nicht
nachgewiesen.

## Änderung vom 27. September 2026

Die bisherige Datums-Einmalgrenze wurde durch `(day,slot)` ersetzt (Migration
`016_multiple_drafts.sql`). Geplant sind jetzt zwei kostenlose **Bildentwürfe**
pro Tag um 07:00 und 16:00 UTC. Der Vercel-Header `x-vercel-cron-schedule`
bestimmt den Slot, damit verzögerte Zustellung keine Zuordnung ändert. Vercel
Cron läuft nur in Production; beide Jobs sind gegen wiederholte Anrufe
eindeutig geschützt. Die beiden Zeiten sind UTC und verschieben sich relativ
zur Berliner Sommer-/Winterzeit. Auch der Button für zusätzliche Entwürfe
legt jedes Mal einen neuen Auftrag an. Es gibt keine Tagesobergrenze.

Eine WhatsApp-Nachricht **`Bildpost`** an die konfigurierte Business-Nummer
startet eine zusätzliche saisonale Bildplanung. **`Bildpost B0D9YQR9CT`**
oder **`Bildpost https://www.amazon.de/dp/B0D9YQR9CT`** wählt ein konkretes
Produkt; der Orchestrator bindet erst nach Prüfung des genauen Amazon-Titels
einen Affiliate-Link an dieselbe ASIN. Jeder Start ist an Absender und
Message-ID gebunden, sodass Meta-Zweitzustellungen keinen zweiten Auftrag
auslösen. Der Befehl darf nicht als Antwort auf eine Freigabenachricht stehen.
Auch eine eigenständige Nachricht **`Artikelsuche`**, **`Neue Artikelsuche`**, **`Neue Produktsuche`**
oder **`Such mir einen neuen Artikel`** startet eine neue TrendScout-Suche;
diese eindeutigen Befehle brauchen keinen Sprachmodellaufruf. Eine Suche kann
am selben Tag erneut denselben Produktkandidaten finden. Eine neue eigenständige
Suche bezieht sich nicht auf zuvor freigegebene oder erledigte Aufträge;
Antworten auf alte Freigabe- und Story-Nachrichten bleiben dagegen bei ihrem
jeweiligen Auftrag.
Bei einer allgemeinen manuellen Artikelsuche berücksichtigt der Trendscout
verifizierte Dauerläufer und aktuelle Suchsignale ebenso wie Saisonideen.
Die automatischen Tageszeiten nutzen weiterhin saisonale Kandidaten.
Ohne verifizierbare Amazon-Produktseite wird keine redaktionelle Planung gestartet.
Ein indexierter Suchtreffer genügt nicht mehr als Nachweis: Die aktuelle
Amazon-Detailseite muss direkt abrufbar sein, zur selben ASIN gehören und
einen erkennbaren Produkttitel enthalten. Tote Seiten, Captchas und nicht
lesbare Antworten halten die Planung an. Ein früherer Suchtreffer wird nur
nach erneuter Liveprüfung wiederverwendet. Der am 27.09.2026 gemeldete
nicht funktionierende Link zu B0G2XQPG3N ist auch für bestehende Freigaben
gesperrt. Bis eine verlässliche Produktschnittstelle eingerichtet ist,
können Amazons automatisierte Zugriffssperren legitime Artikel anhalten;
in diesem Fall wird kein Bild gekauft.
Schlägt das redaktionelle Sprachmodell später fehl, nennt WhatsApp diesen Schritt
statt pauschal eine fehlende ASIN; der gescheiterte Auftrag wird nicht automatisch
wiederholt und löst keine Bildgenerierung aus.
Replicate-Anfragen innerhalb desselben redaktionellen Plans werden zeitlich
abgestuft. Nur bei einer ausdrücklich abgelehnten HTTP-429-Antwort wartet der
Generator begrenzt und versucht den abgelehnten Aufruf genau einmal erneut.
Nach erfolgreicher Planung folgen weiterhin Inhaltsfreigabe, Bildproduktion
und separate Veröffentlichungsfreigabe. Bei erneutem Limit endet der Auftrag
ohne Veröffentlichung; unklare oder erfolgreiche POST-Ergebnisse werden nicht
erneut abgesendet.
Wenn ein KI-Bildentwurf auch nach zwei Revisionen die redaktionelle Prüfung
nicht besteht, erstellt der Orchestrator einen neuen Referenzentwurf aus
regelbasierten Ideen. Dieser muss die strukturelle und produktspezifische
Prüfung bestehen, bevor er als Referenzentwurf per WhatsApp zur Inhaltsfreigabe
kommt. Der verworfene KI-Text wird nicht übernommen. Scheitert auch die
Referenzprüfung, nennt WhatsApp die konkreten Prüfpunkte; kein Bild wird gekauft.
Mit **`Artikelsuche Saugroboter`** oder **`Artikelsuche Produktname Saugroboter`**
gibt der Betreiber dagegen eine Produktart vor. Der Trendscout recherchiert
gezielt dazu; erst eine zu diesem Suchbegriff passende und verifizierte
Amazon-Produktdetailseite darf in einen neuen Facebook-Bildentwurf übernommen
werden. Fehlt ein belegbarer Treffer, erhält der Betreiber eine WhatsApp mit
der Bitte um genaueren Produktnamen oder ASIN. Ein saisonales Ersatzprodukt
wird nicht eingesetzt. Auch ein solcher Entwurf braucht weiterhin beide
WhatsApp-Freigaben vor Bildgenerierung und Veröffentlichung.
Bei mehreren offenen Freigaben immer direkt auf die betreffende WhatsApp
antworten. Änderungswünsche bleiben bis zur ausdrücklichen Freigabe möglich.

**Lernen aus Korrekturen:** Erst nach der ausdrücklichen Freigabe einer
überarbeiteten Fassung werden WhatsApp-Korrekturen aus Bildpost- und
Content-Studio-Freigaben als Beispiele gespeichert (`013_operator_language_examples.sql`,
`018_approved_editorial_feedback.sql`). Für neue Pläne werden passende und
aktuelle Beispiele ausgewählt (höchstens zwölf pro Auftrag), nicht frühere
Produktmerkmale oder Links übernommen. Sobald bestätigte Beispiele und ein
Replicate-Token vorhanden sind, erstellt die redaktionelle Planung mit
`openai/gpt-4.1` daraus passende Regeln für Ideen, Texte und Bildbriefings:
höchstens acht kostenpflichtige Modellaufrufe pro Plan, keine zweite Anfrage
bei unklarem Resultat. Ohne diese Voraussetzungen bleibt der Referenzmodus.
Die Bilddatei selbst wird noch nicht automatisch visuell auf Fehler geprüft;
deshalb ist das fertige Bild weiterhin in der zweiten WhatsApp zu kontrollieren.

Bei einem natürlichen Textänderungswunsch kann der bestehende Replicate-Parser
in seiner einen Modellanfrage jetzt zusätzlich einen konkreten Hook und eine
Caption für das gebundene Produkt vorschlagen. Neue Links, ASINs, ein
`Werbung`-Hook und eine Caption ohne Affiliate-Provisionshinweis werden
abgelehnt. Die Prüfung von Bildszene, redaktionellen Mindestregeln und
Kürbisschnitzkontext gilt auch für diesen Revisionsweg. Danach kommt eine
neue Inhaltsfreigabe; ein Modellvorschlag ist niemals selbst eine Freigabe.
Das ist eine erweiterte Änderungsverarbeitung mit `openai/gpt-4.1` auf dem
vorhandenen Replicate-Zugang, noch kein allgemeiner WhatsApp-Chatbot. Ein
anderes Modell ist nicht ohne nachgewiesene API-Kompatibilität, Kostenkontrolle
und Verhaltenstest produktiv aktiviert.

**Zwei WhatsApp-Entscheidungen pro Bildpost:** Zuerst wird der Bildentwurf samt
Hinweis auf die noch nicht bezifferte Bildgenerierung freigegeben; nur danach
wird ein Originalbild hergestellt. Zweitens kommt das konkrete Bild mit
Facebook-Caption zur Veröffentlichungsfreigabe. In der Facebook-Caption steht
der eindeutige Affiliate-Produktlink direkt am Anfang. Bis zur zweiten Freigabe
ist nichts veröffentlicht. Unbekannte Providerergebnisse werden niemals
blind wiederholt. Ohne WhatsApp-Servicefenster wird eine zuvor ausdrücklich
aktivierte Benachrichtigungsvorlage benötigt; andernfalls wartet der Entwurf
gespeichert. Eine Vorlage kann zusätzliche WhatsApp-Gebühren verursachen.

Nach erfolgreichem Facebook-Post wird einmalig eine WhatsApp mit dem bereits
genehmigten Bild und der Produkt-URL für **Facebook- und Instagram-Stories**
geschickt (`017_story_handoffs.sql`). Link-Sticker lassen sich über die
Instagram-Publishing-API nicht setzen; für die Facebook-Story-API gibt es
ebenfalls keinen hier verifizierten Link-Sticker-Parameter. Deshalb werden
Stories nicht ohne klickbaren Link automatisch online gestellt: Der Betreiber
lädt das Bild in beiden Apps als Story hoch, setzt dort jeweils den Link-Sticker,
prüft das Ziel und veröffentlicht selbst. Die Story erzeugt kein weiteres Bild.
`Status` zeigt die letzten fünf Bildaufträge samt Facebook-Status und danach
den letzten Reel-Status.

**Inbetriebnahme:** Die beiden neuen Migrationen vor dem produktiven Deploy
ausführen, wenn ein geschützter Migrationszugang vorhanden ist. Andernfalls
prüfen die ersten neuen Tages-/Story-/Statusaufrufe das Schema und wenden die
transaktional gesperrten Migrationen 001–020 selbst an; erst danach starten
Suche oder WhatsApp-Versand. Cron/WhatsApp/Bildprovider in der tatsächlichen
Vercel-Production prüfen. Eine Codeänderung ohne Production-Deployment startet
keinen Cron und versendet keine produktionsseitige WhatsApp. Die folgenden älteren Abschnitte dokumentieren
den ursprünglichen Einmal-pro-Tag-Stand und gelten nur als historische Notiz.

Stand: 24. September 2026.

## Automatischer Teil

Production-Cron `/api/cron/daily-draft` startet täglich um 07:00 UTC. Er benötigt
`CRON_SECRET`, `DATABASE_URL`, `CONTENT_STUDIO_PASSWORD`, `TAVILY_API_KEY` und
die bereits eingerichteten WhatsApp-Sendevariablen. Die Migration
`004_daily_drafts.sql`, `005_publication_gate.sql` und
`006_daily_notification.sql` müssen vorher in Production über die geschützte Route
angewendet werden. Vercel-Cron läuft nicht auf Preview; dort nur mit einem
autorisierten, ausdrücklich gewollten Aufruf prüfen.

Ein persistenter Tages-Claim verhindert zweite Recherche und zweiten Versand
auch nach einem unklaren Netzwerkresultat. Der vorhandene Scout recherchiert
aktuelle Websignale und Saisonkandidaten. Für den Content-Job wird eine
saisonale **Amazon-Suchauswahl** verwendet, solange kein konkretes Produkt samt
Eigenschaftsnachweisen vorliegt. Der vorhandene Content-Orchestrator entwickelt
einen Entwurf für Facebook mit Budget `low`: ohne bestätigte Korrekturen im
kostenlosen Referenzmodus, andernfalls bei konfiguriertem Replicate-Token im
kostenpflichtigen KI-Modus. Der Tageslauf
begrenzt die Formatwahl auf `image`, weil nur dafür ein überprüftes Original-Visual
und ein Facebook-Publishing-Weg existieren; ein nicht freigabefähiger Bildentwurf
stoppt vor der WhatsApp-Freigabe. Der Job und
das Scout-Ergebnis werden in Postgres gespeichert. Eine Content-Freigabe per
WhatsApp mit Auszug und Job-ID wird ausschließlich dann einmalig gesendet, wenn die
Approver-ID innerhalb der letzten 24 Stunden eine Nachricht an die API gesendet
hat. Für tägliche initiierte Nachrichten außerhalb dieses Fensters ist eine
separate, ausdrücklich aktivierte WhatsApp-Vorlage vorbereitet. Ohne genehmigte
Vorlage und geklärte Nachrichtengebühren wartet der Entwurf weiterhin gespeichert
im Content Studio. Die Vorlage ist **nur eine Benachrichtigung**. Auf sie kann
kein Content freigegeben werden. Erst die Antwort `Entwurf` löst im geöffneten
Servicefenster eine zweite Nachricht mit Produkt, Inhalt und eigener
Content-Freigabe aus. Ein vorzeitiges `Freigeben` auf die Benachrichtigung
wird ignoriert. Jeder Versand hat einen dauerhaften Claim vor dem Netzwerkaufruf;
unklare Ergebnisse werden nicht erneut gesendet.
Eine ausdrückliche erste Antwort genehmigt nur den Content-Plan. Für einen
freigabefähigen **Bildentwurf** erzeugt der konfigurierte Bildprovider genau
ein Originalbild und legt es in Vercel Blob ab. Erst danach legt das System eine
Publication Request an und schickt eine **zweite** WhatsApp zur finalen
Freigabe des Facebook-Posts. Reine Textentwürfe ohne Original-Visual bleiben
gesperrt. Ohne `REPLICATE_API_TOKEN` oder `OPENAI_API_KEY` stoppt dieser Schritt;
für Replicate sind die Migrationen `009_original_visual_attempts.sql` und
`010_replicate_visual_provider.sql` nötig. Die ursprüngliche Textkarte ist nie publishbar.

### Vorlage erst nach Kostenentscheidung aktivieren

Im Meta WhatsApp Manager eine **reine Textvorlage ohne Platzhalter oder Buttons**
zur Freigabe einreichen, etwa:

> Ein neuer Tagesentwurf für deine private Content-Planung ist bereit. Antworte
> auf diese Nachricht mit „Entwurf“, um den vollständigen Entwurf zu erhalten.
> Erst danach kannst du den Inhalt und separat die Veröffentlichung freigeben.

Meta entscheidet über die Kategorie und Genehmigung. Vor der Aktivierung die
im eigenen WhatsApp Manager für Empfängerland und Kategorie angezeigten Kosten
und die wiederkehrende Nutzung mit dem Betreiber klären. Die Anwendung liest
keinen verbindlichen Live-Tarif und behauptet keinen festen Betrag. Nach
Genehmigung den **exakten** Vorlagennamen und Sprachcode serverseitig als
`WHATSAPP_DAILY_TEMPLATE_NAME` und `WHATSAPP_DAILY_TEMPLATE_LANGUAGE` eintragen,
zum Beispiel `de`. Ausschließlich nach Kostenfreigabe
`WHATSAPP_DAILY_TEMPLATE_ENABLED=true` setzen und neu deployen. Vorher ist
diese Funktion aus. Preview und Production getrennt konfigurieren. Keine Vorlage
mit einem „Freigeben“-Button verwenden; der Text muss zum beschriebenen
zweistufigen Dialog passen. Das erste kostenpflichtige Senden ist ein eigener
bewusster Betriebsschritt.

## Tageslauf und echte Ergebnisse

Im Content Studio zeigt „Tageslauf & Ergebnisse“ die letzten 14 Tagesjobs,
bestätigte WhatsApp-Nachrichten, Freigabe- und Veröffentlichungsstatus sowie
die letzten 20 veröffentlichten Posts mit dem jeweils neuesten Messstand.
Ein fehlender Messstand erscheint als **unbekannt**, nicht als null Klicks.
Klicks, Verkäufe und Provisionen werden derzeit über das bestehende
Leistungsformular am jeweiligen Job mit Quellenbezeichnung eingetragen;
Amazon PartnerNet wird nicht automatisch ausgelesen. PartnerNet-Berichte
können als belegte Quelle für die Eingabe dienen. Die Wochenbilanz erscheint
montags nach dem separaten Cron und enthält ausschließlich gespeicherte
Messwerte und gegebenenfalls aus Meta gelesene Followerzahlen. Ohne
PartnerNet-Messstand meldet sie unbekannte Ergebnisse ausdrücklich.

Der Facebook-Fotopost wird nach der zweiten eindeutigen WhatsApp-Freigabe
genau einmal angefordert und in `publications` gespeichert. Bei unklarem
Meta-Ergebnis bleibt der Lauf gesperrt. Instagram ist noch nicht integriert.
Der tägliche Entwurf ist keine Zusage für einen täglich sichtbaren Post.

**Inbetriebnahme:** Der aktuelle Arbeitsbranch und seine Preview starten
keinen Vercel-Cron. Vor dem ersten produktiven Morgenlauf müssen die
Freigaben für Production erfolgen, die noch fehlenden Migrationen geschützt
angewendet, `CRON_SECRET` sowie alle benötigten Servervariablen geprüft und
die gewünschte tägliche WhatsApp-Vorlage im eigenen Meta-Konto genehmigt und
bewusst aktiviert werden. Ein Kontrolllauf sollte Tagesjob,
Benachrichtigung, beide getrennten Freigaben und schließlich einen einzigen
Post mit Permalink belegen. Keine bereits beanspruchten Tagesdaten neu
auslösen. Der Cron ist auf 07:00 UTC eingestellt (09:00 Uhr MESZ, 08:00 Uhr
MEZ); eine Zustellung vor 11 Uhr ist abhängig von Laufzeit und externen
Diensten und keine harte Garantie.

Die Migrationen 001–006 waren im Preview angewendet; 006 wurde am 24.09.2026
um 08:31:54 UTC über den geschützten Migrationsweg angewendet, Wiederholungen
meldeten ausschließlich `alreadyApplied` (siehe [VERIFICATION.md](VERIFICATION.md)).
Der Blob-Token ist vorhanden und
die Meta-Verbindung wurde lesend geprüft. Die Facebook-Schreibberechtigung
und der vollständige WhatsApp-/Meta-Durchlauf sind damit noch nicht bewiesen.
Vor autonomen täglichen Benachrichtigungen die genehmigte WhatsApp-Vorlage,
Kategorie samt Gebühren klären und sämtliche benötigten Migrationen in
Production bestätigen. Der Scout wählt saisonale Suchauswahlen, noch keine
verifizierten Einzelprodukte. Natürliche Änderungswünsche für Bild-/Textbeiträge
werden gespeichert, führen zu einer neuen redaktionellen Revision und sperren
die alte Freigabe. Instagram erfordert einen separaten
Container-/Publish-Ablauf und eigene Prüfung der externen Bild-URL.

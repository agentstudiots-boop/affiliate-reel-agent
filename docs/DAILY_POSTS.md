# Tägliche Entwürfe und Veröffentlichung

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
einen kostenlosen Referenzentwurf für Facebook mit Budget `low`; der Job und
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
Eine ausdrückliche erste Antwort genehmigt nur den Content-Plan. Das System
bereitet danach eine originale Textgrafik vor und schickt eine **zweite**
WhatsApp-Nachricht zur finalen Freigabe des Facebook-Posts.

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

## Noch offen

Eine eigene typografische PNG-Grafik wird über Vercel Blob öffentlich gehostet;
sie zeigt keine konkreten Produkteigenschaften. Der Facebook-Fotopost wird
nach der zweiten eindeutigen WhatsApp-Freigabe genau einmal angefordert und
in `publications` gespeichert. Bei unklarem Meta-Ergebnis bleibt der Lauf
gesperrt. Instagram ist noch nicht integriert. Der tägliche Entwurf ist darum
noch keine Zusage für einen täglichen sichtbaren Post.

Die Migrationen 001–006 sind im Preview angewendet; 006 wurde am 24.09.2026
um 08:31:54 UTC über den geschützten Migrationsweg angewendet, Wiederholungen
meldeten ausschließlich `alreadyApplied` (siehe [VERIFICATION.md](VERIFICATION.md)).
Der Blob-Token ist vorhanden und
die Meta-Verbindung wurde lesend geprüft. Die Facebook-Schreibberechtigung
und der vollständige WhatsApp-/Meta-Durchlauf sind damit noch nicht bewiesen.
Vor autonomen täglichen Benachrichtigungen die genehmigte WhatsApp-Vorlage,
Kategorie samt Gebühren klären und Migration 006 auch in Production bestätigen. Der Scout wählt saisonale Suchauswahlen, noch
keine verifizierten Einzelprodukte. Natürliche Änderungswünsche für
Bild-/Textbeiträge werden
gespeichert und sperren den Post; eine neue Revision durch die Spezialagenten
ist noch nicht implementiert. Instagram erfordert einen separaten
Container-/Publish-Ablauf und eigene Prüfung der externen Bild-URL.

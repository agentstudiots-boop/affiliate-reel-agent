# Tägliche Entwürfe und Veröffentlichung

Stand: 23. September 2026.

## Automatischer Teil

Production-Cron `/api/cron/daily-draft` startet täglich um 07:00 UTC. Er benötigt
`CRON_SECRET`, `DATABASE_URL`, `CONTENT_STUDIO_PASSWORD`, `TAVILY_API_KEY` und
die bereits eingerichteten WhatsApp-Sendevariablen. Die Migration
`004_daily_drafts.sql` muss vorher in Production über die geschützte Route
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
hat. Für tägliche initiierte Nachrichten außerhalb dieses Fensters muss zunächst
eine genehmigte WhatsApp-Vorlage einschließlich der möglichen Nachrichtengebühren
eingerichtet werden. Ohne Vorlage wartet der Entwurf gespeichert im Content Studio.
Eine ausdrückliche erste Antwort genehmigt nur den Content-Plan. Das System
bereitet danach eine originale Textgrafik vor und schickt eine **zweite**
WhatsApp-Nachricht zur finalen Freigabe des Facebook-Posts.

## Noch offen

Eine eigene typografische PNG-Grafik wird über Vercel Blob öffentlich gehostet;
sie zeigt keine konkreten Produkteigenschaften. Der Facebook-Fotopost wird
nach der zweiten eindeutigen WhatsApp-Freigabe genau einmal angefordert und
in `publications` gespeichert. Bei unklarem Meta-Ergebnis bleibt der Lauf
gesperrt. Instagram ist noch nicht integriert. Der tägliche Entwurf ist darum
noch keine Zusage für einen täglichen sichtbaren Post.

Die Migration 005 ist im Preview angewendet; der Blob-Token ist vorhanden und
die Meta-Verbindung wurde lesend geprüft. Die Facebook-Schreibberechtigung
und der vollständige WhatsApp-/Meta-Durchlauf sind damit noch nicht bewiesen.
Vor autonomen täglichen Benachrichtigungen die genehmigte WhatsApp-Vorlage,
Kategorie samt Gebühren klären. Der Scout wählt saisonale Suchauswahlen, noch
keine verifizierten Einzelprodukte. Natürliche Änderungswünsche für
Bild-/Textbeiträge werden
gespeichert und sperren den Post; eine neue Revision durch die Spezialagenten
ist noch nicht implementiert. Instagram erfordert einen separaten
Container-/Publish-Ablauf und eigene Prüfung der externen Bild-URL.

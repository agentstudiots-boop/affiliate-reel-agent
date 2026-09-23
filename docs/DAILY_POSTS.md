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
das Scout-Ergebnis werden in Postgres gespeichert. Eine freie WhatsApp-Nachricht
mit Auszug und Job-ID wird ausschließlich dann einmalig gesendet, wenn die
Approver-ID innerhalb der letzten 24 Stunden eine Nachricht an die API gesendet
hat. Für tägliche initiierte Nachrichten außerhalb dieses Fensters muss zunächst
eine genehmigte WhatsApp-Vorlage einschließlich der möglichen Nachrichtengebühren
eingerichtet werden. Ohne Vorlage wartet der Entwurf gespeichert im Content Studio.

## Noch offen

Es existiert noch kein fertiges Bild: Der Bild-Agent liefert lediglich Layout
und Prompt. Es gibt noch keine schreibende Meta-Publishing-Integration. Weder
die WhatsApp-Nachricht noch die Content-Freigabe veröffentlichen einen Beitrag.
Der tägliche Entwurf ist darum keine Zusage für einen täglichen sichtbaren Post.

Vor automatischem Publishing: ein rechtmäßig nutzbares Bild erzeugen/hosten,
den konkreten Produktlink und die Aussagen prüfen, einen getrennten persistenten
WhatsApp-Publish-Gate mit eindeutiger Zuordnung zu Beitrag und Plattform bauen,
Meta-Schreibberechtigungen prüfen und POST-Claims vor jedem externen Schreibaufruf
persistieren. Instagram erfordert ein öffentlich erreichbares Bild und einen
separaten Container-/Publish-Ablauf. Bei unklarem Meta-Ergebnis keine zweite
Veröffentlichung auslösen.

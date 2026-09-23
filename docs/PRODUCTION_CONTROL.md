# Produktions- und Freigabekreislauf

Stand: 23. September 2026.

## Renderer

Runway bleibt erhalten. Faceless ist als zusätzlicher serverseitiger Provider
über `FACELESS_API_KEY` angebunden. Verwendet werden ausschließlich die laut
offizieller API verfügbaren Modelle `storyboard`, `motion_lite` und
`motion_pro`. Modelle und Credit-Kosten werden vor jeder Produktionsplanung über
`GET /options?kind=models` gelesen. Die derzeit dokumentierten Werte 20, 50 und
100 Credits werden nicht als unveränderliche Europreise behandelt.

Die ersten 15 erfolgreich erzeugten Faceless-Videos werden zwingend als
`FACELESS_STORYBOARD` geplant. Source of Truth ist Postgres: Gezählt werden nur
`production_requests` mit Provider `faceless`, Status `completed` und gesetzter
Blob-URL. Fehlgeschlagene, abgelehnte, unklare oder nur beim Provider vorhandene
Aufträge zählen nicht.

Nach dem Bootstrap entscheidet `lib/renderers/selection.ts` anhand der
strukturierten Produktionsfaktoren. Runway wird nur für konkrete individuelle
Szenen gewählt. Hohe Kosten benötigen belegte Performance und einen
wirtschaftlich plausiblen Opportunity-Wert.

## Zwei Freigaben

1. Ein freigegebener Content-Plan erzeugt eine `production_request` und eine
   `RENDER_COST`-Freigabe. Ohne Status `APPROVED` kann kein Providerstart
   beansprucht werden. Auch der historische Runway-Endpunkt akzeptiert nur noch
   eine gespeicherte `productionRequestId`.
2. Nach erfolgreichem Provider-Job, MP4-Render und Speicherung unter `reels/`
   wird eine versionierte `CONTENT_PUBLISH`-Freigabe angelegt. Erst deren
   ausdrückliche Freigabe erlaubt Instagram-/Facebook-Publishing.

Providerstarts und Publishing-Schritte werden vor externen Schreibaufrufen
atomar beansprucht. Unklare Antworten werden als `start_unknown` bzw. `unknown`
gespeichert und nicht blind wiederholt. Faceless-Aufträge verwenden den
offiziellen Idempotency-Key.

## WhatsApp

Callback:

`https://affiliate-reel-agent.vercel.app/api/whatsapp/webhook`

`GET` verarbeitet Meta Webhook Verification. `POST` prüft zwingend
`X-Hub-Signature-256` mit `WHATSAPP_APP_SECRET`, erlaubt nur Nummern aus
`WHATSAPP_ALLOWED_SENDERS` und dedupliziert jede Meta Message-ID in Postgres.
Freitext wird nur in die feste Intent-Menge APPROVE, REJECT,
REVISION_REQUEST, APPROVE_ONCE, APPROVE_PERMANENTLY oder CLARIFY eingeordnet.
Unklare Nachrichten lösen keine privilegierte Aktion aus.

Erforderliche zusätzliche Vercel-Variablen:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_OPERATOR_PHONE_NUMBER`
- `WHATSAPP_ALLOWED_SENDERS`
- `CRON_SECRET`

Für proaktive Nachrichten außerhalb des 24-Stunden-Servicefensters ist eine
von Meta freigegebene Utility-Vorlage nötig. Optional:

- `WHATSAPP_TEMPLATE_NAME`
- `WHATSAPP_TEMPLATE_LANGUAGE=de`

Die Vorlage muss genau eine Body-Textvariable besitzen. Ohne Vorlage kann Meta
freie Textnachrichten außerhalb des offenen Servicefensters ablehnen; der
Fehler wird nicht als erfolgreicher Versand ausgegeben.

## Meta Publishing

Instagram Reels folgen dem offiziellen Containerablauf: Container erstellen,
`status_code` abfragen und erst bei `FINISHED` genau einmal `media_publish`
aufrufen. Facebook Reels folgen Start, CDN-Upload und Finish. Facebook-Textposts
werden über die Seiten-Feed-Kante veröffentlicht. Bild-/Carousel-Publishing ist
noch nicht aktiviert und scheitert geschlossen.

Zusätzlich zu den bisherigen Leserechten wird für Facebook Publishing
`pages_manage_posts` benötigt. Ein realer Post wird in automatischen Tests nie
ausgelöst.

## Wochenbilanz

Vercel ruft sonntags um 18:00 UTC auf; das ist Sonntagabend in Europe/Berlin.
Der Bericht aggregiert ausschließlich gespeicherte Werte. Fehlende automatische
Affiliate-/Follower-Daten werden ausdrücklich als nicht verfügbar bezeichnet.
Der Versand ist pro Kalenderwoche idempotent.

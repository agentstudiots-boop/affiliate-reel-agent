# Work handoff

Stand: 23. September 2026.
Branch: `feat/production-gates-whatsapp`
PR: #6

## Bereits erledigt

- Content-Orchestrator und Postgres-Lernspeicher bleiben unverändert die Basis.
- Gemini ist entfernt; Tavily bleibt Rechercheprovider.
- Persistente Produktionsläufe, Freigaben und WhatsApp-Ereignisse sind implementiert.
- Erste 15 erfolgreiche Videos erzwingen Faceless Storyboard.
- Spend-Lock verhindert Renderstart ohne gespeicherte Freigabe.
- Signierter WhatsApp-Webhook, Absenderbindung und Freitext-Änderungswünsche sind implementiert.
- Production-Gate ist in der Weboberfläche nach Content-Plan-Freigabe eingebunden.
- Alter 10-Sekunden-Runway-Weg ist als Legacy markiert.
- GitHub Quality und Vercel Preview waren vor dieser Dokumentationsänderung erfolgreich.

## Aufgaben, die einen authentifizierten Browser / Provider-Zugang brauchen

Nachtrag: Der Betreiber hat Preview-Migration `002_production_gates.sql` in Firefox
zweimal ausgeführt; die Oberfläche meldete „Schema bereits aktuell“. Der
tatsächliche Anbieter ist **faceless.so**. Seine offizielle Dokumentation liegt
unter https://faceless.so/developers/docs/reference. Der Adapter samt neuer
Migration `003_faceless_so.sql` wird auf diesem Branch ergänzt; diese neue
Migration ist in Preview noch offen. Die alte Liste unten ist historischer
Handoff und mit dieser Korrektur zu lesen.

1. Vercel-Projekt `agentstudiots-boop/affiliate-reel-agent` öffnen.
2. Preview-Environment prüfen:
   - `FACELESS_API_KEY`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_APPROVER_WA_ID`
   - `META_APP_SECRET`
   - bestehende `DATABASE_URL` und `CONTENT_STUDIO_PASSWORD`
3. Migration `002_production_gates.sql` über die geschützte Migrationsroute im
   Preview ausführen und danach erneut ausführen, um Idempotenz praktisch zu bestätigen.
4. Den **echten Faceless.so-Key** im Preview lesend mit `GET /me`,
   `GET /options?kind=models` und `GET /voices` prüfen. Keine Provider-Credits
   ausgeben. Die offizielle API hat keine kostenlose Draft-/Revision-Route;
   Credits werden bei `POST /videos` belastet, nicht beim MP4-Render.
5. Den integrierten Adapter erst nach Anwendung von Migration 003 im Preview
   prüfen. Vor `POST /videos` muss WhatsApp-Freigabe und einmaliger Claim
   persistiert sein. Idempotency-Key verwenden, aber bei unklarem Ergebnis
   niemals automatisch wiederholen.
6. Meta WhatsApp Webhook auf `/api/whatsapp/webhook` konfigurieren und signierten
   Inbound-Test durchführen:
   - Freigeben
   - Ablehnen
   - natürlicher Änderungswunsch
   - Duplicate Message
   - Nachricht einer nicht freigegebenen WA-ID
7. Die integrierte Outbound-Nachricht nach echter Live-Katalogquote in Preview
   testen. Sie nennt Produkt, Content-Typ, Provider, Provider-Credits sowie
   unbekannte EUR-Kosten/Provision explizit als unbekannt.
8. Browser-E2E auf Preview:
   Content planen → Content freigeben → Produktionsweg vorbereiten →
   Kostenquote → WhatsApp → Änderung oder Freigabe → genau ein Render.
9. Danach separaten Publish-Gate für Instagram/Facebook implementieren:
   niemals direkt nach Render veröffentlichen; zweite WhatsApp-Freigabe.
10. Erst nach bestandenem Preview-E2E PR #6 mergen, Migration in Production
    ausführen und Production erneut smoke-testen.

## Danach

- Wöchentlicher Bericht: Klicks, Follower, Verkäufe, Provision, Produktionskosten,
  Nettoergebnis und Reinvestitionsvorschlag.
- Performance-Daten in die Renderer-/Formatentscheidung einbeziehen.
- Legacy-Runway-Teststudio entfernen, sobald der neue Pfad vollständig bewiesen ist.

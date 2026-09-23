# Verifikation

Stand: 23. September 2026.

## Automatisch bestätigt

- 34 Tests bestanden.
- TypeScript, ESLint und Next.js-Production-Build erfolgreich.
- Postgres-Migrationen sind transaktional und idempotent.
- Der Faceless-Bootstrap erzwingt für Zähler 0 bis 14 Storyboard.
- Nur `completed` plus vorhandene Blob-URL erhöht den Erfolgszähler.
- Deutsche WhatsApp-Beispiele werden in eine feste Intent-Menge übersetzt.
- Nicht autorisierte Absender und falsche Webhook-Signaturen scheitern
  geschlossen.
- Runway kann nicht mehr über den historischen freien Payload gestartet werden.
- Ohne persistente Kostenfreigabe startet kein kostenpflichtiger Provider.
- Ohne persistente Content-Freigabe startet kein Publishing.
- Doppelte WhatsApp Message-IDs werden nicht erneut verarbeitet.
- Kein Test hat Faceless-/Runway-Credits verbraucht oder Content veröffentlicht.

Der Build enthält unter anderem:

- `/api/faceless/connection`
- `/api/production/requests`
- `/api/production/status`
- `/api/whatsapp/webhook`
- `/api/content/approval`
- `/api/capability-proposals`
- `/api/publishing`
- `/api/reports/weekly`

## Bereits extern bestätigt

- `main` wurde vor Beginn dieser Erweiterung stabil auf Vercel Production
  deployed.
- Neon-Verbindung, geschützte Migration `001_memory.sql` und bestehender Blob
  Store `affiliate-reel-media` wurden real bestätigt.
- Die bestehende Meta-Verbindung war lesend verbunden; ein echter Post wurde
  bewusst nicht als Test ausgelöst.

## Nach dem nächsten Deployment extern auszuführen

1. Migration `002_production_control.sql` über `/api/admin/migrate` ausführen.
2. `/api/faceless/connection` lesen: Key, Scopes, Stimmen, Modelle und Credits.
3. Fehlende WhatsApp-Variablen setzen und Webhook bei Meta konfigurieren.
4. Betreiber sendet zuerst eine Nachricht an die Business-Nummer oder richtet
   eine freigegebene Utility-Vorlage ein.
5. Einen kostenlosen Content-Plan schreiben/laden und eine Produktionsanfrage
   erzeugen. Noch nicht freigeben, solange kein bezahlter Storyboard-Test gewollt
   ist.
6. Runway nur regressiv bis vor den kostenpflichtigen Aufruf prüfen.

Diese externen Punkte dürfen erst nach tatsächlicher Rückmeldung als erfolgreich
gelten.

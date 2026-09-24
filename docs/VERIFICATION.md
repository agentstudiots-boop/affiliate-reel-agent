# Verifikation des offenen PR #6

Stand: 24. September 2026. Branch `feat/production-gates-whatsapp`.

## Lokal und CI

- Nach der Benachrichtigungsvorlage: `npm run typecheck`, `npm run lint`, `npm test`
  (39 bestanden) und `npm run build` erfolgreich. Tests verwendeten keine
  kostenpflichtigen oder externen Schreibaufrufe.
- GitHub Quality und Vercel Preview zu `e722f62` waren erfolgreich. Die
  Tagesvorlage und Migration 006 wurden lokal geprüft; ihr Preview-Build
  folgt mit dem nächsten PR-Commit.
- Die Tests decken getrennte Content-, Render- und Publikationsfreigaben,
  ungültige Sender, „ja“, Nachrichten-Deduplikation, genau einen Publish-Claim,
  eine nicht genehmigende Tagesbenachrichtigung, deaktivierten Vorlagenversand,
  Sperre inkompatibler Facebook-Jobs und Abgleich der im Meta-Webhook
  enthaltenen Empfängernummer ab.

## Preview wirklich beobachtet

- Alle Migrationen 001–005 sind angewendet; zwei weitere geschützte
  Migrationsaufrufe meldeten keine offene Änderung.
- Das korrekte PR-Preview zeigte `Postgres konfiguriert` und eine erfolgreiche
  lesende Meta-Diagnose mit Facebook-Seite und verknüpftem Instagram-Konto.
- Der Browser lud die Seite zum Preview-Deploy `2bed3c2`. Im Browserprotokoll
  war lediglich ein Fehler der Browsererweiterung, kein App-Runtime-Fehler zu
  sehen. Das beweist noch keinen echten Browser-E2E für Freigabe oder Posting.

## Für den Merge weiterhin zwingend

1. Authentifizierten Browser-E2E mit einem neuen, passenden Facebook-Bild-
   oder Textjob im **aktuellen** Preview durchführen.
2. Erste Content-Freigabe und getrennte finale WhatsApp-Freigabe verifizieren;
   danach genau einen echten Facebook-Post, Permalink und Postgres-Persistenz
   sowie Runtime-Logs prüfen. Bei unklaren Ergebnissen kein zweiter POST.
3. Faceless.so-Quote und ein einziges bewusst freigegebenes Video mit
   Statusabfrage, fertiger URL und Persistenz prüfen. Kostenpflichtigen
   Provideraufruf nicht als allgemeinen Regressionstest wiederholen.
4. Migration 006 im Preview zweimal über die geschützte Route bestätigen. Erst
   dann Tagesvorlage mit bekannter Kategorie und Tarif einrichten und das
   Benachrichtigungs- und Dialogverhalten in Preview prüfen.
5. Erst dann PR finalisieren, `main` mergen, Production deployen, Migration
   in Production ausführen und Smoke-Test durchführen. Fehlende genehmigte
   WhatsApp-Vorlage für initiierte Tagesnachrichten gesondert klären.

Keine Secrets, WhatsApp-Tokens oder Rohantworten mit Zugangsdaten in Tests,
Dokumentation, Logs oder Pull Request schreiben.

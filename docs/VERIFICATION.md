# Verifikation des offenen PR #6

Stand: 24. September 2026. Branch `feat/production-gates-whatsapp`.

## Neue Prüfung ab `37c8a406` am 24.09.2026

| Prüfung | Beobachtetes Ergebnis |
| --- | --- |
| GitHub-Quality-Check | Erfolgreich für `37c8a406`; Run `35943059322` |
| Vercel-Commitstatus | Erfolgreich; Deployment `85KqHvGET7iSUuKvkTzqAVmS68kd` |
| Lokale technische Prüfung | TypeScript, ESLint, 39 bestehende Tests und Next.js-Build erfolgreich |
| Ergänzter Migrationstest | Alle 40 Tests und ESLint erfolgreich; 006 aktualisiert den befüllten Stand 001–005 genau einmal, Bestandsdaten und frühere Migrationseinträge bleiben unverändert |
| Preview-Oberfläche | Lädt; `Postgres konfiguriert` ist ein Konfigurationshinweis, noch kein Verbindungsnachweis per Datenbankabfrage |
| Preview-Meta-Lesetest | Erneut `connected`; Facebook-Seite und Instagram-Konto erreichbar; kein Schreibaufruf |
| Browserprotokoll | Nur Meldungen der Browsererweiterung beobachtet; kein beobachteter App-Fehler; kein Ersatz für Vercel Runtime Logs |
| Geschützte Migrationsseite | Erreichbar, Datenbank/Zugangscode konfiguriert; Zugangscode für POST fehlt in dieser Sitzung |
| Preview-Migration 006 | **Nicht ausgeführt**, kein Live-Ergebnis `applied` oder `alreadyApplied` behauptet |
| Vercel Runtime/Umgebungsvariablen | **Blockiert**: Connector-Team `thorsten1988la-1943`, Projekt-Team `agentstudiots-boop`; Zugriff auf das Projekt wird mit 403 abgewiesen |
| Facebook- und Faceless-E2E | **Nicht gestartet**; keine echten Posts, Providerkäufe oder WhatsApp-Sends |
| PR/Production | Draft unverändert; kein Merge, keine Production-Migration |

Nachtrag: Auch GitHub Quality und Vercel-Build zu `fb9762f` sind erfolgreich
(Deployment `NZYWAJTf5f4TMiP35XB2RrgWwPHA`). Der Versuch, den Zugangscode über die
sichere Browser-Eingabe abzufragen und damit den Migrations-POST abzusenden,
wurde vor Anzeige des Dialogs automatisch abgelehnt. Grund: Die Dialogbeschriftung
stellte die Datenbankaktion als Anmeldung dar. Keine Eingabe, keine Migration.
Eine ausdrückliche Bestätigung des Betreibers zur konkreten Datenbankaktion ist
vor einem erneuten Versuch erforderlich; keine Umgehung des geschützten Wegs.

Der neue Test `tests/migration-upgrade.test.cjs` arbeitet ausschließlich mit einer
isolierten PGlite-Datenbank. Er ersetzt nicht die verlangten zwei geschützten
Migrationsaufrufe im Preview. Direkte HTTP-Prüfungen aus der Arbeitsumgebung
lieferten keine verwertbaren Ergebnisse; ein zusätzlicher Browser-Aufruf des
Webhook-GET wurde vom Client blockiert. Daraus wird kein App-Fehler und keine
erfolgreiche Webhook-Prüfung abgeleitet.

### Tagesvorlage: Code geprüft, Live-Konfiguration offen

`dailyNotificationTemplateConfigured()` verlangt weiterhin ausdrücklich
`WHATSAPP_DAILY_TEMPLATE_ENABLED=true`, einen gültigen
`WHATSAPP_DAILY_TEMPLATE_NAME` und einen gültigen
`WHATSAPP_DAILY_TEMPLATE_LANGUAGE`. Genehmigung und Tarif werden nicht über
eine Meta-Live-Abfrage bewiesen. Deren Nachweis und Kostenentscheidung bleiben
externe Voraussetzungen. Es wurde keine Variable geändert und keine Vorlage
gesendet. Die tatsächlichen Preview-/Production-Werte sind wegen des oben
beschriebenen Vercel-Zugriffsfehlers nicht verifiziert.

### Fortsetzung ohne doppelte externe Aktionen

1. Zugangscode ausschließlich über sichere Eingabe bereitstellen; 006 über
   `/api/admin/migrate` anwenden, danach erneut aufrufen und beide Ergebnisse
   festhalten. Bei abweichendem ersten Ergebnis den tatsächlichen Zustand
   dokumentieren, niemals Ledger oder Migrationen zurücksetzen.
2. Vercel-Zugriff für `agentstudiots-boop` herstellen und Meta-Webhook-Ziel auf den
   richtigen Preview prüfen. Für zwei WhatsApp-Freigaben einen neuen Job über
   den bestehenden Tagesentwurf-Flow vorbereiten; eine manuelle Content-Freigabe
   zählt nicht als WhatsApp-Nachweis. Servicefenster und eindeutigen Approver
   vorher bestätigen.
3. Danach je einen Facebook- und Faceless-Durchlauf samt Job-/Request-/Provider-IDs,
   Permalink/Video-URL, Datenbankstatus und Runtime-Logs belegen. Bei unklarem
   Ergebnis ausschließlich lesend abgleichen; keine zweite externe Aktion.
4. Erst nach allen ursprünglichen Merge-Gates erneut vollständig testen und
   Production ausrollen. Die Arbeiten des anderen Agenten separat integrieren.

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

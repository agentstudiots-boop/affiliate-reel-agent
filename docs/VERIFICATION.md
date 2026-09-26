# Verifikation des offenen PR #6

Stand: 24. September 2026. Branch `feat/production-gates-whatsapp`.

## Migration 006 im Preview erfolgreich

Vercel-Runtime-Nachweis vom 24.09.2026, Deployment
`dpl_6L5vKhUvgx8f8mktPGFpfKcWAJqU`, Commit
`bffa271f5919856c1b2a0017dfc3be7169b692ad`, Branch
`feat/production-gates-whatsapp`. Der Betreiber verwendete ausschließlich die
bestehende Route `POST /api/admin/migrate`.

| UTC | HTTP | `applied` | `alreadyApplied` |
| --- | --- | --- | --- |
| 08:31:54 | 200 | `006_daily_notification.sql` | 001–005 |
| 08:32:10 | 200 | leer | 001–006 |
| 08:32:14 | 200 | leer | 001–006 |
| 08:32:23 | 200 | leer | 001–006 |
| 08:32:32 | 200 | leer | 001–006 |
| 08:32:34 | 200 | leer | 001–006 |

Alle Ergebnisse wurden in den strukturierten `database_migration`-Events
gesehen. Der erste und zweite Aufruf erfüllen den geforderten Nachweis;
die zusätzlichen Wiederholungen blieben ebenfalls ohne SQL-Migration.
Kein manueller Datenbankeingriff. Der erfolgreiche Migrations-/Ledger-Zugriff
bestätigt die Verbindung zu Preview-Postgres. Er bestätigt noch keine
Content-, Freigabe- oder Veröffentlichungseinträge.

Beim ersten Aufruf erschien dieselbe Postgres-SSL-Moduswarnung wie zuvor auf
älteren Deployments. Kein Migrationsfehler, keine Änderung der TLS-Einstellungen.
Keine Secrets im Nachweis. Frühere Aussagen „006 nicht ausgeführt“ weiter unten
sind historische Befunde und durch diesen Abschnitt überholt.

Die anschließende Content-Studio-Browserprüfung erreichte die Oberfläche mit
`Postgres konfiguriert`. Das sichere Zugangsfeld zum Laden des gespeicherten
Verlaufs wurde vor Anzeige/Eintrag automatisch abgelehnt, weil der allgemeine
Dialog diese geschützte Leseabfrage als Anmeldung bezeichnet. Kein Verlauf
geladen und kein E2E-Job gestartet; konkrete Betreiberbestätigung für diesen
Eingabeschritt erforderlich, kein alternativer Ausführungsweg versucht.

## Live-Nachprüfung nach Vercel-Neuverbindung

Geprüft am 24.09.2026 gegen 08:28 UTC, Preview-Commit
`d7ee14133508513185e826174e1230d113a63dce`.

| Prüfung | Beobachtetes Ergebnis |
| --- | --- |
| Vercel-Team/Projekt | `agentstudiots-boop` erreichbar; früherer Autorisierungsfehler behoben |
| Preview-Zuordnung | `dpl_4fH4vN9fPXbhdYYERG1w5qpfQxF7`, Branch `feat/production-gates-whatsapp`, korrekter Commit, `READY` |
| Runtime-Fehler aktuelles Preview, letzte 24 h | Keine Error-/Warning-/Fatal-Einträge gefunden; sehr geringe Nutzung, kein E2E-Nachweis |
| Webhook ohne Verifizierung | HTTP 403 mit App-Pfad `/api/whatsapp/webhook`; zugehöriger Request in Runtime-Zählung sichtbar |
| Projektweite Fehleraggregation | Eine ältere Postgres-SSL-Warngruppe auf früherem Deployment; keine Änderung an SSL-Einstellungen |
| Migration-Logsuche in Preview, letzte 24 h | Keine passenden `database_migration`-Logs gefunden; kein Beleg für Ausführung oder Schema-Zustand |
| Weitere Connector-HTTP-Lesetests | Teilweise Connector-Zugriffsfehler oder SSO-Redirect, kein verwertbarer neuer Meta-/DB-Nachweis |
| Live-Umgebungsvariablen | Keine passende Funktion im angebotenen Connector; Werte weiterhin unbestätigt |
| Build-Log-Werkzeug | Server meldet `Tool not found`; erfolgreicher Deploymentstatus separat bestätigt |
| Bestehende Production | `READY`, `dpl_EdFS8ZgeznxLrofXCTaabn9S6hm7`, `main` bei `d956518a71cd3658efb8524311bf314444f98272`; kein neuer Rollout |

Keine Migration, kein Content-Job, keine ausgehende Nachricht, kein Post und kein
Faceless-Kauf ausgelöst. Die geschützte Migration benötigt weiterhin den
Betreiber/Zugangscode. Ältere Aussagen zum Vercel-403 weiter unten beschreiben
den damaligen Zustand und sind durch diesen Nachtrag überholt. Keine vollständige
technische Testsuite wiederholt, da ausschließlich Nachweise ergänzt wurden.

## Isolierte Integrationsprüfung

Neu: Die isolierte Kombination mit dem inzwischen vorliegenden PR #8 besteht
lokal TypeScript, ESLint, **50 Tests** und Next.js-Build. PR #6 allein bleibt bei
47 Tests. Die Kombination wurde weder remote gemergt noch live ausgeführt.
Nachweis und Grenzen: [INTEGRATION_REVIEW_PR8.md](INTEGRATION_REVIEW_PR8.md).

## Lokale Fortsetzung nach `0e8484d`

Sieben zusätzliche Integrationstests führen die tatsächlichen Produktions- und
WhatsApp-Handler aus. Die Repositories arbeiten gegen isoliertes PGlite;
externe Provider und ausgehende Nachrichten sind simuliert. Die vollständige
Suite umfasst 47 erfolgreiche Tests. Diese Prüfungen beweisen keine echte
WhatsApp-Zustellung, Meta-Schreibberechtigung oder Faceless-Produktion.
TypeScript, ESLint und Next.js-Build sind ebenfalls erfolgreich. Die
Dateiliste des erzeugten Migrations-Handlers enthält 001–006; alle sechs
Dateien sind vorhanden. Das bestätigt die lokale Verpackung für das Deployment,
keine ausgeführte Datenbankmigration.

| Lokaler Fall | Nachgewiesenes Verhalten |
| --- | --- |
| Zwei gleichzeitige Videostarts | Ein kostenpflichtiger simulierter Aufruf, zweite Anfrage abgewiesen |
| Verlorene Antwort auf Videostart | Dauerhafter Claim, keine Provider-ID behauptet, kein zweiter Kauf |
| Unklarer MP4-Render | Ein Render, anschließender Abgleich nur lesend, fertige URL später übernommen |
| Guthaben fehlt / Quote steigt | Kein Kauf, Freigabe nicht verbraucht |
| Provider meldet nach Start höhere Kosten | Zuerst mit fehlender Provider-ID reproduziert; nach Fix bleibt die bestätigte ID gespeichert und lesbar, erneuter Kauf gesperrt |
| Zwei getrennte signierte Facebook-Freigaben | Erster Schritt genehmigt nur Content, zweiter erzeugt genau einen simulierten Post mit persistierter ID/URL |
| Gleiche und neue Message-IDs zur bereits entschiedenen Freigabe | Kein doppelter Post oder Freigabeversand, auch bei paralleler Zustellung |
| Unklare Facebook-Antwort | Status `unknown`, kein erfundener Erfolgseintrag, keine zweite Veröffentlichung |
| Falsche Signatur, Telefonnummer oder Approver | Keine Entscheidung und kein externer Schreibaufruf |

Die PGlite-Prüfung ist kein Last-/Parallelitätstest des entfernten Postgres-
Servers. Die echte Preview-Prüfung von Claims, Tabellen und Runtime-Logs bleibt
zwingend. Der konkrete Morgenablauf steht in
[PREVIEW_E2E_RUNBOOK.md](PREVIEW_E2E_RUNBOOK.md).

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

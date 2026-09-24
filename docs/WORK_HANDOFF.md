# Work handoff

Stand: 24. September 2026. Offener Draft-PR #6 auf
`feat/production-gates-whatsapp`. Weder nach `main` gemergt noch für Production
freigegeben.

## Migration 006 live bestätigt (24.09., 08:31–08:32 UTC)

Der Betreiber hat die bestehende geschützte Preview-Route aufgerufen. Die
Runtime-Logs belegen auf `dpl_6L5vKhUvgx8f8mktPGFpfKcWAJqU`, Commit
`bffa271f5919856c1b2a0017dfc3be7169b692ad`:

- 08:31:54 UTC, HTTP 200: ausschließlich `006_daily_notification.sql` angewendet;
  001–005 in `alreadyApplied`.
- 08:32:10 UTC, HTTP 200: `applied: []`; 001–006 in `alreadyApplied`.
- Vier weitere Aufrufe um 08:32:14, :23, :32 und :34 UTC ebenfalls HTTP 200,
  ohne angewendete Migration. Keine erneute Ausführung der älteren SQL-Dateien.

Damit sind Preview-Migration 006, Idempotenz und die Datenbankverbindung über
den bestehenden Migrationsweg praktisch bestätigt. Eine Postgres-SSL-Warnung
begleitete den ersten Aufruf; die Migration war erfolgreich. Kein manuelles
SQL, kein Reset des Ledgers, kein eigener zusätzlicher Migrationsaufruf.
Die früheren Aussagen „006 offen“ unten sind historisch und damit überholt.
Facebook-/Faceless-E2E und Production bleiben offen. Für den Facebook-Test
zuerst den geschützten Verlauf und offene Freigaben prüfen, dann den vorhandenen
Tagesentwurf-Flow mit zwei getrennten WhatsApp-Freigaben verwenden.

Die Browserprüfung des Content Studios lädt die Oberfläche und bestätigt
`Postgres konfiguriert`. Der separate sichere Eingabedialog für den Button
`Gespeicherten Verlauf laden` wurde anschließend automatisch abgelehnt, bevor
eine Eingabeaufforderung oder Aktion erfolgte: Die allgemeine Beschriftung
`Sign in to continue` stellt diese geschützte Leseabfrage als Anmeldung dar.
Kein Code wurde eingegeben, kein Verlauf geladen. Diese neue Ablehnung betrifft
keine Migration. Vor einem erneuten Versuch die konkrete sichere Code-Eingabe
und ausschließlich lesende Verlaufsabfrage ausdrücklich bestätigen lassen;
keinen Browser-/API-Ersatzweg verwenden. Facebook-/Faceless-Tests nicht gestartet.

## Vercel-Zugriff wiederhergestellt (24.09., ca. 08:28 UTC)

Die erneute Verbindung ist erfolgreich: Team `agentstudiots-boop` und Projekt
`affiliate-reel-agent` sind über den Connector erreichbar. Der vorherige
Scope-/403-Blocker ist damit behoben; die älteren Abschnitte unten sind historisch.
Preview `dpl_4fH4vN9fPXbhdYYERG1w5qpfQxF7` ist `READY` und gehört zu
PR-#6-Commit `d7ee14133508513185e826174e1230d113a63dce`.

- Keine Fehler-/Warn-/Fatal-Logs für dieses Deployment im abgefragten
  24-Stunden-Fenster. Zunächst keine Requests, danach ein eigener Webhook-GET:
  ohne Verifizierung erwartungsgemäß HTTP 403 vom App-Handler. Dies beweist
  Erreichbarkeit und Ablehnung, keinen erfolgreichen Meta-Handshake oder Empfang.
- Projektweit zeigt die Fehleraggregation eine ältere Postgres-SSL-Warnung zu
  `sslmode=require` auf einem früheren Deployment. Keine Konfiguration geändert.
- Production ist weiterhin `READY` auf `main`-Commit `d956518a71cd3658efb8524311bf314444f98272`,
  Deployment `dpl_EdFS8ZgeznxLrofXCTaabn9S6hm7`. Kein eigener Rollout erfolgt.
- Weitere HTTP-Lesediagnosen über den Connector scheiterten teilweise an dessen
  Deployment-Zugriff bzw. endeten im Vercel-SSO-Redirect. Daraus keinen App-Fehler
  ableiten. Kein Browser-Ersatzweg für diese Connector-Probleme genutzt.
- Umgebungsvariablen sind mit den aktuell angebotenen Connector-Funktionen nicht
  abrufbar; das angebotene Build-Log-Werkzeug meldet serverseitig `Tool not found`.
  Runtime-Log-Zugriff funktioniert. Tagesvorlage, Webhook-Ziel und DB-Zustand
  bleiben praktisch zu bestätigen.

Nächster Betreiberschritt: die geschützte Migrationsseite des PR-#6-Previews im
eigenen Browser öffnen, Zugangscode dort eingeben und die Migration ausführen;
anschließend mit demselben Code ein zweites Mal ausführen. Erwartet zunächst
006, danach `Schema bereits aktuell` mit 001–006. Kein Code im Chat. Die zuvor
automatisch abgelehnte Browser-Eingabe wurde nicht erneut versucht; kein
Migrations-POST durch den Agenten. Danach die beiden `database_migration`-Events
im aktuellen Deployment abgleichen und den kontrollierten E2E fortsetzen.

## Neue Integrationsvorprüfung

PR #8 des anderen Agenten ist inzwischen vorhanden. PR #6 (`324dc8c`) und
PR #8 (`cd7d35a`) wurden ausschließlich in einer isolierten lokalen Arbeitskopie
kombiniert: keine Merge-Konflikte, TypeScript/ESLint/50 Tests/Next.js-Build grün.
Kein Remote-Merge und keine Änderungen an den fremden Feature-Dateien.
Details und genaue SHAs: [INTEGRATION_REVIEW_PR8.md](INTEGRATION_REVIEW_PR8.md).
PR #6 bleibt für den Nachweis von Migration 006 getrennt; PR #8 enthält zusätzlich
007/008. Vercel-Zugriff erneut geprüft und weiterhin mit 403 blockiert.

## Fortsetzung ohne Betreiber (nach `0e8484d`)

Der Betreiber ist heute nicht verfügbar; keine neue Zugangseingabe oder echte
WhatsApp-Freigabe anfordern. Morgen nach [PREVIEW_E2E_RUNBOOK.md](PREVIEW_E2E_RUNBOOK.md)
fortsetzen. Die bestehenden Live-Blocker bleiben bestehen.

- In `/api/production` einen reproduzierten Fehler behoben: Bei einer höheren
  gemeldeten Credit-Belastung wurde bisher die bereits bestätigte Provider-ID
  nicht gespeichert. Sie wird nun vor der Kostenwarnung gebunden. Der Claim
  bleibt verbraucht, ein zweiter Kauf gesperrt; der Auftrag bleibt lesbar.
  `faceless_credit_mismatch` protokolliert ausschließlich Job-ID und Creditwerte.
- Sieben neue lokale Handler-Integrationstests nutzen den echten Route-Code,
  echte Signaturprüfung/Repository-Logik und isoliertes PGlite. Provider,
  Bild-/Nachrichtenversand sind simuliert; kein echter Meta-/Faceless-Zugriff.
  Sie prüfen die zwei Publikationsfreigaben, parallele/erneute Zustellungen,
  genau einen Kauf/Render/Post, unbekannte Ergebnisse, zu wenig Guthaben,
  gestiegene Quote und Erhalt der bekannten Provider-ID bei Kostenabweichung.
- TypeScript, ESLint, die vollständige Testsuite mit 47 Tests und Next.js-Build
  sind erfolgreich. Der Build enthält alle sechs SQL-Migrationsdateien für die
  geschützte Route. CI/Preview zum neuen Commit separat prüfen.
  Keine Architekturänderung, kein Schemaeingriff und keine
  Änderungen am Wochenbericht oder an der Bild-/Textrevision.

## Verifikationsfortsetzung am 24.09.2026 (Ausgangscommit `37c8a406`)

- Branch sauber und aktuell geladen; die vier Übergabedokumente gelesen.
  GitHub Quality und Vercel-Commitstatus für `37c8a406` sind erfolgreich.
  Zugehöriges Deployment: `85KqHvGET7iSUuKvkTzqAVmS68kd`.
- TypeScript, ESLint, die damaligen 39 Tests und Next.js-Build erneut bestanden.
  Ein ergänzender isolierter Upgrade-Test prüft nun einen bereits befüllten
  Stand 001–005: ausschließlich 006 wird geladen, beim zweiten Aufruf nichts;
  frühere Migrationseinträge, Tagesentwurf und WhatsApp-Ereignis bleiben erhalten.
  Alle 40 Tests und ESLint sind mit dieser Ergänzung erfolgreich. Das ist ein
  lokaler Nachweis, **kein** Nachweis einer Preview-Migration.
- Aktueller PR-Preview im Browser geöffnet: Oberfläche lädt, Postgres wird als
  konfiguriert angezeigt. Erneuter lesender Meta-Test meldet `connected`.
  Die Migrationsseite meldet konfigurierte Datenbank und Zugangscode, verlangt
  vor jedem POST aber den Content-Studio-Zugangscode. Dieser ist in der neuen
  Sitzung nicht verfügbar; **kein Migrations-POST wurde ausgeführt**.
- Vercel-Connector hat Zugriff auf `thorsten1988la-1943`, das Projekt liegt unter
  `agentstudiots-boop`. Projekt-/Deploymentabfrage im richtigen Team wird mit
  403 und der Aufforderung zur erneuten Autorisierung dieses Scopes abgewiesen.
  Runtime-Logs, Live-Umgebungsvariablen und Production-Zustand sind deshalb
  nicht bestätigt. Keine Zugangsdaten in Dokumentation aufnehmen.
- Es wurden keine Jobs, WhatsApp-Nachrichten, Facebook-Posts oder Faceless-Käufe
  ausgelöst. PR bleibt Draft; kein Merge und kein Production-Rollout.
- Wochenbilanz und natürliche Bild-/Textrevision werden von einem anderen
  Agenten separat bearbeitet. Hier wurden nur Verifikation und Übergabe ergänzt.

Nächster notwendiger Betreiberschritt: Content-Studio-Zugangscode im sicheren
Browser-Eingabedialog bereitstellen, nicht im Chat. Danach 006 über die bestehende
geschützte Route anwenden und den zweiten POST separat bestätigen. Für spätere
Runtime-Nachweise zusätzlich die Vercel-Verbindung für `agentstudiots-boop`
autorisieren. Die erforderlichen echten WhatsApp-Freigaben bleiben beim Approver.

Nachtrag: Die sichere Browser-Eingabe wurde vor Anzeige an den Betreiber durch
die automatische Sicherheitsprüfung abgelehnt: Der als Anmeldung beschriftete
Dialog hätte mit dem Zugangscode direkt eine Datenbankmigration abgesendet.
Es wurde weder ein Code eingegeben noch ein POST ausgeführt. Vor einem neuen
Versuch ist eine ausdrückliche Bestätigung dieser Datenbankaktion erforderlich;
keinen alternativen oder ungeschützten Ausführungsweg verwenden.
GitHub Quality und Vercel-Build des Verifikationscommits `fb9762f` sind ebenfalls
erfolgreich (Deployment `NZYWAJTf5f4TMiP35XB2RrgWwPHA`).

Für den Facebook-Test mit **zwei** WhatsApp-Freigaben den bestehenden Tagesentwurf-
Flow nutzen: Die manuelle Content-Studio-Freigabe ist keine erste
WhatsApp-Freigabe. Der tägliche Flow benötigt einen ausdrücklich autorisierten
Cron-Aufruf und ein offenes Servicefenster; keine kostenpflichtige Vorlage
ersatzweise aktivieren. Meta-Webhook-Ziel zum aktuellen Preview vor dem Versand
prüfen. Noch kein neuer Tagesauftrag wurde ausgelöst.

## Tatsächlich nachgewiesen

- Der bestehende Content-Orchestrator mit Postgres, separaten Freigaben und
  Faceless.so-Storyboard-Gate bleibt die Basis. Die ersten 15 Videos zählen nur
  bei `production_runs.status='ready'` und müssen `FACELESS_STORYBOARD` nutzen.
- Der Betreiber hat die Preview-Migrationen `001_memory.sql` bis
  `005_publication_gate.sql` angewendet. Zwei weitere geschützte Aufrufe von
  `/api/admin/migrate` meldeten alle fünf als `alreadyApplied`.
- `BLOB_READ_WRITE_TOKEN` ist in Preview vorhanden. Nach Redeploy des richtigen
  PR-Previews zeigte die lesende Meta-Diagnose `connected`: Systemnutzer,
  Facebook-Seite und verknüpftes Instagram-Konto waren erreichbar. Ein
  Meta-Schreibaufruf wurde dadurch noch nicht bewiesen.
- Die bisherigen Preview-Builds bis `e722f62` und GitHub Quality waren erfolgreich.
  Browserprüfung: Seite lädt, Postgres wird als konfiguriert angezeigt. Die
  Veröffentlichungssperre erklärt inzwischen vor dem Klick, warum ein
  gespeicherter Job keinen Facebook-Seitenpost ergeben kann.
- Eine bereits geprüfte Änderung bindet eingehende signierte WhatsApp-Nachrichten
  zusätzlich an `WHATSAPP_PHONE_NUMBER_ID` (oder die bestehende Schreibweise
  `WHATTSAPP_PHONE_NUMBER_ID`). Die lokalen Prüfungen inklusive neuer
  Tagesvorlage bestehen: TypeScript, ESLint, 39 Tests und Next.js-Build.
  Den Preview-Build zur jüngsten Änderung separat abwarten.
- Bisher wurde kein kostenpflichtiger Faceless-Auftrag und kein echter
  Facebook-Post durch das System ausgelöst. Keine Secrets in GitHub schreiben.

## Nächster kontrollierter Preview-Durchlauf

1. Im aktuellen Preview einen neuen, zur **Facebook-Seite** passenden Bild-
   oder Textplan mit dem tatsächlich gewünschten Produkt speichern und inhaltlich
   freigeben. Alte Jobs enthalten unveränderliche Produkt-/Plattform-Snapshots;
   ein anderes Produkt im Formular ändert den gespeicherten Job nicht.
2. `Beitrag vorbereiten & WhatsApp-Freigabe anfragen` genau einmal auslösen.
   Textgrafik, Bild-URL, Affiliate-Link und den gespeicherten Status prüfen.
3. Ausschließlich vom festgelegten Approver auf **diese** WhatsApp antworten:
   `Freigeben` oder einen natürlichen Änderungswunsch. Eine separate erste
   Content-Freigabe darf niemals schon publizieren. Danach genau einen
   Facebook-POST, Permalink und Postgres-Eintrag prüfen; Runtime-Logs ansehen.
4. Einen Faceless.so-Videoablauf nur mit echter Quote, überprüften Credits und
   ausdrücklicher WhatsApp-Freigabe einmalig durchführen. Unklare Ergebnisse
   bleiben gesperrt; keine automatische Wiederholung oder neuer Render auf
   Verdacht.
5. Browser-E2E und Preview-Runtime-Fehler dokumentieren. Erst nach stabilem
   Ergebnis PR #6 finalisieren, mergen, Production deployen, dort Migration
   ausführen und Smoke-Test durchführen.

## Noch offen / externe Entscheidung

- Tägliche Entwürfe werden im Production-Cron vorbereitet. Für Benachrichtigungen
  außerhalb des 24-Stunden-Fensters ist eine **deaktivierte** Meta-Vorlage ohne
  Content-Freigabe vorbereitet. Erst `Entwurf` als Antwort sendet den ganzen
  Entwurf im Servicefenster. Migration `006_daily_notification.sql` ist neu und
  muss vor einem Preview-Durchlauf angewendet werden. Meta-Vorlage,
  Genehmigung, Kategorie, wiederkehrende Gebühren und ausdrückliche Aktivierung
  stehen aus; ohne sie speichert der Cron nur den Entwurf.
- Das tatsächliche Faceless.so-Video-E2E und die Meta-Schreibberechtigung sind
  noch nicht praktisch bestätigt. Es fehlt ein echter, bewusst freigegebener
  Publishing-Durchlauf.
- Natürliche Änderungen am Video laufen bereits über den Orchestrator. Bei
  Bild-/Textpublikationen wird Änderungswunsch gespeichert und der alte Post
  gesperrt; eine neue Bild-/Textrevision steht noch aus.
- Instagram-Veröffentlichung und Wochenbericht erst nach stabilem
  Produktions-/Publishing-Workflow ergänzen. Fehlende Klick-, Follower-,
  Umsatz- oder Kostenwerte nicht erfinden.

Technische Einzelheiten: [PRODUCTION_GATES.md](PRODUCTION_GATES.md),
[DAILY_POSTS.md](DAILY_POSTS.md) und [VERIFICATION.md](VERIFICATION.md).

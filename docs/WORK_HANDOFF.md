# Work handoff

Stand: 24. September 2026. Offener Draft-PR #6 auf
`feat/production-gates-whatsapp`. Weder nach `main` gemergt noch für Production
freigegeben.

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

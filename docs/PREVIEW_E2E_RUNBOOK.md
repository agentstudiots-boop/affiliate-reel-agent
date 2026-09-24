# Kontrollierter Live-Nachweis für PR #6

Stand: 24.09.2026. **Migration 006 ist live bestätigt**; Facebook- und
Faceless-Durchlauf sind vorbereitet, aber noch nicht live ausgeführt.
Eine lokale Simulation ersetzt keinen Meta-/Faceless-Nachweis. Wochenbericht
und natürliche Bild-/Textrevision gehören zum separaten Arbeitsauftrag.

## 1. Zugang und Ziel vor der ersten Aktion prüfen

- PR-Head und zugehöriges Vercel-Deployment abgleichen. Branch-Preview:
  https://affiliate-reel-agent-git-feat-product-6c8006-agentstudiots-boop.vercel.app
- Vercel muss für das Projekt-Team `agentstudiots-boop` verbunden sein. Der
  zuletzt verbundene Scope `thorsten1988la-1943` hatte keinen Zugriff. Runtime-
  Logs und die Zuordnung der Preview-/Production-Konfiguration zuerst prüfen.
- Migration ausschließlich über `/api/admin/migrate`; Zugangscode nur sicher
  eingeben. Die automatische Prüfung des vorherigen Eingabedialogs wurde wegen
  irreführender Anmeldebeschriftung abgelehnt. Vor einem neuen Versuch die
  konkrete Datenbankaktion ausdrücklich bestätigen lassen; keinen Ersatzweg
  bauen. Die Migration schreibt Schema und Migrationsledger, keinen Content.
- Tatsächliches Meta-Webhook-Ziel auf diesen Preview und konfigurierte
  Telefonnummer prüfen. Ein `connected`-Lesetest beweist keinen Webhook-Eingang.
- Vor dem Tages-Cron sicherstellen, dass die kostenpflichtige Tagesvorlage nicht
  aktiviert ist. Template-Name, Sprache, Genehmigung und Kostenakzeptanz sind
  weiterhin offen. Fehlende Einstellungen nicht stillschweigend ergänzen.

## 2. Migration 006 zweimal über die geschützte Route

Erledigt am 24.09.2026: 08:31:54 UTC nur 006 angewendet, 08:32:10 UTC
001–006 bereits angewendet; vier weitere Wiederholungen ebenfalls ohne Änderung.
Deployment und vollständiger Nachweis: [VERIFICATION.md](VERIFICATION.md).
Für dieses Preview nicht erneut ausführen. Die folgenden Regeln gelten für
die spätere Production-Migration bzw. andere noch nicht geprüfte Datenbanken.

Ersten und zweiten Aufruf mit Zeitpunkt und Deployment-ID dokumentieren.
Erwartet: zuerst nur `006_daily_notification.sql` angewendet; danach
`Schema bereits aktuell` mit 001–006. Die Route gibt HTML zurück; die strukturierten
Listen `applied`/`alreadyApplied` stehen im Runtime-Event `database_migration`.
Die historischen Einträge 001–005 dürfen nicht neu ausgeführt werden.

Falls 006 beim ersten Aufruf schon angewendet ist, den tatsächlichen Befund
dokumentieren und den früheren Nachweis suchen. Niemals eine Migration löschen
oder das Ledger zurücksetzen, um das erwartete Ergebnis künstlich herzustellen.

## 3. Genau ein Facebook-Durchlauf

1. Offene Freigaben und vorhandenen Tages-Claim lesend abgleichen. Das 24-Stunden-
   Servicefenster vom konfigurierten Approver öffnen, ohne eine andere offene
   Freigabe versehentlich zu beantworten. Eingang im richtigen Preview belegen.
2. Den vorhandenen Tages-Cron einmal mit seinem serverseitigen `CRON_SECRET`
   autorisiert anstoßen. Der Aufruf recherchiert und speichert einen neuen
   Facebook-Bild-/Textjob. Bei `already_claimed` keinen bestehenden Job umdeuten
   und weder Datum noch Ledger manipulieren; den Zustand zuerst klären.
3. Den vollständigen Entwurf und die Suchauswahl prüfen. Der Approver antwortet
   auf genau dessen Content-Nachricht mit `Freigeben`. Erwartet: Content-Job
   `approved`, Tagesentwurf `content_approved`, noch kein Post.
4. Auf die separate Veröffentlichungsnachricht mit Bild-URL und vollständigem
   Beitrag erneut ausdrücklich `Freigeben` antworten. Nur diese zweite Antwort
   darf den einmaligen Meta-POST auslösen.
5. `publication_requests.status='published'`, Meta-Post-ID und Permalink prüfen;
   genau eine passende Zeile in `publications` und die zwei verschiedenen
   WhatsApp-Entscheidungen belegen. Den echten Post unter dem Permalink öffnen.
6. Runtime-Events `whatsapp_approval_message`,
   `daily_publication_preparation_unknown` und `facebook_publication` prüfen.
   `unknown` oder ein Timeout ist kein Beleg für einen fehlenden Post. Keine
   zweite Freigabe/Testschleife oder neuen Ersatzjob zum Wiederholen anlegen;
   Meta und gespeicherte Claims ausschließlich lesend abgleichen.

Die manuelle Content-Studio-Freigabe ersetzt Schritt 3 nicht: Sie würde den
geforderten ersten WhatsApp-Nachweis auslassen.

## 4. Genau ein Faceless-Durchlauf

1. Neuen Videojob planen, Inhalt prüfen und redaktionell freigeben. Den
   Produktionsweg vorbereiten: `FACELESS_STORYBOARD`, kein Runway-Fallback in
   der Lernphase. Nur erfolgreiche `ready`-Videos zählen bis 15.
2. Live-Quote und verfügbaren Saldo lesen. Tatsächlich benötigte Credits,
   deutschen Sprecher und Sprechtext anzeigen. Unbekannte Eurokosten und
   Provision als unbekannt belassen.
3. Einmal die WhatsApp-Kostenfreigabe anfordern. Erst auf die ausdrückliche
   Antwort des Approvers hin muss `approved_for_spend` gespeichert sein.
4. Den freigegebenen Videostart genau einmal auslösen. Request-Claim,
   verbrauchte Freigabe und Provider-Job-ID prüfen. Ein unklarer Start ohne
   Job-ID bleibt gesperrt und darf keinen weiteren Kauf erzeugen.
5. Generierung lesen, nach `completed` einmal MP4-Render anfordern; Render-ID
   und später Ausgabe-URL speichern. Nach unklarem Render-Resultat nur den
   vorhandenen Auftrag lesen. Keinen zweiten Render auf Verdacht starten.
6. Endzustand: `production_runs.status='ready'`, Provider-ID, Render-ID,
   Video-URL, `approval_requests.status='consumed'`; tatsächliche Videodatei
   öffnen und Inhalt prüfen. Das erstellt noch keinen Social-Media-Post.

Die [offizielle Faceless-Referenz](https://faceless.so/developers/docs/reference)
wurde am 24.09.2026 für diese Endpunkte abgeglichen. Sie beschreibt den Credit-
Verbrauch beim Erstellen, den getrennten MP4-Render sowie lesende Statusabfragen.
Die Live-Quote bleibt maßgeblich. Bei `faceless_credit_mismatch` ist die bekannte
Provider-ID inzwischen gespeichert; Status und Kosten prüfen, niemals neu kaufen.

## 5. Nachweise und Production

Ohne Tokens, Zugangscodes, Telefonnummern, Roh-Webhooks oder Verbindungsstrings
je Durchlauf festhalten: Commit, Deployment, Zeitpunkt, Job-ID, Request-ID,
Message-ID der jeweiligen Stufe, Provider-/Post-/Render-ID, URL, Status und
passende Runtime-Events. In der Datenbank nur diese Nachweisfelder aus
`schema_migrations`, `content_jobs`, `daily_drafts`, `whatsapp_events`,
`publication_requests`, `publications`, `production_runs` und
`approval_requests` lesen; keine manuellen Statuskorrekturen.

Erst wenn alle Live-Nachweise vorliegen: TypeScript, ESLint, komplette Testsuite,
Next.js-Build und Preview prüfen, finalen Diff einschließlich zwischenzeitlicher
Branch-Änderungen kontrollieren und PR aus Draft nehmen/mergen. Danach Production-
Deployment zu `main` zuordnen, Migration zweimal geschützt aufrufen, Datenbank,
Meta-Leseverbindung und Webhook prüfen. Daily-Cron-Konfiguration samt
`CRON_SECRET` kontrollieren. Ein manueller autorisierter Cron-Test erstellt
Entwürfe und kann Nachrichten senden; kein rein lesender Smoke-Test.

Kein weiterer Faceless-Kauf in Production, wenn der Preview-Nachweis ausreicht.
Die kostenpflichtige Tagesvorlage bleibt bis Genehmigung und ausdrücklicher
Kostenakzeptanz deaktiviert.

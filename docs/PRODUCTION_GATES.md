# Production Gates

Stand: 23. September 2026.

## Ziel

Kostenpflichtige Medienproduktion und spätere Veröffentlichung dürfen nicht mehr
direkt aus einem UI-Klick oder aus einem Agententext entstehen. Der Orchestrator
erstellt und speichert zuerst den Content-Plan. Danach folgen getrennte,
persistente Freigabestufen.

## Video-Lernphase

Die ersten 15 erfolgreich abgeschlossenen Videos werden zwingend mit dem Provider
`faceless_video` im Modus `FACELESS_STORYBOARD` vorbereitet. Ein Wunsch nach
Runway wird während dieser Lernphase ignoriert.

Erst ab 15 erfolgreichen Video-Produktionen darf die Renderer-Auswahl erweitert
werden. Bis belastbare Performance-Daten vorliegen, bleibt Faceless der Standard.

Die Zahl zählt ausschließlich `production_runs` mit
`content_type='video'` und `status='ready'`. Abgebrochene, fehlgeschlagene
oder nur geplante Läufe zählen nicht.

## Spend Gate

Ein Video-Produktionslauf beginnt mit `needs_provider_quote`.

Vor einem kostenpflichtigen Render müssen anschließend diese Schritte erfüllt sein:

1. Offiziellen Faceless.so-Katalog und Credit-Saldo kostenlos abfragen. Kosten in
   Credits anzeigen; ohne belastbare Umrechnung keinen EUR-Betrag behaupten.
2. `approval_requests` mit den geschätzten Kosten persistieren.
3. Freigabenachricht per WhatsApp an den fest konfigurierten Approver senden.
4. Nur eine explizite Freigabe setzt den Lauf auf `approved_for_spend`.
5. Erst aus `approved_for_spend` wird der einmalige kostenpflichtige
   `POST /videos` atomar vor dem Netzwerkaufruf in Postgres beansprucht.

Ein unklarer Provider-Ausgang bleibt gesperrt; keine automatische Wiederholung.
Erst nach bestätigter Generierung startet genau ein kostenloser MP4-Render.

## WhatsApp

Webhook: `/api/whatsapp/webhook`

- GET: Meta Challenge mit `WHATSAPP_VERIFY_TOKEN`.
- POST: Signaturprüfung von `x-hub-signature-256` mit `META_APP_SECRET`.
- Nur Textnachrichten werden als Entscheidungen ausgewertet.
- Nur `WHATSAPP_APPROVER_WA_ID` darf eine Freigabe verändern.
- Provider-Message-IDs werden dedupliziert.
- Antwort auf die Freigabenachricht wird bevorzugt über den WhatsApp-Kontext
  eindeutig zugeordnet. Ohne Antwortkontext wird nur dann zugeordnet, wenn genau
  eine versandbestätigte offene Freigabe existiert.
- Nur eindeutige Formulierungen wie „Freigeben“ oder „OK, freigeben“ erlauben
  die nächste Spend-Stufe. Ein bloßes „ja“ reicht absichtlich nicht.
- Freier deutscher Text wird als `changes_requested` gespeichert. Der
  Orchestrator übergibt konkrete Szenen-, CTA- und Tempoänderungen an den
  Video-Agenten und persistiert eine neue Revision. Im Referenzmodus werden
  unklare Änderungswünsche ausdrücklich zurückgewiesen. Danach sind eine neue
  redaktionelle Freigabe, neue Quote und neue WhatsApp-Freigabe erforderlich.

## Faceless.so

Offizieller Vertrag: https://faceless.so/developers/docs/reference

- `GET /me`, `GET /options?kind=models`, `GET /voices` prüfen kostenlos Konto,
  Storyboard-Preis und verfügbare deutschsprachige Sprecher. Im Katalog sind für
  `storyboard` zurzeit 20 Credits dokumentiert; die Live-Quote ist maßgeblich.
- Der Content-Orchestrator erstellt den Sprechtext vor der Provider-Aktion.
  Eine kostenlose, unabhängig bearbeitbare Storyboard-Draft-API ist nicht
  dokumentiert. Der Provider akzeptiert einen Sprechtext und wählt seine Bilder;
  unsere einzelnen visuellen Szenenanweisungen sind nicht als editierbare Szenen
  übertragbar.
- `POST /videos` mit `model: storyboard`, `script`, `voiceId` und
  `Idempotency-Key` kostet Credits bereits beim Erstellen. Der Schlüssel und die
  beanspruchte Aktion werden vorher in Postgres persistiert. Keine automatische
  Wiederholung eines kostenpflichtigen Aufrufs.
- `GET /videos/{id}/status` bis `completed` oder `failed`. Danach einmal
  `POST /videos/{id}/render` (kostenlos) und `GET /renders/{id}` bis `done` mit
  fertiger URL oder `error`. Unklare Ergebnisse werden nur lesend abgeglichen.
- Fehler wie fehlende Credits, Berechtigungen und 429 stoppen die Aktion;
  unbekannte Ergebnisse starten weder einen zweiten Videokauf noch einen
  zweiten Render.

Migration `003_faceless_so.sql` ergänzt die persistenten Start- und Render-Claims;
sie muss nach dem Preview-Deploy über `/api/admin/migrate` ausgeführt werden.

Die bereits existierenden Vercel-Secrets mit Präfix `WHATTSAPP_` werden aus
Kompatibilitätsgründen für Access-Token, Phone-Number-ID und Business-Account-ID
akzeptiert. Kanonische `WHATSAPP_`-Namen haben Vorrang. Verify-Token,
Meta-App-Secret und Approver-ID müssen gesondert konfiguriert werden.

## Noch nicht aktiviert

- Kein Faceless.so-Render, bis Preview-Konfiguration, Migration und echte
  WhatsApp-Freigabe geprüft wurden.
- Kein Runway-Render über den neuen Produktionsweg.
- Keine automatische Facebook-/Instagram-Veröffentlichung.
- Keine automatische Wochenbilanz.

Der alte Runway-10-Sekunden-Pfad bleibt nur als Legacy-Teststudio sichtbar und
gehört nicht zum neuen Produktions-Gate.

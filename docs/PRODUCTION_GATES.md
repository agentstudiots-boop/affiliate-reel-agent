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

1. Provider-Konfiguration und exakte Kosten ermitteln, ohne Credits auszugeben.
2. `approval_requests` mit den geschätzten Kosten persistieren.
3. Freigabenachricht per WhatsApp an den fest konfigurierten Approver senden.
4. Nur eine explizite Freigabe setzt den Lauf auf `approved_for_spend`.
5. Erst aus `approved_for_spend` darf ein Provider-Job gestartet und als
   `rendering` persistiert werden.

`markRendering` verweigert jeden anderen Ausgangszustand.

## WhatsApp

Webhook: `/api/whatsapp/webhook`

- GET: Meta Challenge mit `WHATSAPP_VERIFY_TOKEN`.
- POST: Signaturprüfung von `x-hub-signature-256` mit `META_APP_SECRET`.
- Nur Textnachrichten werden als Entscheidungen ausgewertet.
- Nur `WHATSAPP_APPROVER_WA_ID` darf eine Freigabe verändern.
- Provider-Message-IDs werden dedupliziert.
- Antwort auf die Freigabenachricht wird bevorzugt über den WhatsApp-Kontext
  eindeutig zugeordnet.
- Nur eindeutige Formulierungen wie „Freigeben“ oder „OK, freigeben“ erlauben
  die nächste Spend-Stufe. Ein bloßes „ja“ reicht absichtlich nicht.
- Freier deutscher Text wird als `changes_requested` gespeichert und ist
  später vom Orchestrator als Überarbeitungsauftrag zu verarbeiten.

## Faceless.video

`FACELESS_API_KEY` ist als serverseitige Konfiguration vorgesehen. Der direkte
API-Adapter ist absichtlich noch nicht implementiert.

Grund: Der öffentlich auffindbare Developer-Bereich von Faceless.video ist
login-geschützt. Andere öffentlich dokumentierte Endpoints mit ähnlichem Namen
gehören nicht automatisch zu Faceless.video und dürfen nicht geraten werden.

Vor Implementierung müssen für das tatsächlich verbundene Faceless.video-Konto
offiziell bestätigt werden:

- Quote / Cost Preview ohne Credit-Verbrauch
- Erstellung eines Storyboard-Drafts
- Draft lesen und überarbeiten
- Render mit exakter Confirmation / Idempotenz
- Status abrufen
- Ergebnis-URL
- Fehler- und Rate-Limit-Vertrag

Wenn der Provider eine Quote-/Confirm-Mechanik anbietet, ist diese zusätzlich
zum internen WhatsApp-Gate zu verwenden, nicht an dessen Stelle.

## Noch nicht aktiviert

- Kein Faceless.video-Render.
- Kein Runway-Render über den neuen Produktionsweg.
- Keine automatische Facebook-/Instagram-Veröffentlichung.
- Keine automatische Wochenbilanz.

Der alte Runway-10-Sekunden-Pfad bleibt nur als Legacy-Teststudio sichtbar und
gehört nicht zum neuen Produktions-Gate.

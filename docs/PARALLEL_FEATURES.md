# Parallel-Erweiterungen: Revisionen und Wochenbilanz

Stand: 24. September 2026. Dieser Branch baut auf PR #6 auf und bleibt bis zur
Integration getrennt von dessen Preview-/Production-E2E-Arbeit.

## Bild-/Text-Revision nach WhatsApp-Feedback

Eine finale Facebook-Veröffentlichungsfreigabe mit freiem Änderungswunsch
veröffentlicht niemals direkt. Der Wunsch wird in `publication_requests`
gespeichert. Der Orchestrator erzeugt daraus im regelbasierten Referenzmodus eine
neue Bild- oder Textfassung, sofern der Wunsch eindeutig und sicher umsetzbar ist.

Unterstützte natürliche Änderungsrichtungen sind unter anderem:

- kürzer / kompakter / weniger Text
- weniger werblich / sachlicher / neutraler
- Hook, Titel oder Überschrift kürzer
- CTA sachlicher bzw. weniger werblich
- bei Carousels weniger Folien
- bei Textposts fachlicher oder Community-Frage am Ende

Unklare Wünsche werden nicht geraten. Das System fordert stattdessen eine
konkretere Formulierung an.

Nach einer erfolgreichen Revision wird der Content-Job wieder auf
`awaiting_approval` gesetzt. Bei automatischen Tagesentwürfen wird die
redaktionelle WhatsApp-Freigabe erneut geöffnet. Erst nach erneuter Content-
Freigabe kann eine neue Veröffentlichungsfreigabe entstehen.

Migration `007_publication_revisions.sql` versieht Publication Requests mit
Revisionen. Alte Freigaben werden nicht überschrieben. Eine neue Fassung erhält
Revision 2, 3 usw.; damit bleibt der Freigabeverlauf auditierbar.

## Wochenbilanz

Der Production-Cron `/api/cron/weekly-report` ist für Montag 08:15 UTC geplant
und fasst die abgeschlossene Vorwoche zusammen.

Der Bericht verwendet ausschließlich vorhandene Daten:

- veröffentlichte Facebook-/Instagram-Beiträge
- in dieser Woche neu gespeicherte Klick-/Conversion-Messstände
- gespeicherte Affiliate-Erlöse
- bekannte Produktionskosten
- Anzahl kostenpflichtig gestarteter Faceless-Läufe und deren gespeicherte
  Credit-Quote
- Facebook-/Instagram-Follower read-only über Meta, soweit der bestehende Token
  diese Felder lesen darf

Nicht verfügbare Daten werden ausdrücklich als nicht verfügbar oder unbekannt
ausgewiesen. Es werden keine Werte geschätzt.

Migration `008_weekly_reports.sql` speichert jede Wochenbilanz und ihre
WhatsApp-Zustellung persistent. Vor jedem externen Versand wird ein dauerhafter
Claim geschrieben. Ein unklarer Versand wird nicht automatisch wiederholt.

## WhatsApp-Zustellung

Innerhalb des 24-Stunden-Servicefensters kann die vollständige Wochenbilanz als
normale WhatsApp-Nachricht gesendet werden.

Außerhalb dieses Fensters bleibt die Funktion standardmäßig deaktiviert. Optional
kann eine separat von Meta genehmigte reine Benachrichtigungsvorlage verwendet
werden. Erst eine Antwort `Wochenbilanz` auf diese Benachrichtigung öffnet das
Servicefenster und liefert den vollständigen Bericht. Die Benachrichtigung kann
keine Freigabe auslösen.

Erforderliche optionale Variablen:

- `WHATSAPP_WEEKLY_REPORT_TEMPLATE_NAME`
- `WHATSAPP_WEEKLY_REPORT_TEMPLATE_LANGUAGE`
- `WHATSAPP_WEEKLY_REPORT_TEMPLATE_ENABLED=true`

Die Aktivierung darf erst nach Meta-Genehmigung und bewusster Prüfung der
Nachrichtengebühren erfolgen.

## Integration nach PR #6

1. PR #6 vollständig im Preview und in Production verifizieren.
2. Diesen Branch auf den dann aktuellen Stand von PR #6 bzw. `main` bringen.
3. Quality-Checks erneut ausführen.
4. Migrationen 007 und 008 im Preview anwenden und idempotent erneut aufrufen.
5. Bild-/Text-Revision mit einem kontrollierten WhatsApp-Änderungswunsch prüfen.
6. Wochenbericht zunächst ohne kostenpflichtige Vorlage erzeugen und DB-Inhalt
   prüfen.
7. Erst nach genehmigter Wochenvorlage die initiierte WhatsApp-Benachrichtigung
   aktivieren.

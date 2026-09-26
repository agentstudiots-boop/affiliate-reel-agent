# Natürliche WhatsApp-Anweisungen

Stand: 26.09.2026. Ergänzung des bestehenden Orchestrators, keine neue Agentenarchitektur.

## Ablauf und Identität

Signaturprüfung und erlaubte Betreiber-Nummer bleiben Pflicht. Eine freie Nachricht
wird vor jeder Interpretation dauerhaft mit ihrer originalen WhatsApp-Message-ID
beansprucht. `whatsapp_instructions.message_id` ist zugleich Primärschlüssel und
Fremdschlüssel zum vorhandenen `whatsapp_events`-Datensatz. `job_id` verweist auf
`content_jobs.id`; dieses vorhandene Identitätsfeld wird im Parser-Kontext als
`content_id` bezeichnet. Keine zweite Content-Identität, keine Produktkopie in einer
parallelen Tabelle.

Der Parser erhält ausschließlich den eindeutig zugeordneten aktuellen Job: Produkt
mit Name, ASIN und verifiziertem Affiliate-Link, ausgewähltes Creative, Bildbriefing,
Caption, Use Case und Status. Ohne eindeutigen Nachrichtenbezug bei mehreren offenen
Vorgängen folgt eine Rückfrage, kein Modellaufruf. Während der Interpretation werden
alte Plan-/Veröffentlichungsfreigaben gesperrt. Vor Anwendung wird der gespeicherte
Job erneut gesperrt und mit dem ursprünglichen Kontext verglichen.

`Freigeben` und `Ablehnen` verwenden die bestehenden eindeutigen Steuerbefehle ohne
Modellkosten. Insbesondere darf ein vom Modell geratenes `approve` keinen Gate-Schritt
auslösen. Die vorhandene ausdrückliche Kostenfreigabe für den Tagesentwurf und die
getrennte Veröffentlichungsfreigabe behalten ihre jeweilige Bedeutung.

## Modell und Kosten

Ein begrenzter Chat-Completions-Aufruf über den vorhandenen Vercel-Stack / AI Gateway,
Modell `openai/gpt-5.4-mini`. Keine neue SDK- oder Provider-Paketabhängigkeit. Authentisierung
mit `AI_GATEWAY_API_KEY` oder dem von Vercel pro Request bereitgestellten
`x-vercel-oidc-token`; `VERCEL_OIDC_TOKEN` bleibt für Build/lokale Ausführung unterstützt.
Gateway-Zugang, Modellverfügbarkeit und Guthaben müssen im Zielprojekt funktionieren.
Eine Konfiguration ist kein Nachweis eines erfolgreichen Live-Modellaufrufs.

Strict JSON Schema, zusätzliche Schlüssel verboten, Confidence mindestens 0,85,
maximal 4.000 Zeichen Betreibertext / 22.000 Zeichen Kontext und 1.200 Ausgabetoken,
20 Sekunden Timeout. Keine Tools, Retries, Provider-Fallbacks oder Dauerschleifen.
Der Parser darf nur Absicht, Anweisungen und erlaubte Textoperationen zurückgeben;
er hat keine Veröffentlichungs-, Bild-, Video- oder Produktauswahlwerkzeuge.

Fehlende Authentisierung, unvollständige/ungültige Ausgabe, geringe Sicherheit oder
Widerspruch führen zu `clarify`. Dieselbe eingegangene Nachricht wird auch nach
Timeout/Abbruch nicht erneut interpretiert. Nach fünf Minuten kann eine neue
Betreibernachricht einen abgebrochenen Vorgang klären. Unklare Nachrichten- oder
Versandergebnisse werden nicht automatisch wiederholt.

Offizielle Grundlagen, geprüft am 26.09.2026:
- https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions
- https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs
- https://ai-gateway.vercel.sh/v1/models

## Revisionen und Grenzen

- `revise_image`: neue Bildbeschreibung aus Anweisung und bestehendem Produkt;
  alle vorherigen visuellen Szenen/Folien werden ersetzt. Gleiches Produkt, gleiche
  ASIN, gleicher Affiliate-Link, gleicher Job, erhöhte Revision, erneute Freigabe.
- `revise_text`: strukturierte Operationen für natürlicheren Text, kürzeren Hook
  oder kürzere Caption. Die Textbearbeitung bleibt deterministisch; das Modell
  schreibt keine fertigen Werbetexte. Nicht darstellbare Änderungen benötigen
  Klärung. Ein vorhandenes verifiziertes Originalbild wird anhand Job, Publication,
  visuellem Fingerprint, Blob-Pfad und SHA-256 wiederverwendet. Ohne passendes Bild
  wird blockiert; eine Textrevision kann keine Ersatzgeneration kaufen.
- `revise_both`: beide Änderungen, erneute ausdrückliche Freigabe vor neuer Generation.
- `change_product`: alter Job wird `needs_input` / `product_change_required`. Produkt
  und Links werden nicht überschrieben. Neue Auswahl im Studio muss den Product Gate
  durchlaufen.
- `clarify` / `other`: Rückfrage, keine Produktion oder Veröffentlichung.

Die automatische Anwendung dieser Revisionen betrifft bestehende statische
Bild-/Facebook-Pläne. Nicht unterstützte Zustände/Formate und das vorhandene Limit
von zwei Revisionen führen zur Klärung. Das ist kein freier Video-Editing-Agent.
Ein nicht zum Tageslauf gehörender Plan wird im Studio erneut freigegeben.

Vor einem bezahlten Bildversuch prüfen sowohl Publication Gate als auch der gemeinsame
OpenAI-/Replicate-Promptbuilder den Produktbezug. Kürbisschnitzset-Briefings mit
Pasta/Pfanne/Nudeln oder ohne Kürbisbezug werden mit `visual_context_mismatch`
blockiert. Der Parser bewertet zusätzlich die semantische Passung. Für unbekannte
Produktarten ist die deterministische Prüfung konservativ und weniger spezifisch;
sie ersetzt keine menschliche Produkt- und Bildprüfung. Caption/Hook liefern keine
zusätzliche Bildszene. Die Prüfung des Briefings ist keine Vision-Prüfung der erzeugten
Pixel; das tatsächliche Bild muss weiterhin vor Veröffentlichung geprüft werden.

Angewandte Interpretation und ursprünglicher visueller Fingerprint stehen im
vorhandenen Job-Ereignisprotokoll; Parserstatus/Fehlercode und einmaliger
Benachrichtigungsversuch in `whatsapp_instructions`. Produktdaten bleiben im Snapshot
und in der bestehenden Opportunity. Die Amazon-Produktregeln bleiben verbindlich.

## Aktivierung und Nachweis

1. Migration `012_whatsapp_instructions.sql` über den bestehenden geschützten
   Migrationsweg ausführen. Frühere Migrationen werden nicht wiederholt.
2. Gateway-Zugang prüfen; eine neue Betreiber-Anweisung an die betreffende
   WhatsApp-Freigabenachricht senden. Alte bereits verarbeitete Message-IDs werden
   absichtlich nicht nachträglich wieder abgespielt.
3. Neue Bildbeschreibung in der Planfreigabe prüfen. Erst die ausdrücklich erteilte
   bestehende Kostenfreigabe darf ein neues Bild erzeugen; danach separate
   Veröffentlichungsfreigabe.

Automatisierte Tests verwenden kontrollierte Modellantworten und echte SQL-/Webhook-
Übergänge. Sie prüfen die Verarbeitung der sechs Beispielklassen, Kontextbindung,
Idempotenz, blockierte alte Freigaben, keine direkte Medien-/Publikationsaktion,
Produktänderungssperre, falsche Motive, Bildwiederverwendung und erneute Freigabe.
Sie sind kein Live-Benchmark der Modellklassifikation. Ein Live-Test bleibt bis zu
Schemaaktivierung und einer echten neuen Betreiber-Nachricht offen.


## Korrektur nach Live-Rückmeldungen um 11:31–11:32 Uhr

Drei Nachrichten wurden ohne Antwortbezug bei zwei offenen Veröffentlichungsanfragen
als `clarify` gespeichert, noch bevor ein Modell aufgerufen wurde. Die identische
Rückfrage vermischte fehlende Auftragszuordnung mit Verständnisproblemen.

Jetzt kann eine eindeutige ASIN, Job-ID oder unterscheidbare Produktnennung unter
den bestehenden offenen Jobs den Bezug festlegen. Kurze Folgeantworten nutzen den
zugeordneten Dialog desselben Betreibers (höchstens 30 Minuten / zwölf Nachrichten).
Mehrere genannte Produkte bleiben mehrdeutig. Es wird niemals einfach der neueste
Job gewählt. Antworten auf neu versendete Rückfragen behalten ebenfalls den Jobbezug.

Die bereits vorhandene JSONB-Spalte `interpretation` speichert nun eine Hülle mit
`instruction` (streng validierte Modellantwort), `routing` und `notice_message_id`.
Alte flache Interpretationen bleiben lesbar; keine neue Migration oder Content-ID.

Der Gateway-Token wird im signaturgeprüften Webhook zusätzlich aus dem aktuellen
Vercel-Request gelesen. Tokens gelangen weder in Jobs noch in Logs oder Modellkontext.
Fehlender Zugang, Abrechnungsprobleme und Providerfehler werden als technische Fehler
benannt und mit festem Fehlercode gespeichert, nicht als unklare Betreiberanweisung.

Offizielle Laufzeit-Authentisierung: https://vercel.com/docs/oidc/reference
Tests ergänzen zwei offene Produkte, kurze Folgeantworten, Kontextwechsel,
Request-Token ohne statische Umgebungsvariable und Rückfragen mit technischem Fehler.

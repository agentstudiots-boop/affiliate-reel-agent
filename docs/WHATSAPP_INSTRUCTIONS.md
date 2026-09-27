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

Ein begrenzter Textaufruf über den bereits vorhandenen Replicate-Zugang,
Modell `openai/gpt-4.1-nano`, `REPLICATE_API_TOKEN`. Keine zusätzliche Abhängigkeit,
kein neues Konto, kein Gateway- oder Google-Billing und kein Provider-Fallback.
Die konkrete Textmodell-Verfügbarkeit muss live bestätigt werden; ein vorhandener
Token oder früherer Bildaufruf beweist das noch nicht.

Offizielles Schema: https://replicate.com/openai/gpt-4.1-nano/api/schema
Der Replicate-Endpunkt unterstützt `system_prompt`, `prompt`, `temperature` und
`max_completion_tokens`, aber kein `response_format` für serverseitig erzwungenes
JSON Schema. Deshalb fordert der Systemprompt das vollständige Schema; die Anwendung
akzeptiert ausschließlich ein JSON-Objekt, das die strikte Zod-Prüfung besteht.
Markdown, zusätzliche Felder oder ungültige Daten können keine Aktion auslösen.

Confidence mindestens 0,85, maximal 4.000 Zeichen Betreibertext / 22.000 Zeichen
Kontext und 1.200 Ausgabetoken, Temperatur 0. Genau ein POST je Nachricht;
`Prefer: wait=20`, serverseitig `Cancel-After: 40s`, anschließend höchstens acht
GET-Statusabfragen derselben Prediction. Keine zweite Inferenz bei Fehler/Timeout. Keine Tools.
Der Parser darf nur Absicht, Anweisungen und erlaubte Textoperationen zurückgeben;
er hat keine Veröffentlichungs-, Bild-, Video- oder Produktauswahlwerkzeuge.

Technische Fehler werden getrennt als `parser_*` protokolliert. Geringe Sicherheit,
Schemafehler oder Widersprüche führen zu einer Rückfrage ohne Aktion. Dieselbe eingegangene Nachricht wird auch nach
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


## Bestätigtes Sprachgedächtnis (Migration 013)

`operator_language_examples` speichert nur kurze, ausdrücklich bestätigte Beispiele
in derselben Postgres-Datenbank. Kein Fine-Tuning und kein Export nach GitHub.
Ein erfolgreich angewendeter Änderungswunsch ist noch kein Lernbeispiel. Erst die
eindeutige WhatsApp-Freigabe des überarbeiteten Tagesplans bestätigt die letzte
strukturierte Revision in derselben Transaktion. Zwischenzeitliche andere Änderungen
verhindern die Übernahme einer alten Interpretation. Die bestehenden Kosten- und
Publikationsgates bleiben unverändert. UI-Freigaben lernen vorerst keine Beispiele.

Gespeichert werden Betreiber, ursprüngliche Message-ID, Bestätigungs-ID, kurze
Formulierung, validierte Interpretation, bestehende `content_id`, Produktname/ASIN
und Zeitstempel. Nur Nachrichten bis 1.000 Zeichen werden übernommen. Keine komplette
WhatsApp-Historie, keine Zugangsdaten. Die bestehende operative Ereignistabelle bleibt
unverändert und ist kein ungefilterter Lernspeicher.

Eine ausdrücklich als Korrektur formulierte Antwort (z. B. „Nein, ich meinte …“) auf
die zugeordnete Rückmeldung verknüpft das ursprüngliche Beispiel. Erst nach Freigabe
wird die Korrektur als neuer höher gewichteter Datensatz gespeichert; alte Daten werden
nicht überschrieben. Derzeit gilt dies für direkte Antworten auf Parser-Rückmeldungen,
nicht für beliebige unzugeordnete Aussagen über frühere Gespräche.

Vor der Interpretation werden höchstens 80 bestätigte Beispiele desselben Betreibers
lokal nach Wortüberlappung, Produktbezug und Korrekturpriorität sortiert. Höchstens fünf
unterschiedliche Formulierungen gehen an das Modell. Der Few-Shot-Kontext enthält
nur Formulierung, Intent und Textoperationen; alte Bildbriefings, IDs und Produktdaten
werden daraus entfernt. Bei weniger passenden Beispielen werden keine erfunden.
„Freigabe“ bleibt ein exakter bestehender Gate-Befehl; gelernte Beispiele können die
Liste zulässiger Freigabebefehle nicht erweitern.

Bis Migration 013 angewendet ist, bleibt das Sprachgedächtnis leer und der Kernparser
arbeitet ohne Beispiele. Keine automatische Migration im Webhook. Migration über
`/api/admin/migrate`; bestehende Migrationen werden nicht wiederholt.

# WhatsApp: semantischer Router (freie Sprache) – technischer Bericht

Stand 01.10.2026. Lokal getestet; **über den echten WhatsApp-Pfad noch nicht bestätigt** (siehe E2E-Plan).

## A. Bisherige Architektur
Webhook (`app/api/whatsapp/webhook/route.ts`) → feste Kette von Schlüsselwort-/Regex-Stufen:
`Status` → `startImagePostFromWhatsApp` (Regex für „Artikelsuche …“, „Bildpost …“, „Neuer Auftrag …“) →
`answerWhatsAppConversation` (Regex `conversationalMessage`: „?“ oder Verbliste) → `handleContentApproval` →
`processOperatorInstruction` (Zielwahl per Regex/Wortvergleich, **danach** ein Modellaufruf nur für Bild-/Textänderung am
bekannten Entwurf) → `applyIncomingWhatsApp` (Wortlisten „freigeben/ablehnen“). Die erste Stufe, die passt, gewinnt.

## B. Wo Kontext und Bedeutung verloren gingen
1. **Roh­nachricht** kommt unverändert an (`extractIncomingWhatsAppMessages`: nur Typ `text`, Body unverändert; andere
   Nachrichtentypen wie Sprache/Bild/Buttons werden ignoriert). Verlust entsteht erst danach.
2. **Modell sah fast nichts:** Chat-Modell: Nachricht, Name des zitierten Produkts, letzte 6 Chatturns. Änderungs-Parser: Nachricht +
   *ein* Auftrag (Produkt, Status, Creative, Inhalt). Beide sahen **nicht**: andere offene Entwürfe, ASIN-/Statuslage, Freigabestufe,
   Produkte/Ablehnungen der letzten 7 Tage, 7-Tage-Sperre, frühere Änderungswünsche, den Verlauf der Freigabenachrichten.
3. **Absicht wurde vor dem Modell per Regex entschieden.** „Finde ein Artikel Silpat Matte“, „Nee, such lieber …“, „Lass den Auftrag …“
   passten auf keine Regex oder auf die falsche. Das Modell kannte keine Absicht „Produkt ersetzen + Suchbegriff“.
4. **Zustand pro Nachricht:** Zielauswahl ohne Zeitbezug; alte, nie abgeschlossene Entwürfe blieben Kandidaten („Welchen Auftrag meinst du?“).
5. **Produktwechsel hinterließ Zombies/falsche Sperren:** abgelehnte Entwürfe blieben `awaiting_approval` oder gaben die Familie nicht frei.

## C. Tatsächliche Ursache
Nicht das Modell, sondern Ablaufsteuerung: Regex-Routing **vor** dem Modell, minimaler Kontext, kein Modell für „Produkt ersetzen/suchen“,
Zielauswahl ohne Zeit/Zustand. Ein stärkeres Modell hätte daran nichts geändert, weil es diese Nachrichten nie sah.

## D. Änderungen (Architektur)
```
WhatsApp → Webhook (Signatur, Rohtext) → Router
  literale Tore („Freigeben“, „Ablehnen“, „Nein“, „Status“, „Weiter“, „Entwurf“, „Wochenbilanz“) → unverändert deterministisch
  sonst: Kontext laden (Datenbank) → EIN Modellaufruf (nur Absicht, strukturierte Ausgabe, zod strict)
       → Validator (unbekannte IDs verworfen, niedrige Sicherheit/hohe Mehrdeutigkeit = Rückfrage)
       → deterministische Ausführung über bestehende Bausteine:
           search_product  → alten Entwurf sauber stoppen (wie „Ablehnen“) + Suche (createDailyDraft, 7-Tage-/Dublettenlogik)
           revise_*        → Ziel auflösen (zitierte Freigabenachricht), danach der bestehende, geprüfte Änderungsweg
           reject_current  → echtes Ablehn-Tor (Text „Ablehnen“ auf die Freigabenachricht)
           approve_attempt → nie Freigabe; Hinweis auf ausdrückliches „Freigeben“
           question/chitchat → Gespräch mit Systemfakten (offene Freigaben, Produkte 7 Tage) – startet nie eine Pipeline
           status          → deterministische Auskunft aus der Datenbank
Fehler/kein Modell → die bisherige Schlüsselwortkette übernimmt (Router blockiert nie eine Nachricht; Kill-Switch `WHATSAPP_ROUTER_ENABLED=false`).
```
Modellkontext (`route-context.ts`): aktuelle Nachricht (≤1500 Zeichen), offene Freigaben (content_id = Job-ID, Produkt, ASIN, Stufe,
Freigabe-Nachrichten-ID, Beitragsauszug), zitierter Eintrag, letzte Nachrichten (6 h), Produkte der letzten 7 Tage mit Zustand
(veröffentlicht/abgelehnt/ersetzt/wartet), letzte Änderungswünsche. Keine Secrets, keine Tokens.
Produktwechsel: Entwurf → `needs_input`, Content-/Veröffentlichungsfreigabe-Anfragen abgelehnt, **Familiensperre frei, ASIN-Sperre
bleibt 7 Tage** (kein sofortiges Wiederanbieten), neue Suche mit neuer Job-ID (content_id). Idempotenz: `whatsapp_routes` je
Nachrichten-ID (Wiederholung = kein zweiter Modellaufruf, keine zweite Antwort).
Logging (`whatsapp_route`, ohne Secrets): raw_message (≤300), normalized_message, wa_message_id, active_content_id, active_state,
Anzahl offener Einträge, intent, search_query, reject_current, confidence, ambiguity, action, pipeline; Tabelle `whatsapp_routes`
hält Roh­nachricht, Route und Kontextzusammenfassung. Fehler: `whatsapp_route_failed`, `whatsapp_route` mit stage `interpret_failed`.

## E. Geänderte/neue Dateien
Neu: `lib/whatsapp/router.ts`, `route-context.ts`, `route-llm.ts`, `db/migrations/024_whatsapp_routes.sql`, `tests/whatsapp-router.test.cjs`.
Geändert: `app/api/whatsapp/webhook/route.ts`, `lib/whatsapp/start-image-post.ts` (`startProductSearch`), `replace-draft.ts`,
`chat.ts` (Systemfakten, `force`), `memory/migrations.ts`, `ensure-automation-schema.ts`, Tests (Migrationsliste u. a.).

## F/G. Tests (lokal 217/217 erfolgreich; explizite Befehle und Produktlinks umgehen das Modell inkl. Lint/Build)
`tests/whatsapp-router.test.cjs` (12): literale Tore; „Nein, nimm ein anderes Produkt.“; „Such mir stattdessen eine Silbermatte.“;
„Nimm etwas Ähnliches, aber günstiger.“ (ehrliche Preisanmerkung); „Such was Neues.“; „Das Produkt passt, aber mach das Bild neu.“;
„Ändere nur den Text.“; „Warum hast du das Produkt ausgewählt?“; „Was ist gerade noch offen?“; „Mach weiter.“; „Nicht veröffentlichen.“;
„Passt so, raus damit.“ – jeweils in den Zuständen kein/ein/zwei offene Entwürfe, zitiert/nicht zitiert, Kostenfreigabe-Antwort;
Validator (erfundene IDs, niedrige Sicherheit, Modellausfall → Rückfall, Wiederholung); Kontext-Vollständigkeit; **Webhook-End-to-End
mit echter Handler-Quelle** (signiert → Router → Modellaufruf mit Kontext-Prüfung → Datenbank → Pipeline-Aufruf → Antwort → Wiederholung).

## H. Nur lokal getestet
Alles. Das Modell ist in den Tests **simuliert** (eine Tabelle Satz → Absicht). Ob `openai/gpt-5.6-terra` diese Sätze real richtig
einordnet, ist nicht belegt. Vercel-Logs sind wegen Billing-Limit nicht lesbar.

## I. Über den echten WhatsApp-Pfad bestätigt
Noch nichts. E2E-Plan (nur senden, Reihenfolge einhalten; ⚠ = löst kostenpflichtige Planung aus):
1. „Was ist gerade noch offen?“ → Erwartung: Liste der offenen Freigaben oder „nichts offen“ (kein Modellfehler).
2. „Warum hast du eigentlich dieses Produkt ausgewählt?“ (auf eine Freigabenachricht antworten) → Antwort ohne Aktion; Status unverändert.
3. „Der Text gefällt mir, aber das Bild nicht.“ (auf die Freigabenachricht antworten) → Bildänderungsweg, Produkt bleibt.
4. ⚠ „Nee, das Produkt will ich nicht. Such mir lieber eine Silbermatte.“ → „Alten Entwurf … gestoppt. Ich suche jetzt „Silbermatte“ …“, danach neue Inhaltsfreigabe.
5. „Nicht veröffentlichen.“ (auf die neue Freigabenachricht) → Entwurf abgelehnt.
6. „Passt so, raus damit.“ → nur Hinweis auf „Freigeben“, nichts freigegeben.
Prüfung danach: „Status“ (Grund/Stand) und Log-Ereignisse `whatsapp_route` (intent, action, confidence). Schick mir die Antworten bzw. Log-Zeilen.

## J. Risiken / offene Punkte
- Modellqualität unbelegt; bei Unsicherheit wird gefragt, bei Modellausfall greift die alte Schlüsselwortkette (dann wieder die alte Fehleranfälligkeit).
- Ein Modellaufruf je freier Nachricht (Kosten, Latenz ~ Sekunden); kein Kostenlimit pro Tag außer dem bestehenden Chat-Limit (nur Gespräch).
- Änderungswünsche zum Text sind weiter auf die geprüften Operationen begrenzt (`shorten_hook`, `naturalize`, `shorten_caption`); freie Umschreibungen führen zur Rückfrage.
- Nicht-Text-Nachrichten (Sprache, Bild, Buttons) werden vom Webhook ignoriert.
- „Ähnlich, aber günstiger“: Preise sind nicht belegt; es wird nach Produktart gesucht und das offen gesagt.
- Mehrere offene Entwürfe: Rückfrage statt Raten; ist der Verlauf mehrdeutig, bleibt es bei einer Rückfrage.

## Nachtrag 01.10.2026, 19:35 (produktiver Verlauf): Fragepfad und Produktdaten

**Beobachtet:** „was gerade offen“ → deterministische Router-Antwort (funktioniert). „Warum hast du eigentlich dieses Produkt ausgewählt?“ und die
Folgefrage → „Ich konnte gerade keine sichere Antwort formulieren …“. Logs waren nicht lesbar; die Analyse folgt dem Code.

**Ursache Fragepfad (Code-Befund, Logbeleg fehlt):**
1. Zwei bezahlte Modell-POSTs je Frage (Router, dann Chat) kurz hintereinander; der Chat-Pfad hatte keine Behandlung für HTTP 429 (der
   Replicate-Zugang ist laut `model.ts` gedrosselt: Mindestabstand 11 s) und loggte keinen Fehlergrund. Jeder Fehler endete in derselben Fallback-Antwort.
2. Selbst bei Erfolg fehlte dem Chat die Antwortgrundlage: Der Kontext kannte nur *offene* Entwürfe; das Produkt war nach dem früheren Wechsel
   gestoppt, also ohne Fokus. Auswahlgrund (Trendscout/Suchbegriff), Produktdaten und deren Grenzen standen nicht im Kontext.
Der Abbruch lag im Chat-Executor (Modellaufruf), nicht im Validator oder Kontextaufbau des Routers; der Router erkannte die Absicht (`question`).

**Fixes:** `context.focus` (zitierte Freigabenachricht → einziger offener Entwurf → zuletzt bearbeitetes Produkt der letzten 6 h; bei mehreren
offenen Entwürfen ohne Zitat **kein** Fokus, stattdessen Rückfrage) mit Produkt, ASIN, Zustand, Auswahlgrund, Anwendung im Plan, belegten Produktdaten,
Datengrenzen. Fragen werden im selben Modellaufruf beantwortet (`answer`); fehlt sie, greift der Chat mit denselben Fakten. HTTP 429 wird einmal nach der
genannten Wartezeit wiederholt (sicher, da vor der Inferenz abgelehnt), Fehlergrund wird geloggt (`whatsapp_chat_unavailable.reason`, `router_http_429`).
Logging je Nachricht: inbound_message_id, reply_to_message_id, resolved_job_id/content_id, resolved_product_name, asin, candidate_job_ids, focus_source,
intent, confidence, context_fields_supplied, answer_status, abort_reason (ohne Secrets). Produktnamen werden entschlüsselt/normalisiert und an Wortgrenzen gekürzt.

**Ursache falsche Produktbeschreibung (Befund):** Keine Vermischung von Snapshots und kein falscher Snapshot belegt. `opportunity.useCase` kam aus der
Trendscout-Idee (`candidate.reelIdea`, Kategorieebene: „Silikon-Backmatte“ → Teig ausrollen/Arbeitsfläche) und wurde ungeprüft auf das konkret gefundene
Amazon-Angebot angewandt; `verifiedFacts` war leer, gespeichert sind nur Titel/ASIN. Der Titel beschreibt eine Backofen-/Knusper-Matte mit Noppen, nicht eine
Ausroll-Unterlage. Die Auflösung prüft zudem nur, ob irgendein Wort ≥4 Buchstaben im Live-Titel vorkommt – eine Kategorie-Verwechslung ist so möglich.
Antwort auf „Fehlerhafte Daten oder Halluzination?“: **keine falschen Datenbankdaten, sondern eine nicht belegte Anwendung (Kategorie-Idee), die der Content als Tatsache ausformulierte.**
Ob Textmodell oder Vorlage die Formulierung „Teig ausrollen“ lieferte, ist ohne den Datensatz nicht belegt.

**Harte Regel (neu):** `lib/content/claim-support.ts`: Funktionen/Eigenschaften (Teig ausrollen, Spülmaschine, Mikrowelle, Gefrieren, Grill, Heißluftfritteuse,
lebensmittelecht/BPA-frei, Antihaft, Hitzebeständigkeit, wiederverwendbar, leicht zu reinigen, knusprig) und Zahlen mit Einheit müssen im Titel oder in `verifiedFacts`
stehen. Wirkung: Scout-Idee wird bei Lücken verworfen (neutraler Anwendungstext), fertiger Plan mit unbelegter Aussage → `needs_input`/`product_data_uncertain`, keine
Inhaltsfreigabe, WhatsApp-Rückmeldung; zusätzlich blockiert das Veröffentlichungstor ältere Entwürfe mit unbelegten Aussagen. Grenze: Mustergestützt (Liste oben);
neue Funktionsaussagen außerhalb der Liste werden nicht erkannt und bräuchten weitere Regeln oder echte Produktdaten (Bulletpoints/Beschreibung werden nicht gespeichert).

## Nachtrag 01.10.2026, 20:12–20:14: Bildänderung scheiterte mit HTTP 429 im Instruction-Parser

Verlauf: „ich will ein anderes Bild mit halloween muffins“ (und die Folge-Nachricht als Antwort auf die Veröffentlichungsfreigabe) wurden vom Router
richtig als `revise_image` (Confidence 0,99) dem richtigen Auftrag zugeordnet. Danach rief der bestehende Instruction-Parser **ein zweites Mal** das Modell
auf (zwei bezahlte POSTs in wenigen Sekunden); der gedrosselte Replicate-Zugang antwortete mit HTTP 429, das als `parser_unavailable` (technischer Fehler,
„Sprachmodell-Zugang funktioniert nicht“) endete. Es wurde nichts produziert oder veröffentlicht (Fail-safe unverändert).

Fix: (1) **Kein zweiter Modellaufruf bei eindeutiger Lage:** Der Router liefert bei `revise_image` mit eindeutigem Auftrag, Confidence ≥ 0,9, präziser
Bildanweisung (`image_instruction`, ≥ 8 Zeichen, keine Links) und ohne Mehrdeutigkeit eine fertige Anweisung, die durch dieselbe `validateInstruction`-Prüfung
läuft (Produkt unverändert, `keep_content_id`, keine Veröffentlichung, Pflicht zur erneuten Freigabe) und an `processOperatorInstruction` übergeben wird.
Textänderungen und unsichere Fälle nehmen weiter den geprüften Parser-Weg. (2) **Backoff bei 429:** bis zu zwei Wiederholungen nach der genannten Wartezeit
(2–15 s, sicher, weil vor der Inferenz abgelehnt); danach der eigene Fehlercode `parser_rate_limited` mit ehrlicher WhatsApp-Meldung statt „Zugang
funktioniert nicht“. Die inhaltliche Prüfung (z. B. Bildwunsch passt zum Produkt, `visual_context_mismatch`) bleibt aktiv.

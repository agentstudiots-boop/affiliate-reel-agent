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

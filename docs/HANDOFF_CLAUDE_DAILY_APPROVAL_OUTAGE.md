# Übergabe: Ausfall der täglichen Inhaltsfreigabe (30.09.2026, 18:00)

Autor: zweite Prüfinstanz (Claude Code). Branch `claude/kind-cannon-nhmipo`, Basis `main` = `2d14424`.
Offene PRs zu Beginn: nur Draft-PR #10 (`feat/content-identity-history`, anderer Basisbranch, Bereich Content-IDs; keine Überschneidung mit den hier geänderten Dateien).

## Zugriff (belegt)
- Git/GitHub-MCP: Lesen/Schreiben im Repo vorhanden.
- **Nicht vorhanden:** Vercel (Deployments, Runtime-Logs, Env), Produktions-Datenbank, WhatsApp-/Meta-Zugang.
  Deshalb ist **nicht belegt**, was heute um 16:00/17:00 UTC tatsächlich passiert ist
  (Cron-Aufruf, Slot-Zustand, Fehlerstufe, Versandstatus). Nichts unten ist produktiv bestätigt.

## Befunde (aus dem Code, reproduziert mit PGlite-Tests)
1. **Kein Retry eines Slots.** `createDailyDraft` beanspruchte `(day,slot)` per `INSERT … ON CONFLICT DO NOTHING`.
   Jeder Endzustand (`failed`, `needs_input`) blieb dauerhaft; der zweite Cron-Aufruf (17:00 UTC) meldete nur
   `already_claimed`. Amazon-/Tavily-/Modellfehler im ersten Lauf = kein Ergebnis für den ganzen Slot.
2. **Hängende Claims.** Wird die Funktion beim Laufzeitlimit (`maxDuration=300`) beendet, bleibt der Slot
   `claimed`/`planning` ohne Wiederaufnahme; das Produkt blieb durch den nicht-terminalen Job sieben Tage gesperrt.
3. **Nie nachgesendete Freigabe.** Liegt die letzte Operator-Nachricht >24 h zurück und ist keine
   Business-Vorlage konfiguriert (`dailyNotificationTemplateConfigured`), wurde der Entwurf gespeichert, aber
   nie gesendet (`template_required`). Auch `approval_not_sent` hatte keinen Wiederholungsweg.
4. **Falsche Fehlerklassifikation.** Eine Ausnahme beim WhatsApp-Versand setzte einen fertigen Entwurf auf
   `failed` und gab das Produkt frei – mit Retry hätte das einen zweiten Entwurf neben einer eventuell bereits
   zugestellten Nachricht erzeugt.
- Cron-Zeiten geprüft: `07/08/16/17 UTC` + `berlinSlot` (09–10:59 bzw. 18–19:59 Berlin) sind für CEST und CET
  korrekt (Test `daily-cron-time`). Hobby garantiert nur „innerhalb der Stunde", **nicht** 18:00 exakt. Ob der Tarif
  tatsächlich Hobby ist, ist ohne Vercel-Zugang unbestätigt.
- Welcher der Punkte 1–4 heute ursächlich war, ist **nicht bewiesen**. Die Reparatur deckt alle vier ab.

## Änderungen
- Migration `022_daily_slot_retry.sql`: `daily_drafts.attempts`; `ensure-automation-schema.ts` prüft sie.
- `lib/daily/draft.ts`:
  - Geplante Slots (`morning`/`afternoon`) werden vom nächsten Cron-Aufruf atomar neu beansprucht, wenn `failed`,
    `needs_input` oder Claim älter als 7 min (abgebrochen), **maximal 3 Versuche**, nie wenn schon eine
    WhatsApp-Nachricht zugestellt wurde. Neuer Job pro Versuch, alte Sperren/Jobs werden freigegeben.
    Manuelle Aufträge (`manual:…`) bleiben einmalig.
  - Gespeicherte, ungesendete Freigaben werden bei späteren Cron-Aufrufen erneut versucht
    (`resendPendingApproval`) und über `sendPendingDailyApprovals` nachgesendet.
  - Sendefehler lassen den geplanten Entwurf `awaiting_approval` (kein zweiter Entwurf).
- `app/api/whatsapp/webhook/route.ts`: Nach jeder eingehenden Nachricht des Freigebers werden wartende
  Tagesfreigaben (≤48 h) einmal gesendet; Versand bleibt per DB-Claim idempotent.
- Tests: 4 neue Verhaltenstests in `tests/daily-automation.test.cjs` (Retry nach Fehler, keine Doppelfreigabe bei
  Wiederholung, Stale-Claim/Versuchslimit, Nachsenden nach Fensteröffnung, Sendefehler). Zwei bestehende Tests
  angepasst (Retry bei `needs_input`, Migrationsliste).
- Die Freigabenachricht enthält weiterhin Beitragstext, ASIN, Produktlink mit Tracking-ID (Test prüft `Beitragstext`,
  ASIN, `tag=alltaeglichle-21`).

## Teststand
- **Lokal:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` = 194/194 bestanden.
- **Testumgebung/Preview:** nicht durchgeführt. **Produktiv:** nicht bestätigt. **WhatsApp-Zustellung:** kein
  Versandnachweis, keine Empfangsbestätigung.

## Nicht geprüft / offen (Punkte 3–4 des Auftrags)
Nicht erneut auditiert, nur der bestehende Teststand gesichtet (194 Tests grün): 7-Tage-Sperre (`product-lock`),
Artikelsuche-Neustart, Zuordnung neuer Nachrichten, Bildänderungs-Erkennung („Mach das Bild mit geschnitzten
Kürbissen" hat keinen exakten Test; ein ähnlicher Satz steht in `whatsapp-instruction.test.cjs:320`), Modellzugang ohne
Vercel AI Gateway, Affiliate-Kennzeichnung/Caption, Video/Runway. Das sind die nächsten Schritte.

## Vor Deployment zu tun (nur durch Betreiber)
1. Migration 022 wird beim ersten Cron-/Webhook-Aufruf über `ensureAutomationSchema` angewendet (additive Spalte);
   Backup dennoch empfohlen.
2. Vercel-Runtime-Logs für `/api/cron/daily-draft` 16:00–17:59 UTC am 30.09. sowie `daily_drafts` der Slots
   lesen (`status`, `attempts`, `scout_report->>'reason'`, `whatsapp_*`) – das würde die tatsächliche Ursache belegen.
3. Für zuverlässigen Versand ohne vorherige Operator-Nachricht: genehmigte WhatsApp-Vorlage konfigurieren
   (Gebühren möglich). Ohne sie wartet die Freigabe bis zur nächsten Nachricht des Betreibers.

## Nachtrag 30.09.2026 (abends): WhatsApp-Vorlage

- In Vercel **Production** gesetzt (per API, plain): `WHATSAPP_DAILY_TEMPLATE_ENABLED=true`,
  `WHATSAPP_DAILY_TEMPLATE_NAME=content_entwurf`, `WHATSAPP_DAILY_TEMPLATE_LANGUAGE=de`.
- Sprachcode `de` folgt der Meta-Dokumentation („German" = `de`; `de_DE` existiert dort nicht). **Nicht** gegen das
  Konto verifiziert: Kein Meta-Token im Zugriff. Zuordnung der Vorlage zum produktiven WhatsApp-Konto ungeprüft.
- Die Vorlage wird ohne Parameter gesendet. Hat `content_entwurf` Platzhalter, lehnt Meta ab.
- Code: Vorlagenversand und Volltext-Versand laufen über `deliverDailyApproval`. Eine definitive Meta-Ablehnung
  der Vorlage (`daily_template_rejected` im Log, nur Code/Status/Kurztext) gibt den Claim frei; der nächste
  Cron-Aufruf versucht es erneut. Die Vorlage ist nie eine Inhaltsfreigabe; „Entwurf" (Antwort auf die Vorlage) ruft
  den gespeicherten Entwurf ab, die Veröffentlichungsfreigabe bleibt eine eigene spätere Nachricht.
- Lokal: 195/195 Tests. Versand, Zustellung und Empfang der Vorlage sind **nicht** nachgewiesen.

## Nachtrag 30.09.2026, 21:53 MESZ: Nachweis aus „Status"-Antwort

Screenshot des Betreibers (Antwort zugestellt, doppelte Haken) zeigt für den 30.09.:
- **Nachmittag (18-Uhr-Slot): lief.** Produkt „180ml Espresso Messbecher Glas …" wurde gewählt, Endstatus
  `needs_input` **ohne** gespeicherten Grund. Der Ausfall war damit **nicht** ein fehlender Cron-Aufruf und nicht
  das WhatsApp-Fenster, sondern ein Abbruch in Content-Planung/Freigabeprüfung vor dem Versand. Die genaue Stufe
  ist nicht belegt (Logs der Stunde durch Billing-Limit gesperrt).
- **Vormittag:** `needs_input`, „Produkt in den letzten sieben Tagen verwendet" (alle Kandidaten gesperrt).
- Weitere manuelle Aufträge: Badematte „Content-Planung abgebrochen", einmal `failed`, einmal keine verifizierte Produktseite.
- Webhook-Logs 19:53 UTC: Nachricht angekommen, HTTP 200; kein Fehler beim Nachsenden.

Änderung: Wenn ein Slot nach der Planung `needs_input` wird, wird der Grund (`publication_gate_failed`,
`content_review_failed`, …) samt Kurztext gespeichert, als `daily_draft_needs_input` geloggt und in „Status"
angezeigt. Damit ist der nächste Ausfall ohne Datenbankzugang erklärbar. Lokal getestet; produktiv noch nicht beobachtet.

## Entscheidung Betreiber 30.09.2026 (spät): keine WhatsApp-Vorlage

Um Kosten zu vermeiden, wird die Marketing-Vorlage `content_entwurf` **nicht** genutzt.
`WHATSAPP_DAILY_TEMPLATE_ENABLED=false` (Vercel Production; Name/Sprache bleiben gesetzt, sind aber unwirksam).
Ablauf stattdessen: Der Betreiber schreibt **einmal täglich** eine Nachricht an die Business-Nummer (öffnet das
24-Stunden-Fenster). Ist das Fenster bei einem Slot geschlossen, wird der fertige Entwurf gespeichert
(`template_required`) und nach der nächsten eingehenden Betreibernachricht gesendet (`sendPendingDailyApprovals`,
Entwürfe bis 48 h alt). Empfehlung: die Tagesnachricht **vor 09:00 MESZ** senden, dann liegen Vormittags- und
Abend-Slot im Fenster. Ohne diese Nachricht gibt es keine zugestellte Freigabe; das ist eine bewusste
Einschränkung, kein Fehler. Planung Trend-Posts (Text+Bild, Instagram+Facebook, gemeinsame Freigabe, zusätzlich
zu den zwei Tagesposts) erst nach Bestätigung des Tagesablaufs.

## 01.10.2026: Instagram-Bildpost, keine Stories

**Befund:** Instagram-Veröffentlichung existierte nur für Reels (`media_type=REELS`). Für Bildposts gab es keinen
Instagram-Weg; die Veröffentlichungsfreigabe publizierte ausschließlich das Facebook-Foto. Das Bild wurde deshalb nie auf
Instagram gepostet. (Logs des Tages wegen Vercel-Billing-Limit nicht lesbar; die Ursache folgt aus dem Code, nicht aus Logs.)
Stories: Meta-Dokumentation – Instagram-Stories-API ohne Caption/Link, Facebook-Foto-Stories ignorieren Text. Betreiber
entschied: **keine Story posten und keine Story-Vorlage senden**. `story-handoff` samt Aufruf und Test entfernt.

**Neu:** `lib/meta/instagram-image.ts`, Migration `023_instagram_image_posts.sql`.
Nach erfolgreicher Facebook-Veröffentlichung (dieselbe, gemeinsame Veröffentlichungsfreigabe) wird das freigegebene Bild
einmalig auf Instagram gepostet: PNG laden (nur eigener Blob-Pfad), mit `sharp` zu JPEG (Instagram verlangt JPEG;
Seitenverhältnis 4:5–1,91:1, sonst Fehlermeldung statt Zuschnitt), nach `generated/instagram/<job>/<sha>.jpg` hochladen,
Container (`image_url`, Caption = Facebook-Caption mit „Werbung | Affiliate-Link" nach dem Einstieg und Produktlink),
Status abfragen (max. ca. 24 s), `media_publish` genau einmal. Claim vor jedem Graph-Schreibzugriff; unklares
Publish-Ergebnis wird `unknown` und nie wiederholt. Noch verarbeitender Container wird per „Status" einmalig
veröffentlicht. Jeder Ausgang kommt als WhatsApp an den Betreiber. Der Link im Instagram-Text ist nicht klickbar.
Veröffentlichungsfreigabe-Text nennt jetzt Facebook und Instagram gemeinsam.

**Tests:** lokal 202/202 (u. a. echte JPEG-Konvertierung, Einmalpublish, abgelehnter Container, unklares Ergebnis,
Seitenverhältnis). **Nicht belegt:** Instagram-Berechtigung/-Konto für Feed-Bilder, JPEG-Annahme durch Meta und Zustellung
produktiv. Erste echte Probe: nächste Veröffentlichungsfreigabe.

## 01.10.2026 abends: WhatsApp-Dialog „Produkt tauschen" (Screenshot-Befund)

Beobachtet (Betreiber-Screenshot, Silikon-Backmatte): „Finde ein Artikel Silpat Matte, dann passt die Produktbeschreibung"
→ Rückfrage „Welchen Auftrag meinst du?" mit vier alten Entwürfen (ASIN undefined, `&#34;` im Namen); weitergeleiteter
Amazon-Link nach „Neuer Auftrag" → als Korrektur des offenen Entwurfs behandelt; „Ein anderes Produkt …" → Hinweis auf das
Content Studio. Ursachen im Code: kein Pfad für „Produkt ersetzen + Suchbegriff"; Zielauswahl ohne Zeitbezug; Link mit
Vorschautext wurde nicht als Link erkannt; Hinweistexte verwiesen auf das Content Studio; Amazon-Titel wurden nicht
entschlüsselt/normalisiert.

Änderungen: `lib/whatsapp/replace-draft.ts` (Erkennung „finde … Artikel/Produkt <Begriff>" / „finde stattdessen <Begriff>",
stoppt den offenen, noch nicht freigegebenen Entwurf wie „Ablehnen", gibt die 7-Tage-Sperre frei, startet die Suche;
Rückfrage ohne Begriff); `start-image-post.ts` (Link mit Vorschautext = Produktlink; direkt nach „Neuer Auftrag" startet er
den Auftrag; verständliche Rückfrage statt „Bitte sende …"); `process-instruction.ts` (nur offene Freigaben der letzten 36 h;
Nachricht kurz nach der neuesten Freigabe gehört zu ihr; keine „ASIN undefined"); alle WhatsApp-Texte ohne Content-Studio-Verweis;
`cleanAmazonTitle` (HTML-Entitäten, „HitzebestäNdig" → „Hitzebeständig"). Lokal 205/205; produktiv nicht beobachtet.
Grenze: Die Erkennung ist regelbasiert; ungewöhnliche Formulierungen führen zur Rückfrage, nicht zu einer Suche.

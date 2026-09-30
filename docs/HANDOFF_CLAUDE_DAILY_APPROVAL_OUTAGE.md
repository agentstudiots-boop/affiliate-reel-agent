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

# Go-live-Runbook Themen-Pipeline (vorbereitet, nichts ausgeführt)

Stand 2026-10-12. Ergänzt `TOPIC_PIPELINE_ACTIVATION.md` und `PREVIEW_ISOLATION_CHECKLIST.md`. Jeder Schritt braucht eine
eigene Freigabe des Betreibers. Nichts davon wurde ausgeführt: keine Migration, kein bezahlter Aufruf, keine Veröffentlichung.

## 1. Migration 034 (Bildqualität) – statischer Befund

| Prüfung | Ergebnis | Nachweis |
|---|---|---|
| Nur additive Anweisungen | 4× `CREATE TABLE IF NOT EXISTS`, 2× `CREATE INDEX IF NOT EXISTS`; kein `ALTER/DROP/UPDATE/DELETE/INSERT` | `tests/migration-034.test.cjs` |
| Bestehende Tabellen, Spalten, Zeilen | unverändert nach dem Upgrade einer befüllten 033-Datenbank | dito (vollständiger Vorher/Nachher-Vergleich) |
| Wiederholung | No-op (`schema_migrations`) | dito |
| Atomarität | Fehler mitten in 034 → komplette Rücknahme, keine Teil-Tabellen, kein Eintrag | dito |
| Rollback laut `IMAGE_QUALITY_VERIFICATION.md` | stellt das 033-Schema exakt wieder her (löscht nur 034-Daten) | dito |
| Rückwärtskompatibel | Alter Code kennt die neuen Tabellen nicht und liest sie nicht | Codesuche |
| Verhaltensänderung | `ON DELETE CASCADE` nur von den neuen Tabellen auf `content_jobs` (Löschen eines Jobs löscht seine Bildversuche) | SQL |
| Bekannte Grenze | `IF NOT EXISTS` übernimmt eine gleichnamige, abweichend angelegte Tabelle ungeprüft (nur bei manuellen Eingriffen denkbar) | – |

Produktionsprüfung (Betreiber, lesend): `DATABASE_URL=<prod, read-only> node scripts/check-migration-status.cjs`.
`ensureAutomationSchema` wendet 034 beim ersten Webhook/Cron automatisch an, sobald der Code deployt ist.

## 2. Vision-Smoke-Test (vorbereitet)

```
npx tsc -p tsconfig.test.json
node scripts/vision-smoke-test.cjs                                   # Stufe 1, offline, kostenlos – lokal bestanden (5/5)
REPLICATE_API_TOKEN=… node scripts/vision-smoke-test.cjs --metadata  # Stufe 1b, kostenloser GET
REPLICATE_API_TOKEN=… VISION_SMOKE_APPROVED=1 node scripts/vision-smoke-test.cjs --live   # Stufe 2: EIN bezahlter Aufruf
```
Behoben am 2026-10-12: Das Offline-Testbild (40×50 px) fiel durch die technische Prüfung (min. 512 px); dadurch wurden
die Fehlerpfade „Providerfehler“ und „ungültiges Schema“ nie erreicht und Stufe 1 meldete 2 Fehler. Jetzt 512×640 px und ein
Test (`tests/vision-smoke-offline.test.cjs`) hält Stufe 1 grün. **Stufe 2 bleibt offen** (bezahlt, braucht Freigabe).

## 3. Privater Plattform-Test (vorbereitet)

Kein eigenes Posting-Skript: jede Veröffentlichung läuft über die WhatsApp-Freigabe der exakten Fassung (AGENTS.md).
Vorab offline prüfen:
```
node scripts/platform-smoke-preflight.cjs <instagram|facebook|tiktok|youtube|x> [env-datei]
```
Blocker: `TOPIC_PLATFORMS` nicht genau diese eine Plattform, fehlende Zugangsdaten, öffentliche Sichtbarkeit
(`TIKTOK_PRIVACY_LEVEL≠SELF_ONLY`, `YOUTUBE_PRIVACY_STATUS=public`). Hinweis bei Instagram/Facebook/X: Die API kennt keinen
privaten Beitrag – nur mit Testseite/Testkonto testen. Ablauf danach: Vorschlag → „Freigeben“ → Produktion →
Veröffentlichungsfreigabe → genau ein Beitrag → Link in „Status“.

## 4. Konsistenz der Statusübergänge (geprüft)

`tests/state-consistency.test.cjs`: Stufen der Themenbeiträge, Versuchsstatus der Freigabeschranke, Freigabeentscheidungen
und Medienauftragsstatus stimmen exakt mit den CHECK-Constraints der Migrationen überein. Ein im Code geschriebener Status,
den die Datenbank ablehnt, würde sonst erst in Produktion mitten im Ablauf scheitern.

Bekannte Grenze (nicht geändert, weil eine neue Stufe eine Migration bräuchte): Ist das Ergebnis aller Plattformen
**unklar** (`unknown`), steht der Themenbeitrag auf `not_published`. Der WhatsApp-Bericht nennt das Ergebnis korrekt als
unklar; es wird nie automatisch erneut gepostet; die Themen-Sperre greift über den Eintrag „approved“ (21 Tage).

## 5. Zwingend manuelle Schritte vor dem Live-Betrieb

1. Preview-Isolation nach `PREVIEW_ISOLATION_CHECKLIST.md`, Nachweis mit `scripts/check-preview-isolation.cjs`.
2. Migration-Status Production lesend prüfen (034, nach Merge von PR #64 auch 035).
3. Vision-Smoke-Test Stufe 2 (ein bezahlter Aufruf) mit Freigabe.
4. Plattform-Zugänge in den Anbieter-Dashboards (siehe `COMMAND_CENTER.md` §6 bzw. `MULTICHANNEL_SETUP.md`).
5. Preflight je Plattform ohne Blocker; privater Test über die normale Freigabe.
6. `TOPIC_PIPELINE_ENABLED=true` ohne Live-Schalter (Probelauf), danach Cron in `vercel.json` (Code-Änderung + Review).
7. `TOPIC_LIVE_PUBLISHING=true` nur für die getestete Plattform.

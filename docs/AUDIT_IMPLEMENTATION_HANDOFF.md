# Übergabe: Umsetzung der Audit-Ergebnisse (Branch `claude/wonderful-hamilton-qjckiv`)

Basis: `main` = `72cc3ab` (verifiziert). Kein Merge, kein Deployment, keine Produktionsänderung, keine kostenpflichtigen Aufrufe.

## Erledigt
| Paket | Stand | Belege |
|---|---|---|
| P-01 Endpunkte absichern | IMPLEMENTIERT, LOKAL GETESTET | `tests/api-access.test.cjs` (7 Tests) |
| P-02 Preview-Isolation | IMPLEMENTIERT, LOKAL GETESTET; Vercel-Umstellung **offen** (Betreiber) | `tests/runtime-guard.test.cjs` (10), `docs/PREVIEW_ISOLATION.md` |
| P-11 Instagram-Freigabeschranke | Lücke **bestätigt und behoben**, LOKAL GETESTET | `tests/instagram-approval-recheck.test.cjs` (8), `tests/instagram-reel.test.cjs` (+1) |
| P-03 Image-Quality-Verifikation | Skripte + Plan **vorbereitet**, Live-Teil **nicht ausgeführt** | `scripts/vision-smoke-test.cjs`, `scripts/check-migration-status.cjs`, `docs/IMAGE_QUALITY_VERIFICATION.md` |
| Themen-Pipeline | nur Vorbereitung/Doku; **nicht aktiviert** | `docs/TOPIC_PIPELINE_ACTIVATION.md` |
| Multi-Publisher | Prüfbericht | `docs/PUBLISHER_REVIEW.md` |
| Reel Intelligence | Integrationsplan, Merge-Test konfliktfrei | `docs/REEL_INTELLIGENCE_INTEGRATION_PLAN.md` |

## Wichtige Befunde bei der Umsetzung
1. **Zweite Umgehung der Freigabeschranke (neu, bestätigt):** `POST /api/instagram/reel` mit `action: "publish"` rief `advanceInstagram` direkt auf (Container-Erstellung ohne `authorizePublish`). Jetzt über `publishApprovedAffiliateReel` (zentrale Schranke). Zugang blieb: Studio-Passwort + gespeicherte WhatsApp-Freigabe.
2. **Resume-Lücke (wie im Audit vermutet, bestätigt):** `resumeInstagramImages` → `finishInstagramImage` und `advanceInstagram("poll")` riefen `media_publish` ohne erneute Freigabeprüfung. Neu: `verifyPublishStillAuthorized()` direkt vor dem unumkehrbaren Schritt (Freigabe aktuell, Fassung unverändert, offener Permit-Versuch, Live-/Umgebungsschalter). Bei Verstoß: Container verworfen, Versuch `failed`, Betreiber-Hinweis, nichts gepostet.
3. **Bestehende Tests angepasst (nicht abgeschwächt):** Fixtures von `instagram-image.test.cjs` und ein Fall in `instagram-reel.test.cjs` mussten den Zustand herstellen, den die gemeinsame Verteilung in Produktion immer hinterlässt (zentrale Freigabe + offener Versuch; Zustimmungs-Event und Absender). Alle Assertions blieben unverändert. Der neue Helfer `tests/helpers/affiliate-gate.cjs` nutzt die echte Schranke mit inerten Publishern.
4. **Merge-Test PR #61:** konfliktfrei (Audit-Annahme korrigiert).

## Geänderte Verhaltensweisen (bewusst)
- Operator-only: `/api/trends`, `/api/verify`, `/api/generate`, `/api/video/status`, `/api/meta/connection`, `/api/whatsapp/connection` verlangen `x-content-password`. Die Legacy-Oberfläche (`app/page.tsx`) sendet den im Studio eingegebenen Code mit; ohne Code zeigen Trend-Scout/Meta-Prüfung eine 401-Meldung. **Externe Monitore, die `/api/meta/connection` anonym abfragen, erhalten nun 401.**
- Preview/Development: keine Datenbank, keine Migrationen, keine Veröffentlichung, kein WhatsApp-Versand, keine Cron-Läufe, keine Blob-Schreibzugriffe, keine bezahlten Provider — außer mit `NON_PRODUCTION_SANDBOX=true` (Betreiber).

## Offene Betreiberentscheidungen / -freigaben
1. Merge des Branches nach `main` und Produktionsdeployment (nicht erteilt).
2. Vercel Preview-Variablen umstellen (`docs/PREVIEW_ISOLATION.md`); erst danach ggf. `NON_PRODUCTION_SANDBOX=true`.
3. Read-only-Migrationsprüfung mit Produktions-`DATABASE_URL` ausführen (Betreiber oder gesonderte Freigabe).
4. Genau **ein** kostenpflichtiger Vision-Aufruf (`VISION_SMOKE_APPROVED=1 … --live`) bzw. vorher die kostenlose Metadaten-Prüfung (`--metadata`).
5. Akzeptanz, dass anonyme Statusabfragen (Meta-Verbindung) entfallen.

## Nächste sichere Schritte (ohne Freigabe möglich)
- WhatsApp-Webhook-Risikoanalyse vertiefen (Dedupe ist stufenweise über `whatsapp_events` belegt; kein konkreter Fehler gefunden).
- Reel Intelligence erst nach Merge-Entscheidung zu #61 weiterbauen.
- TikTok-Refresh-Token-Rotation als eigenes Paket nach Live-Test.

# Projektstatus – Affiliate Content Studio

> Pflichtlektüre zu Sitzungsbeginn (zusammen mit `CLAUDE.md`). Nach jeder abgeschlossenen Phase aktualisieren und versionieren.
> Begriffe strikt getrennt: **implementiert** (Code auf Branch) · **getestet** (automatisierte Offline-Tests) · **gemergt** (in `main`)
> · **deployed** (im READY-Production-Deployment) · **aktiviert** (Schalter/Zugänge in Production gesetzt) · **live verifiziert** (echter Production-Aufruf beobachtet).

Stand: **2026-10-16**, Claude-Code-Cloud-Sitzung, Branch `claude/clever-cori-b73qxg`.
Ausführlicher Abschluss mit Soll-Ist-Matrix: [`docs/PRODUCTION_AUDIT_FINAL_2026-10-15.md`](PRODUCTION_AUDIT_FINAL_2026-10-15.md).

## 1. Aktueller Stand

| Punkt | Wert |
|---|---|
| `main` | Merge dieses Doku-PRs (davor `ed9851a`, Merge PR #76) |
| Production-Deployment | je Merge automatisch; letzter geprüfter: `dpl_FGYsgGnzmLEVKejr6TC96uv9WSxA` READY |
| Tests | 660 Tests grün (`npm test`), Typecheck, Lint, Build; CI (`check`) grün je PR |
| Offene PRs (alt) | #61 (verletzt Importregel), #65 (überholt), #10 (Migrationskonflikt) – schließen oder neu aufsetzen |
| Migrationen | 001–037, nur additiv; keine neue in dieser Sitzung nach 037 |
| Production-Env (nur Namen) | vorhanden: `CONTENT_STUDIO_PASSWORD`, `CRON_SECRET`, DB/Blob, WhatsApp (`WHATTSAPP_*`), Meta-System-User, Replicate, Tavily, Runway (+Budget), Faceless, YouTube (3 OAuth), `HEYGEN_API_KEY`, `WHATSAPP_DAILY_TEMPLATE_*` (`ENABLED=false`). **Fehlend:** `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `HEYGEN_MONTHLY_VIDEO_LIMIT`, `HEYGEN_ENABLED`, `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`, Pinterest/TikTok/X, `ADMIN_SESSION_SECRET` (optional) |

## 2. Gemergte PRs dieser Sitzung

| PR | Inhalt | Merge | Deployment | live verifiziert |
|---|---|---|---|---|
| [#71](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/71) | Codex-Audit (Next.js-Patch, Videobudget atomar, YouTube-Status, Pinterest aus) | `0e0f9b8` | READY | – |
| [#72](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/72) | Admin-Login, WhatsApp-Bildstopp-Fixes, `model_calls` (037), Projektgedächtnis | `dc4dc7f` | `dpl_3QFYMTtg2Pj4BGd8gJtLjhz3ZJ1K` | `/` → Login, `/api/architecture` 401, `/produkte` 200 |
| [#73](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/73) | Command Center als Seite `/architecture`, Steckbriefe | `849b8fc` | `dpl_3x6dUVvJwwcQcy197Gqx2X7XYdKy` | `/architecture` → `/login?next=/architecture` |
| [#74](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/74) | HeyGen/Mia: Briefing, Preflight, Qualitätsprüfung, Schalter `HEYGEN_ENABLED` | `d22a87e` | `dpl_3ACLNQ74PvUa5GUWSnySfnwPWxGr` | Deployment READY; keine Laufzeitfehler 24 h |
| [#75](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/75) | Trendscout: Themenrecherche + Produktmix (Schalter aus) | `fb26dda` | `dpl_2Pw7guN2Cs4ziQ1qB2rWgzrpdVAg` READY | – (Schalter aus) |
| [#76](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/76) | Landingpage: Name, Kurzbeschreibung, Bild, „Zum Shop“ | `ed9851a` | `dpl_FGYsgGnzmLEVKejr6TC96uv9WSxA` READY | `/produkte` 200: 10 Karten mit Kurzbeschreibung, „Zum Shop“, Detailseiten-Links mit Tag |

## 3. Status je Bereich

| Bereich | Status |
|---|---|
| Admin-Zugang | deployed, live verifiziert (Weiterleitung/401); Login selbst nur vom Betreiber prüfbar |
| Command Center | deployed, erreichbar; Inhalte mit Produktionsdaten nicht von der Sitzung gesehen. Fehlend: Einzellisten je Entscheidung, Euro-Kosten |
| WhatsApp-Freigaben | deployed + live genutzt; Fixes aus #72 noch ohne Live-Bildstopp-Fall |
| WhatsApp-Servicefenster | Vorlage `content_entwurf` vorhanden, **aus** (Betreiberentscheidung) |
| Trendscout / Trend-Agent | aktiv (`gpt-4.1` + Tavily). Neu, **aus**: `TRENDSCOUT_TOPICS=on` (Themenrecherche im selben Lauf), `PRODUCT_MIX=balance` (Preissegmente) |
| Trendsetter | deployed, aus (`TRENDSETTER_AFFILIATE`) |
| Themen-Pipeline | deployed, aus (`TOPIC_PIPELINE_ENABLED`, `TOPIC_LIVE_PUBLISHING`), kein Cron |
| HeyGen | implementiert/getestet, **aus** (`HEYGEN_ENABLED` fehlt) und blockiert (Avatar, Stimme, Limit, Guthaben). Prüfbericht: `docs/HEYGEN_MIA_PRODUCT_VIDEOS.md` |
| Instagram | Affiliate-Bild aktiv; Reels implementiert (Affiliate `share_to_feed=false` → Betreiber klären); Themenpfad blockiert (`META_*`) |
| Facebook | Affiliate-Fotopost aktiv; Themenpfad blockiert (`META_PAGE_ID`) |
| YouTube | Dry-Run; Refresh-Token (OAuth-Testmodus) läuft ca. **17.10.** ab |
| Pinterest / TikTok / X | aus bzw. extern blockiert |
| Landingpage | Karten: Name, Bild, Kurzbeschreibung aus verifizierten Angaben, „Zum Shop“, Kennzeichnung |
| Cron | 6 UTC-Zeitpunkte → Berlin-Fenster 9–14 / 18–23 Uhr; Sommerzeit 3, Winterzeit (ab 25.10.) 2 Aufrufe je Fenster; Claim je (Tag, Slot) |
| Kosten | `model_calls` je Agent (Aufrufe, Fehler, Latenz, Tokens, Rechenzeit); Bild-/Runway-/HeyGen-Budgets; keine Euro-Schätzung |
| Laufzeitfehler Production (24 h, 16.10.) | nur `pg`-Hinweis zum SSL-Modus (`sslmode=verify-full` empfohlen, Secret → Betreiber) |

## 4. Offene Probleme

1. Command Center: Liste der letzten Chancen/Routing-/Veröffentlichungsentscheidungen; Euro-Kosten erst mit gepflegten Preisen.
2. Provisionssätze je Kategorie fehlen für die Wirtschaftlichkeitsbewertung.
3. Login-Bremse nur je Serverinstanz → starker Zugangscode; optional Firewall-Regel.
4. Alt-PRs #61, #65, #10.
5. Kein Modellvergleich (kostenpflichtig, Freigabe nötig).

## 5. Externe Blocker / Betreiberentscheidungen

| Thema | Benötigt |
|---|---|
| YouTube | Google-App in Produktion oder Token vor 17.10. erneuern; API-Audit für öffentliche Uploads |
| Meta Themenpfad | `META_PAGE_ID`, `META_INSTAGRAM_USER_ID` |
| Instagram-Reel Affiliate | `share_to_feed=false` (nur Reels-Tab) bestätigen oder ändern |
| HeyGen | API-Guthaben, Mia-Avatar mit Rechten, deutsche Stimme, `HEYGEN_MONTHLY_VIDEO_LIMIT`, ein freigegebener Testclip, dann `HEYGEN_ENABLED=true` |
| Pinterest / TikTok / X | App-Freigaben, Zugänge, Tarif |
| WhatsApp-Vorlage | `WHATSAPP_DAILY_TEMPLATE_ENABLED=true` (Kosten je Vorlagennachricht) |
| Neue Schalter | `TRENDSCOUT_TOPICS=on`, `PRODUCT_MIX=balance`, `TRENDSETTER_AFFILIATE` |
| Modellvergleich | Kostenfreigabe |
| DB-SSL | `sslmode=verify-full` in `DATABASE_URL` |

## 6. Kritische Risiken

- Tagesfreigaben hängen am 24-h-Fenster, solange die Vorlage aus ist.
- YouTube-Token-Ablauf ~17.10.
- Preview-Isolation nur teilweise (26 Variablen ohne Preview-Ziel; `runtime-guard` sperrt Wirkungen außerhalb Production).

## 7. Nächste Schritte (priorisiert)

1. Betreiber: anmelden, Command Center → „Steckbriefe“ prüfen (macht DB-Nachweise sichtbar).
2. `TRENDSCOUT_TOPICS=on` eine Woche testen (nur Recherche, keine Veröffentlichung), dann `PRODUCT_MIX=balance`.
3. YouTube-Token / Google-App-Status.
4. HeyGen-Entscheidungen, dann ein freigegebener Testclip.
5. Command Center: Entscheidungsliste aus `content_chances`, `content_jobs`, `publication_requests`.
6. Eine Woche `model_calls` auswerten, dann über Modellvergleich entscheiden.

## 8. Übergabe an die nächste Sitzung

- Zuerst `CLAUDE.md`, dieses Dokument, `AGENTS.md`; GitHub-Status und letztes Production-Deployment prüfen.
- Tests: `npm test` (~10 min, 660 Tests), `npm run typecheck`, `npm run lint`, `npm run build`; CI führt zusätzlich `npm audit --omit=dev` aus.
- In der Cloud-Umgebung: Build nicht in einem Git-Worktree mit verlinktem `node_modules` (Turbopack-Fehler) – im Hauptcheckout bauen.
- Keine Secrets geändert, keine Live-Posts, keine kostenpflichtigen Aufrufe, keine Schalter aktiviert.

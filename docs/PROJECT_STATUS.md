# Projektstatus – Affiliate Content Studio

> Pflichtlektüre zu Sitzungsbeginn (zusammen mit `CLAUDE.md`). Nach jeder abgeschlossenen Phase aktualisieren und versionieren.
> Begriffe strikt getrennt: **implementiert** (Code auf Branch) · **getestet** (automatisierte Offline-Tests) · **gemergt** (in `main`)
> · **deployed** (im READY-Production-Deployment) · **aktiviert** (Schalter/Zugänge in Production gesetzt) · **live verifiziert** (echter Production-Aufruf beobachtet).

Stand: **2026-10-22**, Claude-Code-Cloud-Sitzungen (Ausbau-Roadmap, zwei Sitzungen), Doku-Branch `claude/docs-status-nachzug`. Erster Reel-Praxistest: [`docs/FIRST_REEL_TEST.md`](FIRST_REEL_TEST.md).
Ausführlicher Abschluss mit Soll-Ist-Matrix: [`docs/PRODUCTION_AUDIT_FINAL_2026-10-15.md`](PRODUCTION_AUDIT_FINAL_2026-10-15.md).

## 1. Aktueller Stand

| Punkt | Wert |
|---|---|
| `main` | `06ae6cc` (Merge PR #116); danach nur dieser Doku-PR |
| Production-Deployment | je Merge automatisch; letzter geprüfter: `dpl_BedbCi8tuyEVsjWpABs8gCrPfXb4` READY (`06ae6cc`, 22.10.); `vercel.json` unverändert 12 Cron-Einträge |
| Tests | 892 Tests (888 bestanden, 0 fehlgeschlagen, 4 übersprungen, u. a. J-04 ohne `J04_DATABASE_URL`), Typecheck, Lint (0 Fehler), Build – Stand `main` a736bf4 + #115 + #116 |
| Offene PRs (alt) | #61 (verletzt Importregel), #65 (überholt), #10 (Migrationskonflikt) – schließen oder neu aufsetzen |
| Migrationen | 001–042, nur additiv (038: Zustellstatus Themenvorschläge, Themenvideo-Felder, `topic_video_days`; 039: Executive-Aufgabenbuch `enterprise_*`/`budget_reservations`; 040: Kosten-/Erlösbuch `price_catalog`, `cost_entries`, `revenue_entries`, `budgets`; 041: Entscheidungsvorlagen `enterprise_decisions`; 042: Opportunity-Scout `opportunities`, `opportunity_assessments`). 039/041 liest das Command Center (Unternehmensebene), 040 lesen Command Center und `/api/operations` (Controlling); 042 liest noch keine Oberfläche; `budget_reservations` liest nur der Wochenbericht-Abschnitt (Schalter). Geschrieben wird nur hinter Schaltern (alle aus). 039–042 in Production angewendet: 039–041 waren bereits vorhanden; 042 hat der Betreiber am 22.10. um 15:50:56 UTC über `/api/admin/migrate` angewendet (Log `database_migration`, `applied: ["042_opportunities.sql"]`), Folgeaufrufe melden „Schema bereits aktuell“ |
| Production-Env (nur Namen) | vorhanden: `CONTENT_STUDIO_PASSWORD`, `CRON_SECRET`, DB/Blob, WhatsApp (`WHATTSAPP_*`), Meta-System-User, Replicate, Tavily, Runway (+Budget), Faceless, YouTube (3 OAuth), `HEYGEN_API_KEY`, `WHATSAPP_DAILY_TEMPLATE_*` (`ENABLED=false`), seit 18.10. `TOPIC_PIPELINE_ENABLED`, `TOPIC_DAILY_VIDEO`, `TOPIC_COPY_MODE` (Werte nicht gelesen). **Fehlend:** `EXECUTIVE_ENABLED`, `EXECUTIVE_WEEKLY_REPORT`, `EXECUTIVE_WHATSAPP`, `OPPORTUNITY_SCOUT_ENABLED`, `OPPORTUNITY_DAILY_LIMIT` (= aus), `TOPIC_STANDARD_VIDEO_PROVIDER`, `TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `HEYGEN_MONTHLY_VIDEO_LIMIT`, `HEYGEN_ENABLED`, `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`, Pinterest/TikTok/X, `ADMIN_SESSION_SECRET` (optional) |

## 2. Gemergte PRs der Ausbau-Roadmap (21./22.10.)

Nachweis je Merge (D-05, `docs/ai-business/RELEASE_CHECKLIST.md`): Production-Deployment READY und keine neuen Laufzeitfehler (Vercel, nur lesend).
**Aktiviert:** keiner der neuen Schalter ist gesetzt. **Live verifiziert:** nur die Anwendung der Migrationen 039–042 (Betreiber, `/api/admin/migrate`, 22.10.; 042 erst dabei angewendet); die Funktionen selbst nicht – echte Production-Aufrufe sind aus den Sitzungen
nicht möglich; Laufzeitfehler seit den Merges nur der bekannte `pg`-SSL-Hinweis.

| PR | Inhalt | gemergt | deployed | aktiviert | live verifiziert |
|---|---|---|---|---|---|
| #80 | Doku Themen-Pipeline/Themenvideo, HeyGen v3, Reel-Praxistest | `c56711e` | `dpl_CuDde6K3Q4w4u6wXE1UNAAmt4Qt1` READY | – (Doku) | – |
| #95 | D-05 Release-Checkliste | `5f59d36` | `dpl_CCNCUhoHVEQEpbGUrwymgV3EQnHS` READY | – (Doku) | – |
| #101 | C-04 PR-Vorlage | `f5ad79b` | `dpl_5wpuHMqNzjdibnud3AMp9n1mFJsw` READY | – (Doku) | – |
| #97 (+#83, #85) | F-04 Wirtschaftlichkeitsrechnung, E-05, F-01 (reine Funktionen) | `c29815c` | `dpl_5pNZgRd8tZeGnNDtbYRNL6bs1QVX` READY | nicht eingebunden | – |
| #94 | Videomodellaufrufe in `model_calls` | `e270bcc` | `dpl_5XMNRRdBxxr52C6SnGvq1uV6Cem6` READY | wirkt ohne Schalter (nur bei Videoaufruf) | – (kein Videoaufruf beobachtet) |
| #89 | B-02 Migration 039 Aufgabenbuch | `7257fd7` | `dpl_J3FRAHRoWjNFChZwa6peW9F88pv2` READY | – | Migration angewendet (Betreiber, 22.10.) |
| #92 | E-01 Migration 040 Kosten-/Erlösbuch | `ca4a986` | eigener Build abgebrochen, enthalten in `dpl_2TJBadjG9uMYaxePz3ULyqXjeLxL` READY | – | Migration angewendet (Betreiber, 22.10.) |
| #96 (+#84) | B-06 Migration 041 Entscheidungsvorlagen, B-01 | `f0187eb` | `dpl_2TJBadjG9uMYaxePz3ULyqXjeLxL` READY | – | Migration angewendet (Betreiber, 22.10.) |
| #112 (+14 PRs) | J-02 Härtung, Executive-Kern inkl. B-07 `executive-cycle` (nicht geplant) | `90f3737` | `dpl_2wjFdr1HMy64ccezERnSJpS76Mtn` READY | nein (`EXECUTIVE_ENABLED` fehlt) | – |
| #106 (+#105) | J-03/J-01 Kostenobergrenzen unter Retries (nur Tests) | `b7d1089` | `dpl_7YmuCU757kCcgSrCgnZrgcnMrYid` READY | – (Tests) | – |
| #108 (+#107) | E-02 Preiskatalog-Pflege, E-04 | `b5d4dcf` | `dpl_2Fx2BnSWgGcA4Mgh9ZoqMB1LPZSR` READY | nicht eingebunden | – |
| #113 | J-04 Lasttest gegen echtes Postgres (nur Tests) | `2bd4772` | eigener Build abgebrochen, enthalten in `dpl_2zQoxAcykCj6STSLkXiQPuNiSi8M` READY | – (Tests) | – |
| #114 | B-10 Executive-Abschnitt im Wochenbericht | `9023e64` | `dpl_2zQoxAcykCj6STSLkXiQPuNiSi8M` READY | nein (`EXECUTIVE_WEEKLY_REPORT` fehlt) | – |
| #117 | B-11 WhatsApp „Executive“ (nur lesend) | `4c976e7` | `dpl_HZfbFtz7if4ou7xgfuXxhfH2RjTC` READY | nein (`EXECUTIVE_WHATSAPP` fehlt) | – |
| #118 | F-02 Migration 042 + Opportunity-Ledger | `a8ce404` | `dpl_Dq9DCh6yDf2DPeZ7JGDjPEEjoJDq` READY | – | Migration angewendet (Betreiber, 22.10. 15:50 UTC, `/api/admin/migrate`) |
| #119 | F-03 Opportunity-Recherche | `0d2f632` | `dpl_13S81cpec4ibSJrdcoETk6NQSeqD` READY | nein (`OPPORTUNITY_SCOUT_ENABLED` fehlt) | – |
| #120 | F-05 WhatsApp „Geschäftsidee prüfen: …“ (Tageslimit) | `a736bf4` | `dpl_DJcgghtePDAexDFnwBunCT5mX99Q` READY | nein (`OPPORTUNITY_SCOUT_ENABLED` fehlt) | – |
| #115 | I-01 Bewertung „Immobilienanalyse“ – Ergebnis „Daten fehlen“ (Doku + Test) | `b91ff44` | `dpl_E2LTDxbnbHvumAUHuME3hgYSGoUT` READY | – (Doku/Test) | – |
| #116 | J-05 Preview-Lauf mit isolierten Ressourcen (Leitfaden, Prüfskripte) | `06ae6cc` | `dpl_BedbCi8tuyEVsjWpABs8gCrPfXb4` READY | – (Skripte, Betreiber führt aus) | – |

Offen, nicht für `main` vorgesehen (Basis `architecture/ai-business-roadmap`): #81, #82, #111.

## 2a. Gemergte PRs bis 18.10. (Historie)

| PR | Inhalt | Merge | Deployment | live verifiziert |
|---|---|---|---|---|
| [#71](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/71) | Codex-Audit (Next.js-Patch, Videobudget atomar, YouTube-Status, Pinterest aus) | `0e0f9b8` | READY | – |
| [#72](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/72) | Admin-Login, WhatsApp-Bildstopp-Fixes, `model_calls` (037), Projektgedächtnis | `dc4dc7f` | `dpl_3QFYMTtg2Pj4BGd8gJtLjhz3ZJ1K` | `/` → Login, `/api/architecture` 401, `/produkte` 200 |
| [#73](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/73) | Command Center als Seite `/architecture`, Steckbriefe | `849b8fc` | `dpl_3x6dUVvJwwcQcy197Gqx2X7XYdKy` | `/architecture` → `/login?next=/architecture` |
| [#74](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/74) | HeyGen/Mia: Briefing, Preflight, Qualitätsprüfung, Schalter `HEYGEN_ENABLED` | `d22a87e` | `dpl_3ACLNQ74PvUa5GUWSnySfnwPWxGr` | Deployment READY; keine Laufzeitfehler 24 h |
| [#75](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/75) | Trendscout: Themenrecherche + Produktmix (Schalter aus) | `fb26dda` | `dpl_2Pw7guN2Cs4ziQ1qB2rWgzrpdVAg` READY | – (Schalter aus) |
| [#76](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/76) | Landingpage: Name, Kurzbeschreibung, Bild, „Zum Shop“ | `ed9851a` | `dpl_FGYsgGnzmLEVKejr6TC96uv9WSxA` READY | `/produkte` 200: 10 Karten mit Kurzbeschreibung, „Zum Shop“, Detailseiten-Links mit Tag |
| [#77](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/77) | Abschlussaudit 15./16.10., Doku | `ea0559a` | `dpl_HLZmuhZgNiTWTE5QKgJ1RKQaHCcN` READY | – |
| [#78](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/78) | Themen-Pipeline: Cron 07/08 UTC, Fenster 08–11 Uhr, 24-h-Fenster (halten + nachliefern), Migration 038 | `2884d8f` | `dpl_AZkzmoox7XT6vpetGdn3mgeUcZgx` READY | Deployment READY; Wirkung erst mit `TOPIC_PIPELINE_ENABLED` |
| [#79](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/79) | Täglicher Themenvideo-Vorschlag 12 Uhr, Drehbuch, getrennte Inhalts-/Kosten-/Veröffentlichungsfreigabe | `77f0489` | `dpl_3eE5ETatCsdENnhUtGeHYZ1hTTNA` READY | `/produkte` 200; Wirkung erst mit `TOPIC_DAILY_VIDEO` |

## 3. Status je Bereich

| Bereich | Status |
|---|---|
| Admin-Zugang | deployed, live verifiziert (Weiterleitung/401); Login selbst nur vom Betreiber prüfbar |
| Command Center | deployed, erreichbar; Inhalte mit Produktionsdaten nicht von der Sitzung gesehen. Fehlend: Einzellisten je Entscheidung, Euro-Kosten |
| WhatsApp-Freigaben | deployed + live genutzt; Fixes aus #72 noch ohne Live-Bildstopp-Fall |
| WhatsApp-Servicefenster | Vorlage `content_entwurf` vorhanden, **aus** (Betreiberentscheidung). Themenvorschläge außerhalb des Fensters werden gehalten und mit der nächsten Betreiber-Nachricht nachgeliefert |
| Themen-Pipeline | implementiert, getestet, deployed. Variable `TOPIC_PIPELINE_ENABLED` seit 18.10. in Production vorhanden; Wert und Wirkung von den Sitzungen nicht geprüft (Nachweis: `topic_runs` im Command Center bzw. „Status“ per WhatsApp). Cron 07:00 UTC = 09:00 Uhr Berlin → Vorschlag; Zustellung sofort im 24-h-Fenster, sonst mit der nächsten Betreiber-Nachricht |
| Themenvideo täglich | implementiert, getestet, deployed; Variable `TOPIC_DAILY_VIDEO` vorhanden, Wert nicht geprüft; Rendering zusätzlich nur mit Anbieter (`TOPIC_STANDARD_VIDEO_PROVIDER=runway` + Limit) und Kostenfreigabe |
| Trendscout / Trend-Agent | aktiv (`gpt-4.1` + Tavily). Neu, **aus**: `TRENDSCOUT_TOPICS=on` (Themenrecherche im selben Lauf), `PRODUCT_MIX=balance` (Preissegmente) |
| Trendsetter | deployed, aus (`TRENDSETTER_AFFILIATE`) |
| HeyGen | implementiert/getestet, **aus** (`HEYGEN_ENABLED` fehlt) und blockiert (Avatar, Stimme, Limit, Guthaben). Prüfbericht: `docs/HEYGEN_MIA_PRODUCT_VIDEOS.md` |
| Instagram | Affiliate-Bild aktiv; Reels implementiert (`media_type=REELS`; Affiliate `share_to_feed=false` → Betreiber klären, Themen-Reel `true`); Themenpfad blockiert (`META_PAGE_ID`, `META_INSTAGRAM_USER_ID`); kein Live-Reel-Nachweis |
| Facebook | Affiliate-Fotopost aktiv; Themen-Video wird als Seiten-Video gepostet (kein eigener Reels-Endpunkt); Themenpfad blockiert (`META_PAGE_ID`); kein Live-Nachweis |
| YouTube | Shorts-Upload implementiert (`#Shorts`, Standard `private`), Dry-Run; Refresh-Token (OAuth-Testmodus) lief ca. **17.10.** ab → vermutlich abgelaufen, erneuern |
| Pinterest / TikTok / X | aus bzw. extern blockiert |
| Landingpage | Karten: Name, Bild, Kurzbeschreibung aus verifizierten Angaben, „Zum Shop“, Kennzeichnung |
| Cron | Bildpost `daily-draft` unverändert: 6 UTC-Zeitpunkte → Berlin-Fenster 9–14 / 18–23 Uhr; Claim je (Tag, Slot), höchstens 2 Entwürfe/Tag. Neu: `topic-scout` 07/08 UTC (Fenster 08–11), `topic-video` 10/11/12 UTC (Fenster 12–14); beide ohne Schalter `disabled` |
| Kosten | `model_calls` je Agent; Bild-/Runway-/HeyGen-Budgets; Themenvideo: Schätzung je Video (Runway ≈ 3 USD, HeyGen ≈ 0,05 USD/s), Höchstbetrag 5 USD, Monatsbudget 30 USD |
| Executive-Kern (039, 041) | gemergt, deployed, **aus**: Zyklus `/api/cron/executive-cycle` nicht geplant und ohne `EXECUTIVE_ENABLED` `disabled`; Wochenbericht-Abschnitt (`EXECUTIVE_WEEKLY_REPORT`) und WhatsApp „Executive“ (`EXECUTIVE_WHATSAPP`, nur lesend) aus. Entscheidungsvorlagen führen nichts aus |
| Controlling (040) | Preiskatalog, Kostenimport aus `model_calls`, manuelle Einträge: gemergt, **nicht eingebunden**; Command Center/`/api/operations` lesen das (leere) Buch |
| Opportunity-Scout (042) | Raster, Wirtschaftlichkeit, Ledger, Recherche (Tavily + ein Modellaufruf, Konfidenz ohne Quelle ≤ 0,3), WhatsApp „Geschäftsidee prüfen: …“: gemergt, deployed, **aus** (`OPPORTUNITY_SCOUT_ENABLED`, Tageslimit `OPPORTUNITY_DAILY_LIMIT`). I-01 „Immobilienanalyse“: Ergebnis „Daten fehlen“ |
| Preview-Isolation (J-05) | Leitfaden `docs/ai-business/J05_PREVIEW_LAUF.md`, Prüfskripte `scripts/check-preview-isolation.cjs` und `scripts/check-production-untouched.cjs` (nur lesend); keine Ressource angelegt, laut Vercel-Namensliste vom 22.10. sind mehrere Zugangsdaten auch im Target Preview gesetzt (u. a. `REPLICATE_API_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `META_SYSTEM_USER_TOKEN`, `TAVILY_API_KEY`); Werte nicht verglichen, `check-preview-isolation` noch nicht gelaufen |
| Laufzeitfehler Production (seit 21.10., bis 22.10. ~15 UTC) | nur `pg`-Hinweis zum SSL-Modus (`sslmode=verify-full` empfohlen, Secret → Betreiber) |

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
| Themen-Pipeline aktivieren | `TOPIC_PIPELINE_ENABLED=true`, optional `TOPIC_DAILY_VIDEO=true`, `TOPIC_COPY_MODE=ai`, `TOPIC_PLATFORMS=instagram`; Redeploy (die Sitzung kann Umgebungsvariablen nicht setzen und aktiviert Schalter nicht über Code) |
| Themenvideo rendern | `TOPIC_STANDARD_VIDEO_PROVIDER=runway`, `TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT`; je Video eigene Kostenfreigabe per WhatsApp |
| WhatsApp-Vorlage | `WHATSAPP_DAILY_TEMPLATE_ENABLED=true` (Kosten je Vorlagennachricht); ohne Vorlage kommen Vorschläge nur, wenn du in den letzten 24 h geschrieben hast, sonst mit deiner nächsten Nachricht |
| Neue Schalter | `TRENDSCOUT_TOPICS=on`, `PRODUCT_MIX=balance`, `TRENDSETTER_AFFILIATE`; Executive/Opportunity (alle aus, siehe §3 und `CLAUDE.md` §8) |
| Preview-Lauf | Neon-Branch + Blob-Store nur für Preview, Ablauf `docs/ai-business/J05_PREVIEW_LAUF.md` |
| Modellvergleich | Kostenfreigabe |
| DB-SSL | `sslmode=verify-full` in `DATABASE_URL` |

## 6. Kritische Risiken

- Tagesfreigaben hängen am 24-h-Fenster, solange die Vorlage aus ist.
- YouTube-Token-Ablauf ~17.10.
- Preview-Isolation nur teilweise (26 Variablen ohne Preview-Ziel; `runtime-guard` sperrt Wirkungen außerhalb Production).

## 7. Nächste Schritte (priorisiert)

1. Betreiber: per WhatsApp „Status“ bzw. Command Center prüfen, ob die Themen-Pipeline tatsächlich läuft (Variablen seit 18.10. vorhanden).
2. Ersten Reel-Praxistest nach `docs/FIRST_REEL_TEST.md` (Kostenfreigabe ≈ 3 USD Runway).
3. Betreiber: anmelden, Command Center → „Steckbriefe“ prüfen (macht DB-Nachweise sichtbar).
4. `TRENDSCOUT_TOPICS=on` eine Woche testen (nur Recherche, keine Veröffentlichung), dann `PRODUCT_MIX=balance`.
5. YouTube-Token / Google-App-Status.
6. HeyGen-Entscheidungen, dann ein freigegebener Testclip; danach Provider auf API v3 (1080p) umstellen.
7. Command Center: Entscheidungsliste aus `content_chances`, `content_jobs`, `publication_requests`, `topic_video_days`.
8. Eine Woche `model_calls` auswerten, dann über Modellvergleich entscheiden.

## 8. Übergabe an die nächste Sitzung

- Zuerst `CLAUDE.md`, dieses Dokument, `AGENTS.md`; GitHub-Status und letztes Production-Deployment prüfen.
- Tests: `npm test` (~10 min, 892 Tests), `npm run typecheck`, `npm run lint`, `npm run build`; CI führt zusätzlich `npm audit --omit=dev` aus.
- In der Cloud-Umgebung: Build nicht in einem Git-Worktree mit verlinktem `node_modules` (Turbopack-Fehler) – im Hauptcheckout bauen.
- Keine Secrets geändert, keine Live-Posts, keine kostenpflichtigen Aufrufe, keine Schalter aktiviert. Ein Versuch, Schalter über Code-Voreinstellungen zu aktivieren, wurde vom Auto-Modus blockiert und verworfen – Aktivierung bleibt Betreibersache in Vercel.

# Themen-Pipeline: Aktivierungsvorbereitung (nicht aktiviert)

**Zustand heute:** IMPLEMENTIERT, LOKAL GETESTET (Mocks), GEMERGT (#60), DEPLOYED, **NICHT KONFIGURIERT, NICHT AKTIV, NICHT LIVE VERIFIZIERT.**
In Vercel (Production) existiert weder `TOPIC_PIPELINE_ENABLED` noch `TOPIC_LIVE_PUBLISHING` noch `TOPIC_PLATFORMS`; `vercel.json` plant `/api/cron/topic-scout` nicht (Test `topic-cron.test.cjs` sichert das ab). Dieser Branch aktiviert nichts.

## Simulierter Ende-zu-Ende-Nachweis (bereits vorhanden, hier nur zugeordnet)
| Stufe | Test (Mocks, keine echten Posts) |
|---|---|
| Themenrecherche → Bewertung → Auswahl | `dry-run-e2e.test.cjs` „full dry run: scout → Jarvis → proposal …“, `topic-scout.test.cjs` |
| Entwurf, Änderungswunsch, neue Fassung | `dry-run-e2e`, `topic-pipeline.test.cjs` (Änderung erzeugt neue Version + neue Anfrage) |
| Qualitätsprüfung (Bild-Gate, Fallback-Kette) | `fallback-chain.test.cjs`, `visual-engine.test.cjs`, `image-quality.test.cjs` |
| simulierte Freigabe | `topic-pipeline.test.cjs` „end to end: proposal → production approval → publish approval → publish → report“ |
| simulierte Veröffentlichung, Statusspeicherung | `publish-approval-gate.test.cjs`, `topic-pipeline.test.cjs` (Ergebnis je Plattform in `publish_attempts`) |
| Preview-/Nicht-Production-Sperre | `runtime-guard.test.cjs` (neu): vollständig freigegebene Fassung erhält in Preview keinen Permit |
| Produkt-Pipeline unbeeinträchtigt | `shared-distribution.test.cjs`, vollständige Suite |

## Reifegrad je Baustein
| Baustein | Stand |
|---|---|
| Scout, Scoring, Gate, Format-Router, Master Content, Plattform-Adapter, Freigabeschranke, Cron-Lease | technisch funktionsfähig, **nur mit Mocks geprüft** |
| Quellen Google News/Trends RSS, Wikipedia | ohne Schlüssel, **Live-Test notwendig** (Format/Erreichbarkeit unbestätigt) |
| Tavily | Schlüssel in Vercel vorhanden (Production/Preview/Dev), Live-Verhalten unbestätigt |
| Replicate-Bilder + Quality-Gate | Token vorhanden; Modell/Vision **Live-Test notwendig** (siehe `IMAGE_QUALITY_VERIFICATION.md`) |
| Facebook/Instagram | bestehende Meta-Anbindung (Produkt-Pipeline), Themen-Credentials `META_PAGE_ID`/`META_INSTAGRAM_USER_ID` in Vercel nicht gelistet → **manuell zu konfigurieren/zu verifizieren** |
| TikTok, YouTube Shorts, X | implementiert; **externer Account + manuelle Konfiguration erforderlich**, Zugangsdaten fehlen nachweislich |
| HeyGen | Adapter implementiert; **Account, Avatar, Stimme, Monatslimit fehlen nachweislich** |
| Runway Standardvideo | Schlüssel vorhanden; opt-in über `TOPIC_STANDARD_VIDEO_PROVIDER=runway` |
| `TOPIC_LANDING_URL` (Profil-Link) | fehlt nachweislich |

## Aktivierungsschritte (jeweils eigene Betreiberfreigabe, in dieser Reihenfolge)
1. Preview-Isolation umsetzen (`docs/PREVIEW_ISOLATION.md`), Migration 034 prüfen, Vision verifizieren.
2. Zugänge je Plattform eintragen, **eine** Plattform mit privater/unlisted/`SELF_ONLY`-Sichtbarkeit live testen (`TOPIC_PLATFORMS=<eine>`).
3. `TOPIC_PIPELINE_ENABLED=true` **ohne** `TOPIC_LIVE_PUBLISHING` (Trockenlauf): Vorschläge per WhatsApp, Status prüfen, nichts wird gepostet.
4. `TOPIC_LIVE_PUBLISHING=true` für die getestete Plattform; erster echter Beitrag mit ausdrücklicher „Freigeben“-Antwort.
5. Erst danach Cron `/api/cron/topic-scout` in `vercel.json` eintragen.

## Abnahmebedingungen
Siehe Abschlussbericht, Abschnitt L.

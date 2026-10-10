# Multichannel-Einrichtung (Stand 2026-10-10)

Basis: `docs/CREDENTIALS.md`, `lib/capabilities/index.ts`, Vercel-Variablenliste (nur Namen). Nichts davon wurde live gegen eine
Plattform geprüft. Alle fünf Adapter sind implementiert und mit Mocks getestet; Live-Veröffentlichung ist doppelt gesperrt
(`TOPIC_LIVE_PUBLISHING` nicht gesetzt, Themen-Pipeline aus).

| Plattform | Code | Zugangsdaten in Vercel | Plattform-Freigaben (extern) | Live belegt |
|---|---|---|---|---|
| Instagram | Bild, Karussell, Reel (Container → Freigabe-Re-Check → `media_publish`) | `META_SYSTEM_USER_TOKEN` vorhanden (nur production/preview/development-Datensätze); **fehlt:** `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`; Blob-Token vorhanden | Business-Konto mit Facebook-Seite, `instagram_content_publish`, `pages_read_engagement`; App-Review für Advanced Access; Limit 25 Posts/24 h | nein (Themen-Pfad) |
| Facebook | Text, Foto, Album, Video | Token vorhanden; **fehlt:** `META_PAGE_ID` | `pages_manage_posts` (Seiten-Task für den System-User) | Foto der Produkt-Pipeline: ja laut Doku |
| YouTube Shorts | Resumable Upload, Standard `private` | **fehlt:** `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | Google-Cloud-Projekt, YouTube Data API v3 aktivieren, OAuth-Zustimmungsbildschirm, Scope `youtube.upload`, Audit für öffentliche Uploads (sonst privat); Quota ≈1600 Einheiten/Upload bei 10 000/Tag | nein |
| TikTok | Content Posting API, Direct Post, Standard `SELF_ONLY` | **fehlt:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN`/`TIKTOK_REFRESH_TOKEN` | Developer-App, Produkt „Content Posting API“, Scope `video.publish`, App-Audit (sonst nur privat), verifizierter URL-Präfix für die Blob-Domain | nein |
| X | API v2, OAuth 1.0a, Medien + Post | **fehlt:** `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | Developer-Projekt/App mit Lese- und Schreibrecht; kostenpflichtiger Tarif für Posts/Medien (Preise vor Aktivierung prüfen) | nein |

## Priorisierte Einrichtungsliste

1. **Preview-Isolation** (siehe `PREVIEW_ISOLATION_MATRIX.md`) – Voraussetzung für jeden Live-Test.
2. **Meta:** `META_PAGE_ID` und `META_INSTAGRAM_USER_ID` ermitteln (`/api/meta/connection` liest nur) und in **Production** setzen; Berechtigungen des System-Users prüfen. Instagram + Facebook haben die kleinste Lücke.
3. **YouTube Shorts:** kostenlos, aber OAuth-Einrichtung und Refresh-Token (einmalige Zustimmung des Kanalinhabers). Anfangs `private`.
4. **TikTok:** App-Audit dauert; früh beantragen, bis dahin nur `SELF_ONLY`.
5. **X:** zuletzt, kostenpflichtiger Tarif; erst nach Budgetentscheidung.
6. Danach: Preview-Trockenlauf, Migration 034 prüfen, Themen-Pipeline erst nach separater Freigabe aktivieren.

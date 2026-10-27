# Credential- und Capability-Matrix

Quelle der Wahrheit im Code: `lib/capabilities/index.ts` (`SERVICES`). Ein Test (`tests/capabilities.test.cjs`)
stellt sicher, dass jede dort bekannte Variable hier dokumentiert ist. Der WhatsApp-Befehl „Status“ zeigt je
Plattform und Anbieter: **bereit**, **nur Dry-Run**, **blockiert – <Variable> fehlt** oder **nicht aktiviert** –
immer nur Variablennamen, nie Werte.

Spalten: **Pflicht** = für die eigentliche Funktion dieses Dienstes nötig · **Dry-Run / Produktion / Live** = für
den jeweiligen Schritt der Themen-Pipeline nötig · **Impl.** = realer Client im Repository · **Live verifiziert** =
gegen den echten Anbieter geprüft.

## Schalter (keine Geheimnisse)

| Variable | Wirkung | Standard |
| --- | --- | --- |
| `TOPIC_PIPELINE_ENABLED` | Themen-Pipeline (Cron, WhatsApp-Antworten) ein | aus |
| `TOPIC_LIVE_PUBLISHING` | echte Veröffentlichung; nur der exakte Wert `true` schaltet ein | aus (Dry-Run) |
| `TOPIC_PLATFORMS` | aktivierte Plattformen, z. B. `instagram,facebook` | alle fünf |
| `TOPIC_COPY_MODE` | `ai` = KI-Texte (Replicate), sonst Referenzmodus | Referenz |
| `TOPIC_STANDARD_VIDEO_PROVIDER` | `runway` schaltet Standard-Video frei | aus |
| `TOPIC_SOURCE_GOOGLE_NEWS`, `TOPIC_SOURCE_GOOGLE_TRENDS`, `TOPIC_SOURCE_WIKIPEDIA` | `false` schaltet die Quelle ab | an |
| `TOPIC_LINK_POLICY`, `TOPIC_BRAND_PALETTE` | Linkregeln / Farben | Standardwerte |
| `TOPIC_POSTS_PER_DAY` | geplante Themenvorschläge je Kalendertag (Europe/Berlin), 1–4 | 1 |
| `TOPIC_ORDERS_ENABLED` | `true`: Themenauftrag per WhatsApp („Mach etwas über X“, „Thema: X“) erzeugt einen normalen Themenvorschlag (beide Freigaben, Schutzprüfungen bleiben); wirkt nur mit `TOPIC_PIPELINE_ENABLED=true` | aus |
| `TOPIC_ORDERS_PER_DAY` | Themenaufträge je Kalendertag (Europe/Berlin), 1–10; abgelehnte zählen nicht | 5 |
| `TRENDSETTER_AFFILIATE` | `record`: Trend-Agent-Chancen als gemeinsame Ergebnisse speichern; `route`: zusätzlich nur von Jarvis zugewiesene Chancen zur Produktsuche | aus (Affiliate-Pipeline unverändert) |
| `TRENDSCOUT_TOPICS` | `on`: Trend-Agent recherchiert im selben Lauf zusätzlich allgemeine Themen (Haushaltstipps, Alltagstricks, Wissen/Kurioses); Themen-Chancen werden als gemeinsame Ergebnisse gespeichert, nichts wird produziert oder veröffentlicht | aus (Recherche unverändert) |
| `PRODUCT_MIX` | `balance`: Jarvis ordnet bereits freigegebene Produktchancen leicht (max. ein Rang) Richtung unterrepräsentierter Preissegmente; dazu optional `PRODUCT_PRICE_TIER_LIMITS` (z. B. `30,150` €), `PRODUCT_MIX_TARGET` (z. B. `low:40,mid:35,high:25`), `PRODUCT_MIX_WINDOW` (4–50, Standard 12) | aus (Reihenfolge unverändert) |
| `TOPIC_DAILY_VIDEO` | `true`: täglicher Themenvideo-Vorschlag (Cron 10/11/12 UTC, Fenster 12–14 Uhr Berlin, max. 1 je Tag); nur Entwurf, Rendering erst nach Kostenfreigabe | aus |
| `TOPIC_VIDEO_MAX_USD`, `TOPIC_VIDEO_MONTHLY_BUDGET_USD` | Höchstbetrag je Themenvideo bzw. Monatsbudget aller kostenfreigegebenen Themenvideos (USD, Schätzung) | 5 / 30 |
| `TOPIC_COPY_MODE` | `ai`: Texte und Video-Drehbuch der Themen-Pipeline per KI (ein geprüfter Modellaufruf); sonst Referenzvorlage | Referenzvorlage |

Live-Veröffentlichung einer Plattform erfordert **alle**: gültige zweite WhatsApp-Freigabe der exakten Fassung,
`TOPIC_LIVE_PUBLISHING=true`, Plattform in `TOPIC_PLATFORMS`, alle Pflicht-Variablen der Plattform. Die
Freigabeschranke prüft das selbst (`authorizePublish`).

## Matrix

| Dienst | Env-Variable | Pflicht | Zweck | Dry-Run | Produktion | Live | Impl. | Live verifiziert |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Instagram | `META_SYSTEM_USER_TOKEN` oder `META_PAGE_ACCESS_TOKEN` | ja (eins von beiden) | Page-Token für Graph API (bestehend) | nein | nein | ja | ja | nein (Themen-Pfad) |
| Instagram | `META_PAGE_ID` | ja | verbundene Facebook-Seite | nein | nein | ja | ja | nein (Themen-Pfad) |
| Instagram | `META_INSTAGRAM_USER_ID` | ja | Instagram-Business-Konto | nein | nein | ja | ja | nein (Themen-Pfad) |
| Instagram | `BLOB_READ_WRITE_TOKEN` | ja | JPEG-Kopien für Instagram ablegen | nein | ja | ja | ja | nein |
| Instagram | `META_GRAPH_API_VERSION` | optional | Graph-Version (Standard v25.0) | nein | nein | nein | ja | – |
| Instagram | `META_BUSINESS_ID` | optional | Verbindungsprüfung | nein | nein | nein | ja | – |
| Facebook | `META_SYSTEM_USER_TOKEN` oder `META_PAGE_ACCESS_TOKEN` | ja | Text, Foto, Album, Video | nein | nein | ja | ja | Foto: ja (Produkt-Pipeline); Text/Album/Video: nein |
| Facebook | `META_PAGE_ID` | ja | Seite | nein | nein | ja | ja | wie oben |
| TikTok | `TIKTOK_ACCESS_TOKEN` | ja (oder Refresh-Trio) | Content Posting API (Direct Post) | nein | nein | ja | ja | nein |
| TikTok | `TIKTOK_REFRESH_TOKEN` + `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` | ja (statt Access-Token) | automatische Token-Erneuerung | nein | nein | ja | ja | nein |
| TikTok | `TIKTOK_PRIVACY_LEVEL` | optional | Sichtbarkeit, Standard `SELF_ONLY` | nein | nein | nein | ja | – |
| YouTube Shorts | `YOUTUBE_CLIENT_ID` | ja | OAuth-Client | nein | nein | ja | ja | nein |
| YouTube Shorts | `YOUTUBE_CLIENT_SECRET` | ja | OAuth-Client | nein | nein | ja | ja | nein |
| YouTube Shorts | `YOUTUBE_REFRESH_TOKEN` | ja | Upload-Berechtigung (`youtube.upload`) | nein | nein | ja | ja | nein |
| YouTube Shorts | `YOUTUBE_PRIVACY_STATUS` | optional | `public`/`unlisted`/`private`, Standard `private` | nein | nein | nein | ja | – |
| YouTube Shorts | `YOUTUBE_CATEGORY_ID` | optional | Kategorie, Standard 26 | nein | nein | nein | ja | – |
| X | `X_API_KEY` | ja | OAuth 1.0a Consumer Key | nein | nein | ja | ja | nein |
| X | `X_API_SECRET` | ja | OAuth 1.0a Consumer Secret | nein | nein | ja | ja | nein |
| X | `X_ACCESS_TOKEN` | ja | User-Token mit Schreibrecht | nein | nein | ja | ja | nein |
| X | `X_ACCESS_TOKEN_SECRET` | ja | User-Token-Secret | nein | nein | ja | ja | nein |
| Replicate (Bilder, Router, Texte) | `REPLICATE_API_TOKEN` | ja | FLUX-Bilder, semantischer WhatsApp-Router, KI-Texte | nein | ja | nein | ja | Router/Produktbilder: ja (Produkt-Pipeline); Themen-Bilder: nein |
| Replicate | `REPLICATE_IMAGE_MODEL` | optional | Bildmodell | nein | nein | nein | ja | – |
| Vercel Blob (Medienablage) | `BLOB_READ_WRITE_TOKEN` | ja | Bilder, Textgrafiken, Videos ablegen | nein | ja | ja | ja | Produkt-Pipeline: ja |
| HeyGen (Avatar-Video) | `HEYGEN_API_KEY` | ja | Avatar-Videos | nein | ja | nein | ja | nein |
| HeyGen | `HEYGEN_AVATAR_ID` | ja | Avatar | nein | ja | nein | ja | nein |
| HeyGen | `HEYGEN_VOICE_ID` | ja | Stimme | nein | ja | nein | ja | nein |
| HeyGen | `HEYGEN_MONTHLY_VIDEO_LIMIT` | ja | lokales Monatskontingent; ohne Limit kein Avatar-Video | nein | ja | nein | ja | – |
| HeyGen | `HEYGEN_ENABLED` | ja | Schalter; nur exakt `true` erlaubt Avatar-Videos (Standard aus) | nein | ja | nein | ja | nein |
| Runway (Standard-Video) | `RUNWAYML_API_SECRET` | ja | Standard-Video (bestehende Anbindung, opt-in) | nein | ja | nein | ja | Produkt-Pipeline: ja; Themen-Pfad: nein |
| Runway | `RUNWAY_MONTHLY_BUDGET_CREDITS` | optional | Monatsbudget (bestehend) | nein | nein | nein | ja | – |
| OpenAI (Bild-Fallback Produkt-Pipeline) | `OPENAI_API_KEY` | nur Produkt-Pipeline | Bildprovider, wenn Replicate fehlt; Themen-Pipeline nutzt ihn nicht | nein | nein | nein | ja | – |
| OpenAI | `OPENAI_IMAGE_MODEL` | optional | Bildmodell | nein | nein | nein | ja | – |
| Tavily News (Themenquelle) | `TAVILY_API_KEY` | optional | aktuelle Meldungen; ohne Key übrige Quellen | nein | nein | nein | ja | Produkt-Pipeline: ja; News-Modus: nein |
| Google News RSS (Themenquelle) | – | – | öffentlicher Feed | nein | nein | nein | ja | nein (Sandbox gesperrt) |
| Google Trends RSS (Themenquelle) | – | – | öffentlicher Feed | nein | nein | nein | ja | nein (Sandbox gesperrt) |
| Wikimedia Pageviews (Themenquelle) | – | – | offizielle REST-API | nein | nein | nein | ja | nein (Sandbox gesperrt) |
| WhatsApp (Freigaben) | `WHATSAPP_ACCESS_TOKEN` (Altname `WHATTSAPP_ACCESS_TOKEN`) | ja | Nachrichten senden (bestehend) | ja | ja | ja | ja | ja |
| WhatsApp | `WHATSAPP_PHONE_NUMBER_ID` (Altname `WHATTSAPP_PHONE_NUMBER_ID`) | ja | Absendernummer | ja | ja | ja | ja | ja |
| WhatsApp | `WHATSAPP_VERIFY_TOKEN` | ja | Webhook-Verifizierung | ja | ja | ja | ja | ja |
| WhatsApp | `META_APP_SECRET` | ja | Webhook-Signatur | ja | ja | ja | ja | ja |
| WhatsApp | `WHATSAPP_APPROVER_WA_ID` | ja | einzige Freigabeinstanz | ja | ja | ja | ja | ja |
| Postgres | `DATABASE_URL` | ja | Jobs, Freigaben, Historie | ja | ja | ja | ja | ja |
| Cron-Schutz | `CRON_SECRET` | ja | Authentifizierung `/api/cron/topic-scout` | ja | ja | ja | ja | ja (andere Crons) |
| Landingpage (Profil-Link) | `TOPIC_LANDING_URL` | optional | Ziel von „Link im Profil“ | nein | nein | nein | ja | – |

„Live verifiziert: ja“ bezieht sich ausschließlich auf bereits produktiv genutzte Wege der bestehenden
Produkt-Pipeline. Kein neuer Weg der Themen-Pipeline wurde gegen echte Anbieter geprüft.

## Externe Voraussetzungen außerhalb von Variablen

- **TikTok:** App mit Content Posting API und `video.publish`-Scope; App-Audit, sonst nur `SELF_ONLY`;
  verifizierte URL-Präfixe für die Blob-Domain (PULL_FROM_URL).
- **YouTube:** OAuth-Zustimmungsbildschirm, Scope `https://www.googleapis.com/auth/youtube.upload`; ungeprüfte
  Apps laden ggf. nur privat hoch; Tageskontingent der Data API (Upload ≈ 1600 Einheiten).
- **X:** Projekt/App mit Lese- und Schreibrecht (Basic-Tarif oder höher für Media-Upload und Posts).
- **Instagram:** Business-Konto mit verbundener Seite, Berechtigungen `instagram_content_publish`,
  `pages_read_engagement`; Veröffentlichungslimit (25 Posts / 24 h).

## Produktionsaudit 13.10.2026: vorbereitete Erweiterungen

- `TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT`: positive ganze Zahl, separat für Themenvideos; fehlt standardmäßig (keine Generierung). Zusätzlich begrenzt `RUNWAY_MONTHLY_BUDGET_CREDITS` beide Runway-Pipelines gemeinsam. Fehlgeschlagene/unklare Aufträge zählen konservativ weiter.
- Pinterest ist NICHT Teil der Standardplattformen. Erst explizites `TOPIC_PLATFORMS=pinterest` (oder gezielte Liste mit Pinterest), Live-Schalter und exakte Inhaltsfreigabe erlauben den Adapter.
- `PINTEREST_ACCESS_TOKEN`, `PINTEREST_ACCESS_TOKEN_EXPIRES_AT` (ISO-8601-Zeitpunkt), `PINTEREST_BOARD_ID`: sicher in Production speichern. Unbekannter/abgelaufener Zeitpunkt sperrt jeden Pin.
- `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`: für OAuth-Refresh; `refreshPinterestToken` unterstützt Tokenrotation. Automatischer Refresh erfordert einen angeschlossenen, verschlüsselten `PinterestTokenStore` mit workerübergreifender Sperre. Dieser Store ist bewusst noch NICHT eingerichtet; keine Zugangsdaten in Jobtabellen oder Logs schreiben. Bis dahin Token kontrolliert erneuern und als Sensitive-Umgebungsvariable übernehmen.
- Video-Pins nutzen das vorhandene MP4 plus ein bereits freigegebenes Bild aus demselben Master-Content. Ohne Titelbild wird nicht veröffentlicht; keine zusätzliche kostenpflichtige Generierung.

# Jarvis: Prüfbericht, Command Center 2.0, Trendsetter und Themen-Pipeline (Stand 2026-10-10, PR #64)

Grundlage: Quellcode, Migrationen, Tests, `vercel.json`, Vercel-Variablenliste (nur Namen, keine Werte), lokale Browser-Tests.
Nichts wurde gemergt, nichts in Production aktiviert, nichts veröffentlicht, keine kostenpflichtigen Aufrufe, keine
WhatsApp-Nachrichten. Aussagen ohne Laufzeitnachweis sind als solche gekennzeichnet.

## 1. Bestandsaufnahme der Auffälligkeiten

| # | Anzeige im alten Command Center | Befund | Art |
|---|---|---|---|
| 1 | Themen-Pipeline-Orchestrator „deaktiviert“ | `TOPIC_PIPELINE_ENABLED` ist in keiner Umgebung gesetzt, `/api/cron/topic-scout` steht bewusst nicht in `vercel.json`. Code vollständig, mit Mocks getestet. | **Absichtliche Deaktivierung** |
| 2 | Themen-Scout „deaktiviert“ | Gleicher Schalter. Quellen (Google News/Trends, Wikipedia) live nie abgerufen. | **Absichtliche Deaktivierung**, Live-Nachweis fehlt |
| 3 | Executive-Agent „geplant“ | Nur Schnittstelle (`lib/publishing/authority.ts`), kein Agentencode. Nicht Teil des Go-live. | **Korrekt dargestellt** (jetzt „Geplant · Kein Betrieb“) |
| 4 | Bild-Qualitätsprüfung „nicht vollständig verifiziert“ | Kriterien im Code vollständig (siehe 3.3). Offen ist nur der Nachweis, dass das Vision-Modell das Bild wirklich sieht (Smoke-Test Stufe 2, kostenpflichtig, nicht ausgeführt). | **Fehlende Verifikation**, kein Codefehler |
| 5 | Publisher „getestet, nicht live verifiziert“ | Adapter vollständig mit Mocks getestet. Es fehlen Zugangsdaten bzw. Plattformfreigaben (Abschnitt 5). | **Fehlende Konfiguration** |
| 6 | Unterschiedliche Credentials je Deployment | Preview teilt Neon, Blob, WhatsApp-Freigabeinstanz und Meta-App-Secret mit Production (`docs/PREVIEW_ISOLATION_MATRIX.md`). Code-Sperre aktiv. | **Bekanntes Risiko**, dokumentiert |
| 7 | Code-, Deployment- und Betriebsstatus vermischt | Das alte Modell mischte Testabdeckung, Doku-Aussagen („live verifiziert“) und Aktivierung in einer Farbe. | **Irreführende Visualisierung** → behoben (Abschnitt 2) |

Zusätzlich gefunden und behoben:
- **Kein Tageslimit für Themenvorschläge.** Der Cron arbeitet mit Stunden-Slots; eingetragen hätte er bis zu 24 Vorschläge pro Tag erzeugt. Neu: `TOPIC_POSTS_PER_DAY` (Standard 1, max. 4), Test `tests/topic-daily-limit.test.cjs`.
- **WhatsApp-„Status“ ohne Links.** Neu: zuletzt veröffentlichte Themenbeiträge mit den von der Plattform gelieferten Links (nur Plattform-Domain, nie konstruiert).
- **Zwei Recherchewege ohne gemeinsame Ergebnisse.** Themenchancen des Trend-Agents wurden verworfen („für später gespeichert“, aber nie genutzt). Neu: Trendsetter (Abschnitt 3.1).
- Faceless.so ist laut Vorgabe kein aktiver Produktionsanbieter. Im Themen-Pfad war er nie angebunden; im **Produkt-Studio** ist er technisch noch manuell wählbar (**Entscheidung offen**: Auswahlpunkt entfernen?).
- Pinterest: **kein Code**. Nur die öffentliche Datenschutz-URL existiert. Im Command Center als „Geplant“ geführt.

## 2. Command Center 2.0

- **Aufbau:** Jarvis groß im Zentrum, sieben Hauptbereiche auf einem Ring (in Ablaufreihenfolge), Komponenten erst beim Anklicken eines Bereichs. Kamera fokussiert sanft (bei `prefers-reduced-motion` ohne Animation), nicht beteiligte Bereiche treten zurück, nur relevante Verbindungen werden gezeigt.
- **Drei Status-Dimensionen:** Umsetzung (Geplant/Implementiert/Getestet, aus Code und Tests), Deployment (Nicht deployt/Preview/Production, aus dem Repo-Stand), Betrieb (Nicht konfiguriert/Deaktiviert/Bereit/Aktiv/Fehler/Unbekannt). Jeder Betriebsstatus nennt **Grund, Quelle** (Konfiguration, Datenbank, Repo-Analyse, Betreiberentscheidung, Preview-Sperre) **und Zeitpunkt**. „Live verifiziert“ gibt es nicht mehr als Status; ein dokumentierter Nachweis erscheint getrennt, mit Quelle.
- **Serverseitig berechnet** (`lib/architecture/runtime.ts`): nur Variablennamen und Schalter, nie Werte; lesende Datenbank-Nachweise (`lib/architecture/snapshot.ts`, nur `SELECT`). In Preview sperrt der Runtime-Guard die Datenbank – die Oberfläche sagt das, statt zu raten.
- **Ablaufansicht:** neun Schritte vom Finden der Chance bis zur Rückmeldung. Mit Datenbankdaten zeigt sie Zahlen (Stand-Zeit), sonst ausdrücklich „Architekturdarstellung“.
- **2D-Ansicht:** gruppiert, aufklappbar, Karten mit Status und Erklärung; identische Detailpanels.
- **Bedienung:** Maus/Touch, Tastatur (← → Bereiche/Komponenten, Enter öffnen, ↑/Esc zurück, Pos1 Übersicht), Screenreader-Ansage, Tooltips.
- **Messung** (lokal, Chromium im App-Browser, Fenster nicht sichtbar → keine echten FPS messbar): CPU-Zeit pro Frame Übersicht Median 1,0 ms / p95 1,8 ms, 39 Draw-Calls, ≈ 28 000 Dreiecke; aufgeklappter Bereich Median 1,4 ms / p95 2,4 ms, 68 Draw-Calls. GPU-Zeit nicht gemessen.
- **Sicherheit:** `/api/architecture` nur mit Zugangscode (Test: ohne/falscher Code → 401), nur GET, `no-store`, keine Werte im Response (Test).

## 3. Themen-Pipeline und Trendsetter

### 3.1 Trendsetter (neu, `lib/trendsetter/`, Migration 035)
- Führt beide Recherchewege zu **einer** Content-Chance je Konzept zusammen: eindeutige ID (`cc_…`), Quellen, Zeitstempel, Gültigkeit, fünf Bewertungen (Aktualität, Relevanz, Zielgruppeninteresse, Vertrauenspotenzial, Reichweitenpotenzial) mit Faktoren, Eignung (gewichtet, Vertrauen wird nie gegen Reichweite getauscht) und Empfehlung (Affiliate / Thema / beides / keine).
- **Jarvis entscheidet zentral** (`routing.ts`, deterministisch, mit Begründung): Affiliate (erst dann sucht der Produkt-Scout ein Produkt), Thema (ohne Produktpflicht), beides (nur bei zwei unterschiedlichen Ansätzen und Eignung ≥ 70), zurückhalten (Zeitsperre) oder verwerfen.
- **Duplikatkontrolle und Zeitsperren:** gleiches Konzept 21 Tage (Affiliate) / 14 Tage (Thema), Ablehnung 14 Tage, andere Pipeline 7 Tage. Eine offene Zuweisung je Chance und Pipeline (eindeutiger Index) → keine Doppelverarbeitung durch wiederholte Cron-Läufe.
- **Themen-Pipeline:** nutzt den Trendsetter direkt (sie ist in Production ohnehin aus). Ist die Schicht nicht erreichbar, greift der dokumentierte Ausweichweg (bestes Thema des Scouts, protokolliert).
- **Affiliate-Pipeline (produktiv):** unverändert, solange `TRENDSETTER_AFFILIATE` nicht gesetzt ist. `record` speichert nur gemeinsame Ergebnisse, `route` lässt nur von Jarvis zugewiesene Chancen zur Amazon-Suche. Ein Fehler der Schicht stoppt die Affiliate-Pipeline nie.
- Grenze: Eine „beides“-Zuweisung aus der Themen-Pipeline wird der Affiliate-Pipeline angeboten; diese nimmt sie auf, wenn der Trend-Agent das Konzept erneut liefert. Ein eigener Abruf offener Angebote durch den Produkt-Scout ist nicht gebaut.

### 3.2 Themen-Pipeline (vorhanden, geprüft)
Scout → Jarvis-Prüfung/Trendsetter → Format-Router → Text/Medien → Bildprüfung → Vorschlag per WhatsApp → „Freigeben“ (Inhalt und Produktionskosten) → Produktion → Veröffentlichungsfreigabe der exakten Fassung → Publisher → Bericht mit Links. Technisch fertig und mit Mocks Ende-zu-Ende getestet; **nicht aktiviert, nicht live verifiziert**.
- Bei Themen sind Inhalts- und Kostenfreigabe **ein** Schritt (der Vorschlag zeigt Format und geplante Produktion); die Veröffentlichungsfreigabe ist immer getrennt. Die Produkt-Pipeline hat getrennte Inhalts- und Kostenfreigaben.
- Format-Router: wählt nach Nutzen, Plattform-Passung und Kosten, nur verfügbare Anbieter (Replicate, Runway opt-in, HeyGen nur mit Account/Limit). Text braucht keinen Anbieter. Faceless.so ist im Themen-Pfad nicht angebunden.

### 3.3 Bild-Qualitätsprüfung
Harte Ausschlussgründe im Code (`lib/content/image-quality/gate.ts`): falsches/fehlendes Hauptmotiv, ausgeschlossene Objekte, falsches Produkt, schwere Bildfehler, unrealistische Produktdarstellung, Schrift/Logos (bei nicht symbolischen Bildern), technisch: nicht abrufbar, beschädigt, nicht 4:5 (alle erzeugten Bilder sind PNG 4:5). Weiche Gründe: Komposition, leichte Fehler, Idee nicht erkennbar. Unsicher ⇒ nie freigegeben. Fehlercodes für gezielte Korrektur (`feedback.ts`). Kostenbremse: 2 Bildversuche je Auftrag, 12 je 24 h. **Offen:** Smoke-Test Stufe 2 (ein kostenpflichtiger Aufruf) – braucht Freigabe.

## 4. WhatsApp und Freigaben
Vorhanden und getestet: Vorschläge empfangen, freigeben, ablehnen, ändern (auch freie Sprache und Sprachnachricht), Status abfragen. Zuordnung über die zitierte Nachricht; ohne Zitat entscheidet der semantische Router und fragt bei Mehrdeutigkeit nach. Jede Änderung erzeugt eine neue Version und macht offene Freigaben ungültig (`invalidateApprovals`). Veraltete Nachrichten werden als veraltet beantwortet. Keine Veröffentlichung durch bloße Inhaltsfreigabe.

## 5. Plattformen

| Plattform | Formate | Authentifizierung | Variablen in Vercel (nur Namen) | Externe Freigaben | Status |
|---|---|---|---|---|---|
| Instagram | Bild, Karussell, Reel | Meta System-User-Token | Token vorhanden; **fehlt** `META_PAGE_ID`, `META_INSTAGRAM_USER_ID` | `instagram_content_publish`, ggf. App-Review, 25 Posts/24 h | Getestet, nicht konfiguriert (Themen-Pfad) |
| Facebook | Text, Foto, Album, Video | Meta-Token | **fehlt** `META_PAGE_ID` (Themen-Pfad) | `pages_manage_posts` | Foto der Produkt-Pipeline laut Doku live |
| TikTok | Video, Foto-Slideshow | OAuth (Access/Refresh) | keine | Content Posting API, `video.publish`, App-Audit (sonst nur privat), verifizierter URL-Präfix | Getestet, nicht konfiguriert |
| YouTube Shorts | Hochkant-Video | OAuth-Refresh-Token | Client-ID, Secret, Refresh-Token **nur Production** | Testmodus: Refresh-Token läuft nach 7 Tagen ab → auf „In Produktion“ stellen; öffentliche Uploads erst nach API-Audit (sonst privat); ≈1600 Einheiten/Upload | Getestet, Zugang vorhanden, Token-Gültigkeit **nicht geprüft** |
| X | Text, Bilder, Video | OAuth 1.0a | keine | bezahlter Tarif mit Schreibrecht | Getestet, nicht konfiguriert |
| Pinterest | – | – | keine | Developer-App, OAuth, Board-Rechte | **Kein Code** |

Je Plattform geprüft (Code + Tests): Fehlerbehandlung (eindeutig vs. unklar), Statusrückmeldung (Abgleich ohne erneutes Posten), Persistenz von ID und Link (`publish_attempts`), Wiederholung nur fehlgeschlagener Plattformen, eine fehlgeschlagene Plattform macht erfolgreiche nicht ungültig. Erfolg nur über echte API-Antworten. YouTube Analytics API v2 ist **nicht implementiert**, der Scope `yt-analytics.readonly` ist derzeit ungenutzt.

## 6. Automatisierung und Stabilität
Vorhanden: Cron-Lease, Slot-Claim, Einmal-Claim je Plattform, Auftragsbuch für Medien (keine Doppelbestellung), Wiederaufnahme laufender Videojobs, Statusabgleich, Themen-Historie mit Cooldowns, Modellaufruf-Limit (4 je Themenbeitrag), Bild-, HeyGen- und Runway-Budgets. Neu: Tageslimit, Trendsetter-Sperren. Die Affiliate-Crons bleiben unberührt (eigene Routen und Tabellen; Trendsetter dort standardmäßig aus). Kein automatischer Fallback ohne Test; keine Selbstaktivierung.

## 7. Aktivierung (jeweils eigene Freigabe, in dieser Reihenfolge)
1. Preview-Isolation (Neon-Branch, zweiter Blob-Store, Test-WhatsApp) – sonst keine schreibenden Live-Tests.
2. Vision-Smoke-Test Stufe 2 (ein bezahlter Aufruf).
3. Merge von PR #64 → Migration 035 wird beim ersten Aufruf automatisch angewendet (additiv).
4. `TOPIC_PIPELINE_ENABLED=true` ohne Live-Publishing (Probelauf per WhatsApp), danach Cron `/api/cron/topic-scout` in `vercel.json`.
5. Plattform-Zugänge, je eine Plattform mit privater Sichtbarkeit testen, dann `TOPIC_LIVE_PUBLISHING=true` für genau diese Plattform.
6. Optional `TRENDSETTER_AFFILIATE=record`, nach Beobachtung `route`.

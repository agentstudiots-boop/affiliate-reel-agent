# Jarvis 3D Command Center, Architekturbestand und Inbetriebnahmeplan

Stand: Basis `d86dae1` (PR #63). Alle Aussagen beruhen auf Code, Tests und den vorhandenen Dokumenten
(`CREDENTIALS.md`, `TOPIC_PIPELINE_ACTIVATION.md`, `PREVIEW_ISOLATION.md`). **Nichts davon ist Laufzeit-Telemetrie.**
Die Statusfarben sind Review-Ergebnisse; „live verifiziert“ übernimmt die Angaben der Repo-Dokumentation und wurde in
dieser Arbeit **nicht** erneut gegen Produktion geprüft (keine Produktionszugriffe).

## 1. Was das Command Center ist

Eine interaktive 3D-Karte (Three.js über React Three Fiber/Drei) der tatsächlich vorhandenen Komponenten, Datenflüsse
und Freigabeschranken. Sie ist **read-only**:

- Daten kommen aus `lib/architecture/model.ts` (statisch, handgepflegt, per Test gegen das Repository geprüft).
- `GET /api/architecture` (Zugangscode `x-content-password`, wie alle Operator-Routen) liefert das Modell plus eine
  Liste *fehlender Variablennamen* dieses Deployments (`checkCapabilities()`, nie Werte).
- Kein Datenbankzugriff, keine Provider-, WhatsApp- oder Publishing-Aufrufe, keine Schreibzugriffe. Ein Test sperrt Importe
  dieser Module in `app/architecture`, `lib/architecture` und der Route.
- **Keine Live-Aktivität.** Bewegte Punkte in der Ansicht „Prozess“ sind dekorativ und im UI so benannt.

Start: Content Studio → Zugangscode eintragen → „Jarvis 3D Command Center öffnen“ (Vollbild-Dialog, `Esc` schließt).

## 2. Bedienung

| Aktion | Wirkung |
| --- | --- |
| Ziehen / Mausrad / Pinch | Orbit, Zoom (Touch-tauglich, `touch-action: none` auf der Szene) |
| Knoten anklicken | Detailpanel: Verantwortung, Abhängigkeiten (anklickbar), offene Punkte, Code/Tests, Variablennamen |
| Leerraum / „Gesamtansicht“ | Auswahl aufheben, Kamera zurücksetzen, Filter löschen |
| Cluster-Chips | Systembereiche ein-/ausblenden |
| Verbindungs-Chips (Legende) | Kantenarten ein-/ausblenden |
| Suche | hebt Treffer hervor (andere gedimmt) |
| Architektur / Prozess | Prozess zeigt kräftige Kanten mit dekorativen Datenpunkten |
| 2D-Ansicht | gruppierte Liste mit identischem Detailpanel |

Formen: Kugel Orchestrator · Oktaeder Spezialagent · Würfel internes Modul · Zylinder Provider · Ring Plattform ·
Ikosaeder Schranke · Tetraeder externer Dienst · Drahtgitter geplant. Farben = Status (Legende im UI).

## 3. Technik

- Abhängigkeiten neu: `three`, `@react-three/fiber@9`, `@react-three/drei@10`, `@types/three` (React 19 kompatibel;
  peer `react >=19 <19.4`, im Projekt 19.3). Der Hauptbundle bleibt unberührt: die Szene lädt per `next/dynamic`
  (`ssr: false`) erst beim Öffnen.
- `app/architecture/command-center.tsx`: UI, Datenladen, WebGL-Erkennung, Fehlergrenze, 2D-Fallback.
- `app/architecture/scene.tsx`: Canvas, Knoten, Kanten, Kamera. Labels sind Sprites mit Canvas-Textur (kein DOM-Overlay,
  kein Font-Download). Die Canvas wird nur einmal gemountet und danach ausgeblendet (`frameloop="never"`), weil das
  Unmounten einer R3F-Root unter React 19 Konsolenfehler erzeugt.
- Reduzierte Bewegung (`prefers-reduced-motion`): `frameloop="demand"`, keine Rotation, statische Datenpunkte.
- Fallbacks: kein WebGL, Fehler beim Laden/Rendern oder manuell → 2D-Ansicht mit allen Informationen.
- Layout: `lib/architecture/layout.ts` (deterministisch, getestet).

Erweiterung: neue Komponente = ein Eintrag in `NODES`/`EDGES`. `npm test` (`tests/architecture.test.cjs`) prüft eindeutige
IDs, keine hängenden Kanten, keine isolierten Knoten, dass jeder genannte Code-/Testpfad existiert, dass Variablen nur Namen
sind und dass nichts „live verifiziert“ ist, was keine Zugangsdaten hat. Neue Status nur mit Nachweis vergeben.

## 4. Bestandsaufnahme: Agenten, Module, Geplantes

**Eigenständige Spezialagenten** (`lib/content/agents/*`, isolierter JSON-Generator, keine Tools, nur über den Orchestrator):
Trend, Creative, Video, Image, Text, Marketing. Im Referenzmodus liefern sie regel-/vorlagenbasierte Entwürfe; der KI-Modus
ist implementiert, aber nicht live belegt. Es gibt keinen „autonomen Produktanalysten“.

**Orchestratoren:** Jarvis (`lib/orchestrator.ts` → `lib/content/orchestrator.ts`, max. 2 Revisionen/8 Modellaufrufe) und der
Themen-Pipeline-Orchestrator (`lib/topic-pipeline/orchestrator.ts`, deaktiviert).

**Module (keine Agenten):** Produkt-Scout, Produkt-Prüfung, Themen-Scout, Drehbuch-Regelwerk (historisch, vorlagenbasiert),
Format-Router, Bild-Qualitätsprüfung/Vision, Affiliate-/Produktvertrag, Visual Engine, WhatsApp-Router, Multichannel-Publisher.

**Geplant / nicht implementiert:** Executive-Agent (nur `ApprovalAuthorityKind`-Schnittstelle), Videoableitung aus Karussells
(YouTube überspringt Karussells bewusst).

**Datenfluss, im Code vorhanden und verbunden:** Idee (Scout/Seeds) → Recherche (Tavily, RSS, Wikipedia) → Briefing
(Opportunity, `ImageSpec`) → Erstellung (Agenten) → Qualitätsprüfung (Orchestrator-Review, Vision-Gate) → WhatsApp-Inhaltsfreigabe
→ Medienproduktion (nach separater Kostenfreigabe: Runway, Faceless, Replicate; HeyGen/Themen-Pfad) → Veröffentlichungsfreigabe
(`approval-gate`, exakt Content-ID + Version + Fingerprint) → Plattform-Publishing → Ergebnis in `publish_attempts`.

**Statusverteilung:** live verifiziert (laut Doku): Vercel, Postgres, Blob, Cron, WhatsApp, Meta-API, Replicate, Runway (Produkt),
Produkt-Scout/Tavily. Getestet: alle Agenten, Gate, Runtime-Guard, Publisher, HeyGen, Faceless, OpenAI-Bild. Nicht
vollständig verifiziert: Vision-Gate (Migration 034). Deaktiviert: Themen-Pipeline, Themen-Scout. Geplant: Executive-Agent.
**Nachweislich fehlerhaft: nichts belegt.**

### Erkennbare Architekturthemen
1. Preview und Production teilen Ressourcen; der Runtime-Guard sperrt Preview, `NON_PRODUCTION_SANDBOX` darf erst nach
   echter Trennung gesetzt werden (nicht gesetzt).
2. Zwei Orchestratoren (Produkt-/Content-Pfad und Themen-Pfad) teilen Verteilung und Freigabeschranke, aber nicht den
   Einstieg. Das ist gewollt, erhöht aber den Abstimmungsbedarf bei Änderungen am Master Content.
3. Der KI-Modus der Content-Planung und die Vision-Prüfung haben keinen Live-Nachweis.
4. Vorhandene Dokumente bezeichnen `lib/orchestrator.ts` weiter als „Orchestrator“; „Jarvis“ ist im Code nur ein
   Arbeitsname (z. B. in `content/orchestrator.ts`). Das Command Center verwendet ihn als Bezeichner für diesen Orchestrator.

## 5. Multichannel-Publisher: Analyse

Die gemeinsame Infrastruktur existiert und wird nicht dupliziert: `lib/distribution/publish.ts` (`publishAll`, Einmal-Claim,
Status-Abgleich, nie erneut bei unklarem Ergebnis), `platforms/adapters.ts` (Formattransformation, Limits, Link-Policy,
Offenlegung), `publishers/*` (je Plattform), `lib/publishing/approval-gate.ts` (Permit, Re-Check direkt vor dem Aufruf,
Fingerprint, Invalidierung). Es wurde **keine zusätzliche Publishing-Komponente** ergänzt: es fehlte keine, die ohne externe
Zugangsdaten sinnvoll realisierbar wäre.

| Plattform | Adapter / API | Auth | Formate | Tests (Mocks) | Live | Fehlt |
| --- | --- | --- | --- | --- | --- | --- |
| Instagram | `meta.ts`, Graph API v25.0 (Container → Re-Check → `media_publish`), 25 Posts/24 h | System-User-/Page-Token | Bild, Karussell (≤10), Reel; JPEG-Kopie via Blob | ja | Produkt-Pipeline ja (Doku), Themen-Pfad nein | Themen-Variablen `META_PAGE_ID`/`META_INSTAGRAM_USER_ID` im Vercel-Projekt nicht gelistet |
| Facebook | `meta.ts`, Graph v25.0, Page-Endpunkte | Page-/System-User-Token | Text, Foto, Album, Video | ja | Foto (Produkt-Pipeline) ja, Rest nein | Live-Test Text/Album/Video |
| TikTok | `tiktok.ts`, Content Posting API v2 Direct Post, `PULL_FROM_URL`, Status-Poll | Access-Token oder Refresh-Trio | Video, Foto-Slideshow (≤35) | ja | nein | Developer-App, Scope `video.publish`, App-Audit (sonst nur `SELF_ONLY`), verifizierter URL-Präfix der Blob-Domain, Zugangsdaten |
| YouTube Shorts | `youtube.ts`, Data API v3 Resumable Upload, Status-Poll | OAuth Refresh-Token | Video (9:16) | ja | nein | OAuth-Client, Consent-Screen, Scope `youtube.upload`, Refresh-Token; Kontingent ≈1600 Einheiten/Upload; ungeprüfte Apps ggf. nur privat |
| X | `x.ts`, API v2, Media Upload initialize/append/finalize | OAuth 1.0a User Context | Text, ≤4 Bilder, Video; 280 Zeichen (Link = 23) | ja | nein | App mit Schreibrecht (bezahlter Tarif für Posts/Media), 4 Zugangsvariablen |

Rate-Limits/Richtlinien sind je Plattform in der Doku/den Adaptern berücksichtigt (Instagram-Limit, YouTube-Kontingent,
TikTok-Audit, X-Zeichenbudget); sie wurden nicht live geprüft. **HeyGen ist Videoproduktion, keine Plattform** und liegt im
Medien-Cluster.

Sicherheit (unverändert aus PR #63): kein Publish ohne gültige Freigabe, Re-Check vor dem irreversiblen Aufruf, kein erneuter
Versuch bei unklarem Ergebnis, Einmal-Claim je Plattform, Widerruf invalidiert, keine Alternativroute, Link-Policy gegen
unbeabsichtigte Affiliate-Link-Aufrufe.

## 6. Integrationen und fehlende Zugänge (nur Variablennamen, keine Werte)

Maßgeblich bleibt `docs/CREDENTIALS.md`. Ob eine Variable in **Production** gesetzt ist, lässt sich aus dem Repository nicht
belegen; das Command Center zeigt nur den Stand des jeweiligen Deployments (lokal: nichts gesetzt).

| Integration | Implementiert | Tests | Live | Manuell einzurichten |
| --- | --- | --- | --- | --- |
| Meta/Instagram | ja | ja | Produkt-Pfad ja | Themen-Pfad prüfen; Scopes `instagram_content_publish`, `pages_read_engagement` |
| Meta/Facebook | ja | ja | Foto ja | Live-Test der übrigen Formate |
| TikTok | ja | ja | nein | s. 6.1 |
| YouTube | ja | ja | nein | s. 6.2 |
| X | ja | ja | nein | s. 6.3 |
| HeyGen | ja | ja | nein | s. 6.4 (Key, Avatar, Stimme, Monatslimit) |
| Replicate | ja | ja | ja (Produkt) | Themen-Bilder und Modell live testen |
| OpenAI (Bild-Fallback) | ja | ja | nein | optional |
| Tavily | ja | ja | ja (Produkt) | News-Modus live testen |
| Google News/Trends, Wikimedia | ja | ja | nein | Erreichbarkeit/Format live prüfen |

**Credentials-Trennung:** lokale, Preview- und Production-Werte getrennt halten. Preview darf keine Production-Secrets
erben (siehe `PREVIEW_ISOLATION.md`); `NON_PRODUCTION_SANDBOX` bleibt ungesetzt, bis eigene DB, Blob, Meta-/WhatsApp-Testassets
nachgewiesen sind.

### 6.1 TikTok (Dashboard-Schritte)
1. developers.tiktok.com: App anlegen, Produkt *Content Posting API* hinzufügen, Scope `video.publish` beantragen.
2. Domain/URL-Präfix der Blob-Medien verifizieren lassen (für `PULL_FROM_URL`).
3. Für das Posting-Konto OAuth durchführen; Refresh-Token sichern. Variablen: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
   `TIKTOK_REFRESH_TOKEN` (oder `TIKTOK_ACCESS_TOKEN`). Bis zum App-Audit bleibt `TIKTOK_PRIVACY_LEVEL=SELF_ONLY`.
4. Erst in einer Test-Umgebung mit `TOPIC_PLATFORMS=tiktok` einen privaten Beitrag prüfen.

### 6.2 YouTube
1. Google Cloud: Projekt, *YouTube Data API v3* aktivieren, OAuth-Zustimmungsbildschirm, OAuth-Client (Web/Desktop).
2. Einmalig Scope `https://www.googleapis.com/auth/youtube.upload` autorisieren (offline access) → Refresh-Token.
3. Variablen: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`; `YOUTUBE_PRIVACY_STATUS=private` zum Test.
4. Kontingent beachten; ungeprüfte Projekte laden ggf. nur privat hoch (Audit beantragen).

### 6.3 X
1. developer.x.com: Projekt/App, Berechtigung *Read and write*, passender (bezahlter) Zugang für Posts und Media-Upload.
2. Variablen: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (Token **nach** Rechteänderung neu erzeugen).

### 6.4 HeyGen
1. Account/Plan, API-Key; Avatar und Stimme auswählen. Variablen: `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`,
   `HEYGEN_MONTHLY_VIDEO_LIMIT` (ohne Limit wird absichtlich kein Avatar-Video erzeugt). Erster Test mit einem Video und Kostenfreigabe.

Alle Schritte nur durch den Betreiber in den jeweiligen Dashboards; Werte nie in Chat, Repo oder Logs.

## 7. Themen-Pipeline: Vorbereitung (nicht aktiviert)

Stand: implementiert, gemergt, deaktiviert. `TOPIC_PIPELINE_ENABLED`, `TOPIC_LIVE_PUBLISHING`, `TOPIC_PLATFORMS` sind nicht gesetzt,
`/api/cron/topic-scout` steht nicht in `vercel.json` (Test `topic-cron.test.cjs`). Voraussetzungen vor einer Aktivierung:

1. Preview-Isolation umsetzen (eigene Neon-Branch-DB, eigener Blob, Test-Meta/WhatsApp); danach erst Sandbox-Flag.
2. Migration 034 über den geschützten Endpunkt in der Ziel-Umgebung ausführen und prüfen (`scripts/check-migration-status.cjs`).
3. Vision live prüfen (`scripts/vision-smoke-test.cjs`, `IMAGE_QUALITY_VERIFICATION.md`). Hinweis: Das Vision-Gate nutzt das
   Replicate-Routermodell; ohne Live-Test bleibt es „nicht vollständig verifiziert“.
4. Eine Plattform privat live testen, dann Trockenlauf, dann Live-Schalter, zuletzt Cron (Reihenfolge laut `TOPIC_PIPELINE_ACTIVATION.md`).
PR #61 ist im Repository nicht als eigene Abhängigkeit erkennbar; die Bild-Qualitätsarbeit steht in Commit `72cc3ab` (#62).

## 8. Inbetriebnahmeplan (gemeinsame Arbeit)

| Wer | Aufgabe |
| --- | --- |
| Claude Code (eigenständig) | Review/Merge-Vorbereitung dieses PR; Preview-Isolationsskripte/Checkliste; Tests für weitere Plattformvarianten; Vision-Smoke-Skript trockenlaufen lassen (ohne Kosten, nur Planung) |
| Betreiber in Dashboards | Neon-Branch/Preview-Blob/Test-Meta anlegen; TikTok-/YouTube-/X-/HeyGen-Zugänge nach Abschnitt 6; Variablen nur im Preview-Target setzen |
| Zusätzliche Berechtigungen nötig | Vercel-Env-Lesezugriff zur Verifikation (derzeit nicht verfügbar); Test-WhatsApp-Empfänger; Plattform-Audits |
| Tests vor Rollout | Migration 034 + Vision live; eine Plattform privat (`SELF_ONLY`/`private`/unlisted); Trockenlauf mit WhatsApp-Status; erster Live-Beitrag mit ausdrücklichem „Freigeben“; Rollback = Schalter `TOPIC_LIVE_PUBLISHING` entfernen |

## 9. Bekannte Einschränkungen

- Das Modell ist statisch und muss bei Architekturänderungen gepflegt werden (Test fängt tote Pfade, nicht veraltete Statusangaben).
- Statusangaben „live verifiziert“ stützen sich auf Dokumentation, nicht auf neue Messung.
- Kein Live-Aktivitätsfeed (bewusst: erst mit verifizierten Laufzeitdaten).
- Rendering in Headless-Chromium (SwiftShader) geprüft; echte GPU-Geräte/Safari nicht getestet.

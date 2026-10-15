# Projektstatus – Affiliate Content Studio

> Pflichtlektüre zu Sitzungsbeginn (zusammen mit `CLAUDE.md`). Nach jeder abgeschlossenen Phase aktualisieren und versionieren.
> Begriffe strikt getrennt: **implementiert** (Code auf Branch) · **getestet** (automatisierte Offline-Tests) · **gemergt** (in `main`)
> · **deployed** (im READY-Production-Deployment) · **aktiviert** (Schalter/Zugänge in Production gesetzt) · **live verifiziert** (echter Production-Aufruf beobachtet).

Stand: **2026-10-15**, Claude-Code-Cloud-Sitzung, Branch `claude/clever-cori-b73qxg`, PR [#72](https://github.com/agentstudiots-boop/affiliate-reel-agent/pull/72).

## 1. Verifizierter Ausgangszustand dieser Sitzung (vor allen Änderungen)

| Punkt | Befund (verifiziert) |
|---|---|
| `main` | `37ac084` (Merge PR #70) |
| Production-Deployment | `dpl_8PffN13AnoQqqk8yEPMbp3mGDeu2`, READY, Commit `37ac084` (Vercel-API) |
| Offene PRs | #71 (Codex-Audit, CI grün, Preview READY), #65 (überholt), #61 (CI rot, verletzt Importregel), #10 (Migrationskonflikt) |
| Tests | 614 Tests grün |
| `CLAUDE.md`, `docs/PROJECT_STATUS.md` | fehlten → angelegt |
| Production-Env (nur Namen, keine Werte) | vorhanden: `CONTENT_STUDIO_PASSWORD`, `CRON_SECRET`, DB/Blob, WhatsApp (`WHATTSAPP_*`-Schreibweise), Meta-System-User, Replicate, Tavily, Runway (+Budget), Faceless, YouTube (3 OAuth-Variablen), `HEYGEN_API_KEY` (seit 14.10.), `WHATSAPP_DAILY_TEMPLATE_*` (Vorlage `content_entwurf`, `ENABLED=false`). **Fehlend:** `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `HEYGEN_MONTHLY_VIDEO_LIMIT`, `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`, alle Pinterest-/TikTok-/X-Zugänge, `ADMIN_SESSION_SECRET` (optional) |

## 2. Was in dieser Sitzung passiert ist

| # | Arbeitspaket | implementiert | getestet | gemergt | deployed | live verifiziert |
|---|---|---|---|---|---|---|
| 1 | Admin-Login, `proxy.ts`, Logout (P0/P3) | ✓ | ✓ (+ lokaler E2E gegen `next start`) | ✗ (PR #72 offen) | ✗ | ✗ |
| 2 | WhatsApp-Bildstopps/Aufträge (P1) | ✓ | ✓ Regressionstests | ✗ (PR #72) | ✗ | ✗ |
| 3 | Router: freier Bildwunsch bei angehaltenem Bildauftrag (P1) | ✓ | ✓ | ✗ (PR #72) | ✗ | ✗ |
| 4 | Modellaufruf-Protokoll `model_calls` + Übersicht im Tageslauf-Panel (P7), Migration 037 (additiv) | ✓ | ✓ | ✗ (PR #72) | ✗ | ✗ |
| 5 | `CLAUDE.md` + dieses Dokument | ✓ | – | ✗ (PR #72) | – | – |
| 6 | **PR #71 (Codex) gemergt** → `main` = `0e0f9b8` (Next.js 16.3.8-Sicherheitspatch, atomarer Videobudget-Schutz, YouTube-Status ehrlich, Pinterest-Adapter standardmäßig aus, Command-Center-Evidenz) | (Codex) | ✓ lokal zusammen mit #72: 640/640, Typecheck, Lint 0, Build, `npm audit --omit=dev` 0 | ✓ 15.10. 17:40 UTC | **nicht von mir geprüft** (siehe 5.) | ✗ |

### Details WP1 – Admin-Zugang
- `/login` → `POST /api/auth/login` (konstante Zeit, Fehlversuchsbremse pro Instanz, 400 ms Verzögerung) → Cookie `acs_admin_session`
  (HttpOnly, SameSite=Strict, Secure, 12 h, HMAC-signiert; Schlüssel aus `CONTENT_STUDIO_PASSWORD` + optional `ADMIN_SESSION_SECRET`).
- `POST /api/auth/logout`, `GET /api/auth/session`. Rotation des Zugangscodes beendet alle Sitzungen (stateless Token).
- `proxy.ts`/`lib/security/access-policy.ts`: interne Seiten → `/login`, interne APIs → 401. Öffentlich: `/login`, `/produkte*`,
  `/impressum`, `/datenschutz`, WhatsApp-Webhook (Signatur), `/api/cron/*` (CRON_SECRET), `/api/landing/click`, `/api/auth/*`.
  OAuth-Callback-Routen gibt es im Repo nicht (YouTube nutzt Refresh-Token).
- `authorized()`: Cookie (state-ändernd nur same-origin) oder `x-content-password` (Skripte). Abgesichert: `GET /api/content`, `GET /api/admin/migrate`.
- Frontend ohne Zugangscode; „Abmelden“-Button. Datenschutzerklärung präzisiert (**Betreiber gegenlesen**).
- E2E lokal (`next start`, Test-Code): alle 7 geforderten Prüfungen bestanden (anonym verweigert, Login ok, APIs geschützt inkl. CSRF,
  Logout beendet Zugriff, Webhook 403/Challenge/401, Cron 401, Code nie im HTML).

### Details WP2/WP3 – WhatsApp
1. Bildstopp-Antworten nur für die neueste Notice, dieselbe Content-Fassung und bei gültiger Inhaltsfreigabe.
2. „Mach es trotzdem“/„passt so“ auf eine Bildnachricht → Rückfrage; ohne Zitat bei freigegebenem/bildgestopptem Auftrag → Rückfrage statt Neuentwurf.
3. Kein neuer Entwurf für freigegebene/in Veröffentlichung befindliche Aufträge; Dublette verschiebt den aktiven Kontext nicht.
4. `overrideClass()`: gestalterische Mängel und unsichere Prüfung übersteuerbar („Bild trotzdem senden“), harte Prüfregeln nie.
5. Router: freier Bildwunsch bei angehaltenem Bildauftrag → Hinweis auf die Bildnachricht (statt „nichts offen“).
6. Protokoll `image:*` in `whatsapp_context_log`. `approval-gate.ts` unverändert; Bildentscheidung ≠ Veröffentlichungsfreigabe.

### Details WP4 – Modellkosten (P7)
- Tabelle `model_calls` (Migration 037, additiv; wird automatisch angewendet). Erfasst je Aufruf: Agent, Modell, Anbieter, Erfolg/Fehlerklasse,
  Latenz, Replicate-Prediction-ID, Input-/Output-Tokens, Rechenzeit. Keine Prompts/Ausgaben/Secrets. Ausfall des Protokolls bricht nie den Aufruf.
- Angebunden: WhatsApp-Router, Themen-Router, Vision-Qualitätsprüfung, WhatsApp-Chat, Anweisungsparser, Transkription, Content-KI-Modus (je Agent `content_<agent>`).
- Übersicht 7 Tage im Studio-Panel „Tageslauf & Ergebnisse“ (`/api/operations` → `modelUsage`). Keine erfundenen Euro-Beträge.

## 2b. Nachtrag 15.10. abends

| Schritt | Nachweis |
|---|---|
| PR #72 gemergt | `main` = `dc4dc7f` (nach vollständiger Prüfung: npm ci, typecheck, lint, 643/643, build, audit 0, CI grün; Merge auf ausdrückliche Betreiberanweisung) |
| Production-Deployment #72 | `dpl_3QFYMTtg2Pj4BGd8gJtLjhz3ZJ1K` READY, Commit `dc4dc7f` = `main` |
| Live geprüft (Vercel-Fetch) | `/` → Anmeldeseite (`x-matched-path: /login`); `/produkte` 200 öffentlich; `/api/architecture` ohne Sitzung 401 |
| Production-Deployment #71 | `dpl_5RXUrKsywePrBsC1GiUZd2cZ6FZ2` READY, Commit `0e0f9b8` |
| Command Center zugänglich (PR folgt) | Ursache: es gab keine Seite `/architecture`, nur einen Dialog tief im Studio. Neu: eigene geschützte Seite, Link oben im Studio, Ansicht „Steckbriefe“ (Funktion, Eingänge, Ausgänge, KI-Modell, Status, zuletzt erfolgreich aus DB) |

## 3. Status je Bereich

| Bereich | Status (Stand Ende Sitzung) |
|---|---|
| Privater Admin-Zugang | PR #72 offen. Production (`main`): Seiten öffentlich erreichbar, interne APIs nur mit Zugangscode-Header (401 ohne) |
| Command Center | deployed; #71 trennt Konfiguration/Erreichbarkeit/Funktion. Nach #72 per Session erreichbar. Inhalt mit echten Daten nicht durch Agent geprüft (kein Zugangscode verfügbar) |
| WhatsApp-Freigaben | deployed + live genutzt (laut Audits); Fixes in #72 |
| WhatsApp-Servicefenster | Vorlage `content_entwurf` vorhanden, **aus** (Betreiberentscheidung). Ohne Vorlage: Tagesfreigabe nur, wenn der Betreiber in den letzten 24 h geschrieben hat; sonst `template_required`, Nachholung bei nächster Betreiber-Nachricht |
| Trendscout / Trend-Agent | deployed, aktiv, live beobachtet (Recherche 13.10.); Amazon-Auflösung oft ohne verwertbare Produktseite |
| Trendsetter | deployed, aus (`TRENDSETTER_AFFILIATE`) |
| Themen-Pipeline | deployed, aus (`TOPIC_PIPELINE_ENABLED`, `TOPIC_LIVE_PUBLISHING`), kein Cron für `/api/cron/topic-scout` → blockiert Trendscout nicht |
| HeyGen | implementiert/getestet (v2 generate, 720×1280 = 9:16, passt für IG-/FB-Reels und Shorts). **Blockiert**: `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID` (deutsche Stimme), `HEYGEN_MONTHLY_VIDEO_LIMIT` fehlen. Avatar-Eignung (Natürlichkeit, Deutsch, Markenwirkung) nicht prüfbar ohne Kontozugriff; kein bezahlter Test |
| Instagram | Affiliate-Feedbild und Reels (`media_type=REELS`) implementiert; Affiliate-Reel mit `share_to_feed=false` (nur Reels-Tab – Betreiber prüfen, ob gewollt), Themen-Reel `true`. Themenpfad ohne `META_PAGE_ID`/`META_INSTAGRAM_USER_ID` blockiert |
| Facebook | Affiliate-Fotopost aktiv; Themenpfad (Text/Bild/Album/Video) ohne `META_PAGE_ID` blockiert |
| YouTube | implementiert, Dry-Run; Status jetzt nur bei `privacyStatus=public` „veröffentlicht“ (#71). Refresh-Token im OAuth-Testmodus läuft ca. **17.10.** ab |
| Pinterest | Adapter (API v5) seit #71 in `main`, standardmäßig aus; keine Zugänge, kein Token-Speicher |
| TikTok / X | implementiert, blockiert (App-Audit / Tarif) |
| Cron-Jobs | 6 Tages-Slots (07/08/09/16/17/18 UTC → Berlin-Slots), Wochenbericht Mo 08:15 UTC; Claims je (Tag, Slot); Nachweise `daily_slot_runs` |
| Agentenkommunikation | Orchestrator-zentriert; Importisolation getestet; Fehlerzustände `needs_input`/`failed`/`deferred_retry_pending` |
| Kostenüberwachung | Bildversuche (Budget + Kosten je Versuch), Runway-Monatsbudget atomar (#71), HeyGen-Monatslimit; LLM-Aufrufe ab #72 in `model_calls` |

## 4. Offene Probleme

1. **PR #72 reviewen und mergen** (Betreiber). Danach Production prüfen: `/` → 307 `/login`; Login mit bestehendem Zugangscode; Studio lädt;
   `/api/operations` mit Sitzung 200; Abmelden; `/produkte` 200; Webhook-GET ohne Token 403; Cron ohne Secret 401; nächster Cron-Slot läuft.
2. Production-Deployment von `0e0f9b8` (#71) prüfen (Vercel: READY, Commit `0e0f9b8`; Startseite 200; nächster Cron-Lauf in `daily_slot_runs`).
3. Freie Bildformulierungen ohne Zitat werden nur für „Mach es trotzdem“ (Auftrag) und Bild-Änderungswünsche (Router) erkannt; andere Formulierungen gehen den normalen Weg.
4. Fehlversuchsbremse beim Login nur pro Serverinstanz → starken Zugangscode verwenden; optional Vercel-Firewall-Regel für `/api/auth/login`.
5. PR #61 (Reel Intelligence) verletzt Importregel; PR #10 Migrationsnummer kollidiert; PR #65 überholt (schließen).
6. Kein Modellvergleich durchgeführt (kostenpflichtig, Freigabe nötig). Testsammlung: siehe 7.

## 5. Externe Blocker / notwendige Betreiberentscheidungen

| Thema | Benötigt |
|---|---|
| Merge PR #72 | Review/Freigabe durch Betreiber (die Sitzung hat nach dem Merge von #71 bewusst keine weiteren Merges durchgeführt) |
| Production-Prüfung | Aus dieser Cloud-Umgebung ist `*.vercel.app` per Netzwerkrichtlinie nicht erreichbar; Vercel-Deploymentabfrage nach dem Merge blockiert |
| WhatsApp-Vorlage für proaktive Tagesfreigaben | Betreiber: `WHATSAPP_DAILY_TEMPLATE_ENABLED=true` (Kosten je Vorlagennachricht) – sonst nur im 24-h-Fenster |
| HeyGen | Betreiber: Avatar- und Stimmen-ID (deutsch) wählen, Monatslimit setzen, Ausgabenlimit beim Anbieter; ein bezahlter Testclip nur nach Freigabe |
| YouTube | Google-Zustimmungsseite auf „In Produktion“ oder Token vor 17.10. erneuern; API-Audit für öffentliche Uploads |
| Meta Themenpfad | `META_PAGE_ID`, `META_INSTAGRAM_USER_ID` setzen |
| Pinterest | App, Board-ID, Access-Token (+ sicherer Token-Speicher) |
| Modellvergleich (GPT-4.1 / GPT-5.6 Terra / Claude Sonnet 5.5) | Kostenfreigabe; erst mit `model_calls`-Daten (Fehlerquote/Latenz je Agent) begründen |

## 6. Kritische Risiken

- Bis #72 gemergt ist: Studio-/Command-Center-Seiten öffentlich ladbar (Daten aber nur mit Zugangscode).
- Tagesfreigaben hängen am 24-h-Fenster, solange die Vorlage aus ist.
- Preview-Isolation laut #71 nur teilweise (26 Variablen ohne Preview-Ziel; separat angelegte Preview-Zugänge bestehen weiter).

## 7. Nächste Entwicklungsschritte (priorisiert)

1. #72 mergen, Production-Login verifizieren (Checkliste 4.1).
2. Eine Woche `model_calls` sammeln → Fehlerquote/Latenz je Agent auswerten; erst dann über Modellwechsel entscheiden (Testsammlung: 10 echte, anonymisierte Betreiber-Nachrichten + 5 Produktentwürfe, Bewertung nach Manifest).
3. Router-Kontext um „angehaltene Bildaufträge“ als offenen Punkt erweitern (statt Einzelfall-Prüfung).
4. HeyGen-Konfiguration nach Betreiberentscheidung; Avatar über kostenlose `GET /v2/avatars`, `GET /v2/voices` vom Betreiberrechner prüfen.
5. Themen-Pipeline nur nach `docs/GO_LIVE_RUNBOOK.md` aktivieren.

## 8. Übergabe an die nächste Sitzung

- Zuerst: Status von PR #72 prüfen (`mcp__github__pull_request_read`), dann Production-Deployment und die Checkliste 4.1.
- Branch `claude/clever-cori-b73qxg` enthält `main` (`0e0f9b8`) + alle Änderungen dieser Sitzung; nach Merge von #72 neu von `main` abzweigen.
- Tests: `npm test` (~10 min, 640+ Tests), `npm run typecheck`, `npm run lint`, `npm run build`. CI (`.github/workflows/quality.yml`, Node 24) führt zusätzlich `npm audit --omit=dev` aus.
- Keine Secrets geändert, keine Live-Posts, keine kostenpflichtigen Aufrufe in dieser Sitzung.

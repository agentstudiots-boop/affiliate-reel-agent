# Projektstatus – Affiliate Content Studio

> Pflichtlektüre zu Sitzungsbeginn (zusammen mit `CLAUDE.md`). Nach jeder abgeschlossenen Phase aktualisieren und versionieren.
> Begriffe strikt getrennt: **implementiert** (Code auf Branch) · **getestet** (automatisierte Offline-Tests) · **gemergt** (in `main`)
> · **deployed** (im READY-Production-Deployment) · **aktiviert** (Schalter/Zugänge in Production gesetzt) · **live verifiziert** (echter Production-Aufruf beobachtet).

Stand: **2026-10-15** (Claude-Code-Cloud-Sitzung, Branch `claude/clever-cori-b73qxg`).

## 1. Verifizierter Ausgangszustand dieser Sitzung

| Punkt | Befund (verifiziert) |
|---|---|
| `main` | `37ac084` (Merge PR #70), identisch mit `origin/main` |
| Production-Deployment | `dpl_8PffN13AnoQqqk8yEPMbp3mGDeu2`, READY, Commit `37ac084` (Vercel-API) |
| Arbeitsbranch | `claude/clever-cori-b73qxg` = `main`, sauber |
| Offene PRs | #71 (Codex-Audit: Next.js-Sicherheitspatch 16.3.8, Videobudget atomar, Pinterest-Adapter aus, ehrliche Statusanzeigen; CI grün, Preview READY), #65 (überholt), #61 (CI rot, Importregel verletzt), #10 (Migrationskonflikt) |
| Tests Ausgangsstand | 614 Tests, alle grün (der einzige Fehlschlag im Lauf entstand durch das in dieser Sitzung neu angelegte `proxy.ts`, Test angepasst) |
| `CLAUDE.md`, `docs/PROJECT_STATUS.md` | fehlten → in dieser Sitzung angelegt |
| Production-Env (nur Namen) | `CONTENT_STUDIO_PASSWORD`, `CRON_SECRET`, DB-/Blob-/WhatsApp-/Meta-/Replicate-/Tavily-/Runway-/Faceless-/YouTube-Zugänge vorhanden; `HEYGEN_API_KEY` seit 14.10. vorhanden, `HEYGEN_AVATAR_ID`/`HEYGEN_VOICE_ID`/`HEYGEN_MONTHLY_VIDEO_LIMIT` fehlen; `META_PAGE_ID`/`META_INSTAGRAM_USER_ID` fehlen; keine Pinterest-, TikTok-, X-Zugänge; `WHATSAPP_DAILY_TEMPLATE_ENABLED=false` |

## 2. Arbeit dieser Sitzung

### WP1 – Privater Admin-Zugang (P0/P3) — implementiert, getestet, **nicht gemergt**
- `/login` (Formular ohne JS) → `POST /api/auth/login` → signiertes Session-Cookie `acs_admin_session` (HttpOnly, SameSite=Strict, Secure, 12 h).
  Schlüssel aus `CONTENT_STUDIO_PASSWORD` (+ optional `ADMIN_SESSION_SECRET`); Rotation beendet alle Sitzungen. Fehlversuchsbremse (pro Instanz) + Verzögerung.
- `POST /api/auth/logout` (Cookie gelöscht), `GET /api/auth/session`.
- `proxy.ts` + `lib/security/access-policy.ts`: interne Seiten → Redirect `/login`; interne APIs ohne Session/Code → 401.
  Öffentlich: `/login`, `/produkte*`, `/impressum`, `/datenschutz`, WhatsApp-Webhook (Signatur), `/api/cron/*` (CRON_SECRET), `/api/landing/click`, `/api/auth/*`.
- `authorized()` akzeptiert Session-Cookie (state-ändernd nur same-origin, CSRF-Schutz) oder `x-content-password` (Skripte).
- Abgesichert, vorher öffentlich: `GET /api/content` (Konfigurationsinfo), `GET /api/admin/migrate` (Infoseite).
- Frontend hält den Zugangscode nicht mehr; Passwortfeld durch „Abmelden“ ersetzt; alle Fetches nutzen das Cookie.
- Datenschutzerklärung präzisiert: öffentliche Seiten ohne Cookies, nur Betreiberbereich mit technisch notwendigem Sitzungs-Cookie (**Betreiber bitte prüfen**).
- Tests: `tests/admin-session.test.cjs` (Token, Cookie-Attribute, CSRF, Open-Redirect, Pfadrichtlinie inkl. Inventar aller öffentlichen API-Routen, Login/Logout-Routen).

### WP2 – WhatsApp-Bildstopps und Aufträge (P1) — implementiert, getestet, **nicht gemergt**
Behobene Fehler (Regressionstests `tests/whatsapp-image-stop-regression.test.cjs`):
1. **Bildstopp ↔ Auftrag/Version:** Antworten gelten nur für die neueste Notice des Jobs, für dieselbe Content-Fassung (Hash des Versuchs) und solange die Inhaltsfreigabe besteht. Sonst Hinweis, nichts gestartet, kein bezahlter Versuch.
2. **„Mach es trotzdem“ & Co.:** als Antwort auf eine Bildnachricht → Rückfrage (exakter Befehl nötig); ohne Zitat bei freigegebenem/bildgestopptem Auftrag → Rückfrage „Meinst du den angehaltenen Bildauftrag?“ statt neuem Entwurf.
3. **Überschreiben:** ein Folgebefehl legt für einen inhaltlich freigegebenen, bildgestoppten, in Veröffentlichung befindlichen Auftrag keinen neuen Entwurf an; eine abgewiesene Dublette (`product_already_open`) zeigt den aktiven Auftrag nicht mehr auf den leeren Platzhalter-Job um (Kontextverlust behoben).
4. **Gestalterisch vs. hart:** `overrideClass()` – „Bild trotzdem senden“ bei unsicherer Prüfung **oder** rein gestalterischen Mängeln; nie bei harten Prüfregeln (falsches/fehlendes Produkt, ausgeschlossene Motive, Logo/Schrift, schwere Bildfehler, unrealistische Nutzung, technisch defekt). Stopp-Nachricht nennt die passende Option bzw. „nicht übersteuerbar“.
5. **Protokoll:** jede Bildentscheidung als `image:*` in `whatsapp_context_log` + Log-Event `image_quality_decision`.
6. Eine Bildfreigabe bleibt nie eine Veröffentlichungsfreigabe (Test: keine `publication_requests`/`publications`). `approval-gate.ts` unverändert.
Keine Migration nötig (Bindung über vorhandene `image_generation_attempts.content_hash`).

### WP3 – Projektgedächtnis — `CLAUDE.md` und dieses Dokument angelegt.

## 3. Status je Bereich (nach dieser Sitzung)

| Bereich | Status |
|---|---|
| Privater Admin-Zugang | implementiert + getestet (Branch); Production: bisher nur Zugangscode-Header, Seiten öffentlich erreichbar (APIs 401) |
| Command Center | deployed (nur lesend, Zugangscode); mit Login künftig per Session; Inhalt mit echten Daten weiterhin nicht durch Agent geprüft |
| WhatsApp-Freigaben | deployed + live genutzt; Bildstopp-/Auftragsfehler auf Branch behoben |
| WhatsApp-Servicefenster | Vorlage `content_entwurf` vorhanden, per Betreiberentscheidung aus → Tagesfreigaben nur, wenn der Betreiber innerhalb von 24 h geschrieben hat |
| Trendscout / Trend-Agent | deployed, aktiv, live beobachtet (Recherche); Produktauflösung bei Amazon häufig ohne Treffer |
| Trendsetter | deployed, aus (`TRENDSETTER_AFFILIATE`) |
| Themen-Pipeline | deployed, aus (`TOPIC_PIPELINE_ENABLED`), kein Cron in `vercel.json` |
| HeyGen | implementiert/getestet (720×1280); **blockiert**: Avatar-ID, Stimmen-ID, Monatslimit fehlen; kein Live-Test (kostenpflichtig) |
| Instagram | Affiliate-Bild (Feed) + Reels (`media_type=REELS`) implementiert; Affiliate-Pfad aktiv; Themenpfad ohne `META_PAGE_ID`/`META_INSTAGRAM_USER_ID` blockiert |
| Facebook | Affiliate-Fotopost aktiv; Themenpfad (Text/Bild/Album/Video) ohne `META_PAGE_ID` blockiert |
| YouTube | implementiert, nur Dry-Run; Refresh-Token im OAuth-Testmodus läuft ca. 17.10. ab |
| Pinterest | in `main` nicht vorhanden; Adapter in PR #71 (standardmäßig aus, keine Zugänge) |
| Cron-Jobs | 6 Tages-Slots + Wochenbericht aktiv, Nachweise in `daily_slot_runs` |
| Agentenkommunikation | Orchestrator-zentriert, Importisolation getestet |
| Kostenüberwachung | Bildversuche mit Kostenschätzung je Versuch, Runway-Monatsbudget, HeyGen-Monatslimit; **keine** Token-/Kostenerfassung der LLM-Aufrufe |

## 4. Bekannte Fehler / offene Aufgaben

1. PR #71 (Next.js-Sicherheitspatch!) prüfen und integrieren; danach diesen Branch mit `main` zusammenführen.
2. Login in Production verifizieren (nach Merge): `/` → Redirect `/login`, Login mit Zugangscode, APIs, Logout, Webhook-GET 403, Cron 401.
3. Freie Bildwünsche ohne Zitat außer „Mach es trotzdem“ (z. B. „Schick das Bild trotzdem“) laufen über den semantischen Router, der Bildstopps noch nicht als offenen Punkt kennt.
4. LLM-Kosten/Token je Agent werden nicht erfasst (P7).
5. Preview-Isolation (siehe Codex-Audit #71: Preview-Ziel bei 26 Variablen entfernt).
6. YouTube-Token-Ablauf, `META_PAGE_ID`, HeyGen-Konfiguration (Betreiber).

## 5. Kritische Risiken

- Next.js 16.3.5 in Production mit bekannten Sicherheitslücken, bis PR #71 gemergt ist.
- Tagesfreigaben hängen am 24-h-Fenster, solange die WhatsApp-Vorlage aus ist.
- Preview und Production teilten Zugänge (laut #71 inzwischen reduziert).

## 6. Übergabe an die nächste Sitzung

Siehe Abschnitt „Übergabe“ am Ende dieser Datei (wird zum Sitzungsende aktualisiert).

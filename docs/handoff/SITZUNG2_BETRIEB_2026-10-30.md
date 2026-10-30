# Übergabe Sitzung 2 – Betriebsbereitschaft: Konfiguration, Anbieter, Betriebsansicht (30.10.2026)

Auftrag des Betreibers vom 30.10.2026 („Content Studio betriebsbereit machen“). Zuständigkeit laut Absprache mit Sitzung 1:
- **Sitzung 2:** Anbieter- und Konfigurationsdiagnose, Betriebsansicht im Command Center (`lib/architecture`, `app/architecture`, `app/api/architecture`).
- **Sitzung 1:** Content-Qualität, Post-Abnahme, Integration, Statusdateien, Merge-Reihenfolge.

Begriffe wie in `docs/PROJECT_STATUS.md`: konfiguriert (Variable vorhanden) ≠ erreichbar (Anbieter antwortet) ≠ ausgeführt (echter Lauf in der DB belegt).

## 1. Ausgangslage, frisch geprüft

- **`origin/main`:** `48d4137` (PR #143). Production-Deployment `dpl_86Be7XWk2jaR2J4rV15Vcs1pa5fC` READY, ohne Laufzeitfehler (2 h, 29.10.).
- **Laufzeitlogs:** Im Fenster 18:23–19:18 UTC am 30.10. gab es keine Logzeilen. Hobby-Plan, 1 h Aufbewahrung.
- **Datenbank:** Diese Sitzung hat keinen direkten Zugriff. `/api/operations` und `/api/architecture` verlangen die Admin-Session. Alle DB-Nachweise liefert deshalb ab diesem PR die Betriebsansicht unter `/architecture` (Login nötig).

**Widerspruch in der Doku:** `docs/PROJECT_STATUS.md` §1 führt `EXECUTIVE_ENABLED`, `EXECUTIVE_WHATSAPP` und `EXECUTIVE_WEEKLY_REPORT` als „fehlend (= aus)“. Das stimmt für die **Umgebungsvariablen**, aber seit #137/#138/#141 schalten die Rollout-Werte in `lib/config/rollout.ts` diese Funktionen ein (§2b). Die Korrektur in §1 macht Sitzung 1, weil sie die Statusdateien führt.
- **Executive-WhatsApp:** Laut Betreiber kam eine echte Antwort mit Prioritäten. Diese Sitzung hat dafür keinen eigenen Log- oder DB-Beleg.
- **Montagsbericht:** noch nicht live nachgewiesen.

## 2. Production-Variablen (nur Namen, 30.10. abends, Vercel-API ohne Entschlüsselung)

| Bereich | vorhanden | fehlt |
|---|---|---|
| Runway | `RUNWAYML_API_SECRET` (Production + Development, **nicht** Preview), `RUNWAY_MONTHLY_BUDGET_CREDITS` (alle drei Umgebungen) | `TOPIC_STANDARD_VIDEO_PROVIDER`, `TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT` |
| HeyGen | `HEYGEN_API_KEY` (Production) | `HEYGEN_ENABLED`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `HEYGEN_MONTHLY_VIDEO_LIMIT` |
| Meta (Themenweg) | `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET` | `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`, `TOPIC_LIVE_PUBLISHING`, `TOPIC_PLATFORMS` |
| Themen-Pipeline | `TOPIC_PIPELINE_ENABLED`, `TOPIC_DAILY_VIDEO`, `TOPIC_COPY_MODE` (Werte nicht gelesen) | – |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | – (Refresh-Token laut Doku vermutlich seit ca. 17.10. abgelaufen, OAuth-Testmodus) |
| WhatsApp | Zugang, Telefonnummer, Verify-Token, Freigabenummer; Tagesvorlage `content_entwurf` mit `ENABLED=false` | Wochenvorlage (`WHATSAPP_WEEKLY_REPORT_TEMPLATE_*`) |
| Executive/Controlling | – (Rollout-Werte im Repo) | `OPPORTUNITY_SCOUT_ENABLED` (bleibt aus, Q-07) |

**Preview:** Dort sind u. a. `WHATSAPP_ACCESS_TOKEN`, `META_SYSTEM_USER_TOKEN`, `REPLICATE_API_TOKEN`, `TAVILY_API_KEY`, `RUNWAY_MONTHLY_BUDGET_CREDITS` und `CONTENT_STUDIO_PASSWORD` gesetzt. Wirkungen sperrt `lib/security/runtime-guard.ts`. Für Preview-Tests deshalb nichts Wirkendes verwenden.

## 3. Befunde je Anbieter (getrennt nach Ursache)

### Runway (erster Kandidat für die Videoabnahme)

- **Code:** `lib/runway.ts`, `lib/visual/providers/runway-video.ts`.
  - Text-zu-Video mit Modell `wan3`, 30 s, `720:1280`, `audio: true`, SDK `@runwayml/sdk` 4.20.0, API-Version `2024-11-06` (SDK-Standard), `maxRetries: 0`.
  - Das installierte SDK führt `wan3` mit genau diesem Seitenverhältnis und freier Dauer. Eine Versionsmigration ist laut SDK-Typen **nicht nötig**.
- **Offizielle Doku nicht abrufbar:** Diese Sitzung erreicht `docs.dev.runwayml.com` nicht (Netzwerkfreigabe fehlt). Ob 30 s für `wan3` zulässig sind, steht in den SDK-Typen nicht. Das prüft erst der erste echte Auftrag (Fehler 400 = `invalid_request`, wird klar gemeldet).
- **Kosten:** Code-Annahme 10 Credits/s, also 300 Credits je Clip (Kommentar: „Runway Dev pricing, September 2026“, unbestätigt). Projekt-Schätzung ≈ 3 USD je Clip.
- **Ursache, dass kein Themenvideo entsteht:** fehlende **Konfiguration** (`TOPIC_STANDARD_VIDEO_PROVIDER=runway`, `TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT`). Kein Codefehler belegt, kein Zugangsfehler belegt.
- **Nicht belegt:** ob der Schlüssel gültig ist und ob Guthaben vorhanden ist. Das zeigt erst ein Aufruf, und der kostet. Ein lesender Kontostand-Aufruf ist im Code nicht vorhanden.

### HeyGen (separat vorbereiten)

- **Code:** Der Provider nutzt API **v2** (`POST /v2/video/generate`, Status `/v1/video_status.get`, 720 × 1280). Laut Projekt-Doku vom 18.10. (`docs/HEYGEN_MIA_PRODUCT_VIDEOS.md`) beschreibt HeyGen inzwischen **v3** (`POST /v3/videos`).
- **Doku-Prüfung:** Diese Sitzung erreicht `developers.heygen.com` nicht. Ob v2 noch angenommen wird, ist deshalb **nicht geprüft**, und eine v3-Umstellung ist **nicht** als Pflicht belegt.
- **Avatar „Mia“:** Der Betreiber hat ihn angelegt. `HEYGEN_AVATAR_ID` und `HEYGEN_VOICE_ID` fehlen. **Keine Neuanlage.** Die IDs liest der Betreiber im HeyGen-Konto ab (Avatar → Details; Stimme → Voice-ID).
- **Ursache:** fehlende Konfiguration (Schalter, IDs, Monatslimit) und offene Kostenentscheidung. API-Kompatibilität v2 ungeprüft.

### Meta-Themenweg (Facebook/Instagram)

- **Befund:** `lib/capabilities/index.ts` verlangt für den Themenweg `META_PAGE_ID` (Facebook) und zusätzlich `META_INSTAGRAM_USER_ID` (Instagram). Die Publisher selbst ermitteln die IDs aber per Seitensuche über `checkMetaConnection`, genau wie der laufende Affiliate-Weg (`lib/meta/instagram-publisher.ts:55`, `lib/meta/facebook-page.ts:14`, Seite „Alltäglich leichter“, Konto `@alltaeglich.leichter`).
- **Einordnung:** Die beiden Variablen sind also eine **zu strenge Vorbedingung im Fähigkeitscheck**, kein fehlender Zugang. Entweder trägt der Betreiber die IDs ein, oder der Check übernimmt die ermittelten IDs. Die Entscheidung liegt bei Sitzung 1 (lib/capabilities).
- **Dazu kommen Betreiberentscheidungen:** `TOPIC_PLATFORMS` (welche Kanäle; ohne Wert gelten **alle außer Pinterest**, also auch TikTok, X und YouTube) und `TOPIC_LIVE_PUBLISHING=true`. Vor jeder Aktivierung `TOPIC_PLATFORMS` ausdrücklich setzen, z. B. `facebook,instagram`.

### YouTube

Refresh-Token vermutlich abgelaufen (OAuth-App im Testmodus, Token verfällt nach 7 Tagen). Erst neu ausstellen, wenn YouTube wirklich gewünscht ist.

## 4. 24-Stunden-Fenster: was daran hängt

WhatsApp erlaubt Freitext nur innerhalb von 24 h nach der letzten Nachricht des Betreibers. Die Tagesvorlage ist aus (Betreiberentscheidung), die Wochenvorlage nicht eingerichtet. Folgen:

| Ablauf | ohne offenes Fenster |
|---|---|
| Affiliate-Tagesentwurf (Freigabeanfrage) | gespeichert, nicht zugestellt. Wird bei späteren Cron-Aufrufen erneut versucht und mit „Status“ nachgeliefert |
| Themenvorschlag (Cron 08–11 Uhr) | gehalten (`delivery='awaiting_window'`), mit der nächsten Betreiber-Nachricht nachgeliefert |
| Bildstopp, Kosten- und Veröffentlichungsfreigabe | nur als Antwort im Fenster zustellbar |
| **Montagsbericht** (Mo 08:15 UTC = 09:15 Uhr Berlin) | **nur zugestellt, wenn der Betreiber in den 24 h davor geschrieben hat.** Sonst Status `template_required`, und eine spätere automatische Zustellung gibt es nicht. Der Bericht liegt dann nur in `weekly_reports` |
| Antworten auf Betreiber-Nachrichten („Status“, „Executive“) | funktionieren immer, weil die Nachricht das Fenster öffnet |

## 5. Irreführende Berichtszahlen

- **„24 nicht zugestellte Entwürfe“:** `daily_slot_runs` hat **eine Zeile je Cron-Aufruf**, und ein Slot wird bis zu dreimal aufgerufen. Jeder fehlgeschlagene Zustellversuch desselben Entwurfs zählte mit. Die Betriebsansicht zeigt jetzt eindeutige Entwürfe (`job_id`) **und** Cron-Aufrufe nebeneinander. Die Korrektur im Executive-Text folgt als eigener kleiner PR nach Absprache.
- **299 vs. 259 Kostenzeilen:** Der Executive-Zyklus zählt rollierend 7 Tage ab dem Zykluszeitpunkt, der Wochenbericht die Kalenderwoche. Das sind zwei Zeitfenster, keine Datenfehler. Die Korrektur nennt künftig Fenster und Stand im Text. Es wird nichts bereinigt.

## 6. Betriebsansicht (dieser PR)

- **Ansicht:** `/architecture` → Ansicht „Betrieb“, auf der eigenen Seite die Startansicht. Zwei Wege umschaltbar: **Affiliate-Bildpost** und **Themenbeitrag**.
- **Stationen:** Thema/Produkt → Entwurf → Bild/Video → WhatsApp-Freigaben → Veröffentlichung → Ergebnisse.
- **Je Station:** Zustand (belegt / wartet auf dich / blockiert / aus / unbekannt), Begründung, zuletzt erfolgreich, aktueller Inhalt mit ID, Blocker, nächster Schritt mit Verantwortlichem und Quelle (Tabelle). Bei der Veröffentlichung kommen Plattform-ID und Link dazu.
- **Oben:** Status des 24-h-Fensters und die nicht zugestellten Tagesentwürfe (Entwürfe und Aufrufe getrennt).
- **„Belegt“** heißt nur: In der DB steht ein erfolgreicher Lauf. Ein vorhandener Schlüssel macht nichts grün. Reichweite und Provisionen erscheinen als „unbekannt“, nie als 0.
- **Rein lesend:** SELECT in READ-ONLY-Transaktionen, je Abschnitt isoliert, keine Knöpfe mit Wirkung.
- **Tests:** `tests/architecture-pipeline.test.cjs` (9 Fälle, PGlite mit allen Migrationen) und die bestehenden Command-Center-Tests.

## 7. Genaue Eingaben, die der Betreiber liefern muss (gebündelt)

1. **Montag, 02.11., vor 09:00 Uhr Berlin** eine kurze WhatsApp-Nachricht, z. B. „Status“. Dann wird der Montagsbericht zugestellt und der Nachweis für Schritt 4 möglich.
2. **„Executive“** noch einmal schreiben, wenn der Nachweis für Schritt 3 mit Uhrzeit gewünscht ist (Screenshot reicht).
3. **Videoentscheidung Runway (Kostenfreigabe):**
   - Monatslimit Themenvideos (`TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT`, z. B. 2).
   - `TOPIC_STANDARD_VIDEO_PROVIDER=runway` setzen.
   - Ein Testclip kostet laut Code-Annahme ≈ 300 Credits (≈ 3 USD).
   - Freigabe des einen Testclips per WhatsApp-Kostenfreigabe.
4. **HeyGen (später, separat):** Avatar-ID und Voice-ID von „Mia“ aus dem HeyGen-Konto, Monatslimit, danach `HEYGEN_ENABLED=true`. Vorher lesend prüfen, ob v2 noch angenommen wird.
5. **Themen-Veröffentlichung:**
   - Kanäle festlegen (`TOPIC_PLATFORMS`, Vorschlag `facebook,instagram`).
   - Entscheiden, ob `TOPIC_LIVE_PUBLISHING=true` gesetzt wird. Erst nach dem ersten abgenommenen Themenpost.
   - Je nach Entscheidung von Sitzung 1 zusätzlich Seiten-ID und Instagram-ID eintragen.
6. **Netzwerkfreigabe der Cloud-Umgebung (optional):** `docs.dev.runwayml.com` und `developers.heygen.com`, damit die API-Prüfung gegen die offizielle Doku möglich ist.

## 8. Weg zum ersten vollständigen Bildpost, danach zum Videopost (mit Sitzung 1)

1. **Bildpost (Affiliate-Weg):**
   1. Der Betreiber öffnet das 24-h-Fenster (Nachricht) im Slot-Zeitraum (9–14 oder 18–23 Uhr Berlin) oder schreibt „Status“.
   2. Der Entwurf kommt, der Betreiber gibt ihn mit „Freigeben“ frei (Antwort auf genau die Nachricht).
   3. Das Bild wird erzeugt und geprüft; bei einem Bildstopp entscheidet der Betreiber.
   4. Die Facebook-/Instagram-Freigabe kommt, der Betreiber gibt sie frei, der Post erscheint.
   5. **Nachweis:** In der Betriebsansicht steht unter „Veröffentlichung“ die Plattform-ID mit Link. Sitzung 1 nimmt Text und Bild ab.
2. **Videopost (Themenweg):**
   1. Zuerst den Code-PR von Sitzung 1 zur Content-Qualität mergen.
   2. Dann Runway konfigurieren (Punkt 3 oben), ein Themenvorschlag mit Video, Inhaltsfreigabe, Kostenfreigabe für genau einen Clip, Rendering.
   3. Abnahme durch Sitzung 1, dann Veröffentlichungsfreigabe. Live erst nach den Entscheidungen aus Punkt 5. Bis dahin Dry-Run.
   4. **Nachweis:** `visual_jobs` mit Status `succeeded`, `publish_attempts` mit Status `published` und externer ID.

## 9. Meta-Seitensuche: was heute belegt ist

Welche Facebook-Seite und welches Instagram-Konto die Seitensuche heute findet, ist **ohne Live-Aufruf nicht belegbar**. `/api/meta/connection` gibt bewusst keine IDs aus, und diese Sitzung hat weder Admin-Session noch Meta-Token.
- **Belegt ist nur, was der Code erwartet:** Seitenname `META_PAGE_NAME` (Standard „Alltäglich leichter“), Instagram-Benutzername `META_INSTAGRAM_USERNAME` (Standard `alltaeglich.leichter`), Systemnutzer `affiliatecontentsystem` (`lib/meta/connection.ts`, `metaConfig`). Weicht die gefundene Seite oder das Konto davon ab, bricht die Prüfung mit `identity_mismatch` ab.
- **Indirekter Beleg:** Veröffentlicht der Affiliate-Weg erfolgreich (Plattform-ID in der Betriebsansicht), dann hat die Seitensuche genau diese Seite und dieses Konto gefunden. Die IDs kann der Betreiber danach aus dem Post-Link oder der Meta Business Suite ablesen.
- **Vereinbart:** `lib/capabilities` bleibt unverändert, bis der Affiliate-Bildpost abgenommen ist. Danach entscheidet Sitzung 1.

## 10. Sicherungsstand (30.10.2026, ca. 19:50 UTC)

- **Branch und PR:** `claude/betrieb-diagnose`, PR #145. Der letzte geprüfte Code-Commit ist `57a26a40` (volle SHA in der PR-Ansicht); danach folgt nur dieser Doku-Nachtrag.
- **Fertig:**
  - Betriebsansicht mit Tests
  - Anbieter- und Konfigurationsdiagnose (§2–§5)
- **Offen:**
  - CI `check` auf dem Head
  - Review durch Sitzung 1
  - Merge, den Sitzung 1 koordiniert. Reihenfolge: #144 → #145 → Executive-Zahlen-PR.
- **Tests:** lokal 957 Tests (953 bestanden, 4 übersprungen, 0 fehlgeschlagen), Typecheck, Lint (2 bekannte Warnungen), Build und `npm audit` grün.
- **Produktionsänderungen:** **keine**. Keine Variable gesetzt, kein Schalter aktiviert, kein Anbieteraufruf, keine Nachricht.
- **Nächster Schritt:**
  1. Review von #144 (Sitzung 1, Schwerpunkte readiness.ts, Korrekturbudget, `applyWish`)
  2. Danach eigener kleiner PR „Executive-Zahlen“ (`lib/enterprise/departments/affiliate.ts` und `executive.ts`, nur Zählung und Text): eindeutige Entwürfe neben Cron-Aufrufen, Zeitfenster und Stand der Kostenzeilen
- **Fortsetzung:** Weckruf am 03.11. um 08:20 UTC (`trig_01DHjjNYeVP8cSskuaUuPxtg`, von Sitzung 1). Zuerst beide Übergaben lesen, auch `docs/handoff/SITZUNG1_STABILISIERUNG_2026-10-30.md` auf `claude/nice-ptolemy-k4p1c3`.

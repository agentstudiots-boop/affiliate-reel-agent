# Erster Reel-Praxistest (vorbereitet, nichts gerendert)

Stand 18.10.2026. Ziel ist ein erzählendes Themen-Reel der Marke „Alltäglich leichter“: 9:16, Ziel 1080 × 1920, Deutsch, 20–40 s, Hook in den ersten 1–3 s.
**Keine Kosten ohne Kostenfreigabe, keine Veröffentlichung ohne Veröffentlichungsfreigabe.**

## 1. Ablauf in Production (vorhandene Komponenten)

1. Der Cron `/api/cron/topic-video` läuft um 12:00 Uhr Berlin (10:00 UTC im Sommer). Er wählt ein Thema über Themen-Scout, Trendsetter und Jarvis und schreibt das Drehbuch (`lib/topic-pipeline/video-briefing.ts`).
2. **WhatsApp-Vorschlag** mit Thema, Hook, Inhalt, Länge, Format, Anbieter, geschätzten Kosten, Content-ID und Szenen. Antwort „Freigeben“ ist nur die **Inhaltsfreigabe**.
3. **Kostenfreigabe** als eigene Nachricht mit Anbieter, Schätzung und Monatsbudget. Erst „Freigeben“ darauf startet genau **ein** Rendering.
4. Das Video wird in Vercel Blob archiviert. Danach kommt die **Veröffentlichungsfreigabe** mit Videolink und Prüfliste (Hook, Stimme, keine erfundenen Aussagen, Einblendungen, Ton, 9:16).
5. Mit `TOPIC_LIVE_PUBLISHING` aus ist „Freigeben“ ein Probelauf, es wird nichts gepostet. Für den ersten echten Beitrag reicht **eine** Plattform (Empfehlung: Instagram-Reel mit Testkonto oder YouTube Shorts als `private`).

## 2. Voraussetzungen (Betreiber, in Vercel → Environment Variables, Production; danach Redeploy)

| Variable | Wert | Wirkung |
|---|---|---|
| `TOPIC_PIPELINE_ENABLED` | `true` | Themen-Pipeline und Themen-Cron 07/08 UTC (Vorschlag 08–11 Uhr Berlin) |
| `TOPIC_DAILY_VIDEO` | `true` | täglicher Themenvideo-Vorschlag 12–14 Uhr Berlin |
| `TOPIC_COPY_MODE` | `ai` (empfohlen) | KI-Drehbuch mit starker Hook (ein Modellaufruf, ca. 1 Cent); sonst Referenzvorlage |
| `TOPIC_STANDARD_VIDEO_PROVIDER` | `runway` | Runway WAN 3 als Videoanbieter für Themenvideos (Schlüssel vorhanden) |
| `TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT` | z. B. `4` | lokales Monatslimit für Themenvideos |
| `TOPIC_VIDEO_MAX_USD` / `TOPIC_VIDEO_MONTHLY_BUDGET_USD` | Standard 5 / 30 | Höchstbetrag je Video und Monatsbudget |
| `TOPIC_PLATFORMS` | z. B. `instagram` | genau eine Plattform für den ersten Test |
| `TOPIC_LIVE_PUBLISHING` | erst nach erfolgreichem Probelauf `true` | echte Veröffentlichung, nur nach Freigabe |

## 3. Anbieterwahl für den ersten Test

| Anbieter | Stimme | Format | Kosten (Schätzung) | Status |
|---|---|---|---|---|
| Runway WAN 3 (Text-zu-Video mit Ton) | vom Modell erzeugt, deutscher Sprechtext im Prompt | 30 s, 720 × 1280 | 300 Credits ≈ 3,00 USD | Schlüssel vorhanden; im Produkt-Reel-Pfad live genutzt; Themenpfad per Schalter aus |
| HeyGen Avatar „Mia“ | Lippensynchron, gewählte deutsche Stimme | 9:16, v2 720 × 1280 | ca. 0,05 USD/s → 30 s ≈ 1,50 USD | Avatar, Stimme, Limit fehlen; Schalter aus |

Empfehlung für den ersten Test: **Runway WAN 3** (sofort einsetzbar, Kosten bekannt). Grenze: 720 × 1280 statt 1080 × 1920 und eine vom Modell erzeugte Stimme ohne Lippensynchronität zu einer festen Person. Diese Grenze steht in jedem Vorschlag.

## 4. Beispiel-Drehbuch (Referenz für die Abnahme, Thema „Richtig lüften in der Heizperiode“)

Belegte Grundlage: Umweltbundesamt, Ratgeber „Richtig lüften“ (mehrmals täglich Stoßlüften statt Dauerkipp). Keine Zahlen ohne Quelle.

| Zeit | Zweck | Sprechtext (wörtlich) | Bild | Kamera / Übergang | Einblendung |
|---|---|---|---|---|---|
| 0–3 s | Hook | „Dein gekipptes Fenster kühlt die Wand – und lüftet kaum.“ | Nahaufnahme gekipptes Fenster, Hand an kalter Wand | schneller Push-in / harter Schnitt | „Kippen? Lieber nicht.“ |
| 3–9 s | Problem | „Im Herbst bleibt das Fenster oft stundenlang gekippt. Die Luft wird kaum ausgetauscht, die Heizung läuft weiter.“ | Wohnzimmer, Heizung an, Fenster gekippt | Handkamera / Match-Cut | „Kennst du das?“ |
| 9–15 s | Spannung | „Gerade jetzt, wenn draußen kalt und drinnen feucht ist, entscheidet die Methode.“ | Beschlagene Scheibe, Regen draußen | langsamer Zoom / Wischblende | „Warum gerade jetzt?“ |
| 15–24 s | Lösung | „Besser: mehrmals am Tag Fenster ganz auf, kurz querlüften, dann wieder schließen. Heizung beim Lüften runterdrehen.“ | Hände öffnen zwei Fenster, Thermostat wird gedreht | Draufsicht und Nahaufnahme im Wechsel / harter Schnitt | „Stoßlüften“ |
| 24–28 s | Auflösung | „So kommt frische Luft rein, ohne dass die Wände auskühlen.“ | entspannte Person, klare Scheibe | Pull-out / weiche Blende | „Alltäglich leichter“ |
| 28–30 s | CTA | „Speichern und mit jemandem teilen, dem es hilft.“ | Schlussbild mit Markenname | statisch | „Speichern & teilen“ |

Stimme: warm, ruhig, ca. 2,3 Wörter/s. Musik: leiser, lizenzfreier Beat. Plattformtext: Hook + Kernaussage + Frage („Wie lüftest du im Herbst?“) + Quelle (Umweltbundesamt) + `#alltäglichleichter`.

Abnahmekriterien: Hook ≤ 3 s ohne Begrüßung · Sprechtext verständlich · Bild passt zum Gesagten · keine Marken/Logos · Einblendungen lesbar · Quelle im Beitragstext · 9:16.

## 5. Status

- implementiert, getestet (`tests/topic-video.test.cjs`), gemergt (PR #79), deployed
- **nicht aktiviert**: Die Schalter aus Abschnitt 2 setzt der Betreiber.
- **nicht gerendert, nicht veröffentlicht**: Rendering erst nach Kostenfreigabe per WhatsApp, Veröffentlichung erst nach eigener Freigabe.

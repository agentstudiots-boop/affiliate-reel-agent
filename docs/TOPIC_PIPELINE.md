# Themen- und Multi-Format-Pipeline

Additive Erweiterung neben der bestehenden produktbasierten Pipeline (`lib/content/`, Daily-Drafts,
Trend-Agent). Bestehende Abläufe werden nicht verändert; die neue Pipeline ist standardmäßig
**ausgeschaltet** (`TOPIC_PIPELINE_ENABLED` nicht gesetzt) und läuft ohne Live-Veröffentlichung.

```
Trend-/News-Quellen → Themen-Scout → Jarvis Quality Gate → Content Format Router
  → Visual Content Engine (Renderer → Provider) → WhatsApp-Freigabe → Master Content
  → Platform Adapter → Veröffentlichung (Dry-Run, Live nur nach Freischaltung)
```

Ebenen und erlaubte Importe:

| Ebene | Ordner | darf nicht |
| --- | --- | --- |
| Themen-Scout + Jarvis-Gate | `lib/topics/` | Provider (Replicate/HeyGen), Renderer, Plattformen, WhatsApp aufrufen |
| Format Router | `lib/formats/` | produzieren oder veröffentlichen |
| Visual Content Engine | `lib/visual/` | Themen suchen, veröffentlichen |
| Master Content + Adapter | `lib/distribution/` | Bilder/Videos erzeugen |
| Orchestrierung | `lib/topic-pipeline/` | einzige Stelle, die alle Ebenen verbindet |

Ein Test (`tests/topic-scout.test.cjs`) prüft, dass `lib/topics/` keine Produktions-, Plattform- oder
WhatsApp-Module importiert.

## Phase 1 – Themen-Scout

### Quellen

| Quelle | Art | Zugang | Status |
| --- | --- | --- | --- |
| `tavily_news` | Meldungen (Tavily `topic=news`, 3 Tage) | `TAVILY_API_KEY` (bestehend) | nutzt den vorhandenen Tavily-Client (`lib/tavily.ts`, additiv erweitert) |
| `google_news_rss` | Meldungen mit Publisher und Datum | öffentlicher RSS-Feed, kein Key | abschaltbar: `TOPIC_SOURCE_GOOGLE_NEWS=false` |
| `google_trends_rss` | Suchtrends DE + verlinkte Meldungen | öffentlicher „Trending now“-RSS-Feed | abschaltbar: `TOPIC_SOURCE_GOOGLE_TRENDS=false` |
| `wikipedia_pageviews` | Aufmerksamkeit (meistgelesene de.wikipedia-Artikel) | offizielle Wikimedia-REST-API, kein Key | abschaltbar: `TOPIC_SOURCE_WIKIPEDIA=false` |
| `calendar` | Feiertage, Anlässe, Zeitumstellung, Jahreszeiten | lokal berechnet | immer verfügbar |
| `evergreen` | kuratierte Alltagsthemen (Haushalt, Küche, Ordnung, Reinigung) mit Saisonbezug | lokal | immer verfügbar |

**Google Trends:** Es gibt keine offizielle, stabile Google-Trends-API für „Trending now“. Verwendet wird
nur der öffentlich angebotene RSS-Feed, und zwar ausschließlich als *ein* Signal unter mehreren. Keine
inoffiziellen Scraper oder Cookie-Tricks. Fällt der Feed aus oder ändert sich sein Format, liefert er eine
`invalid_response` und die übrigen Quellen arbeiten weiter. Suchsignale gelten nie als Faktenquelle.

**Nicht live geprüft:** Die Cloud-Sandbox hat keinen Zugriff auf Google News, Google Trends und Wikimedia
(Proxy 403). Die Parser sind gegen dokumentierte Feed-Formate mit Fixtures getestet, nicht gegen die
echten Endpunkte.

### Fehlertoleranz je Quelle (`lib/topics/resilience.ts`)

- eigenes Zeitlimit je Versuch (Standard 12 s) und Gesamt-Deadline des Laufs (45 s)
- höchstens 3 Versuche, nur bei `timeout`, `rate_limited` (Retry-After wird beachtet), `unavailable` (5xx/Netz)
- exponentieller Backoff (600 ms, 1,2 s …, max. 8 s)
- keine Wiederholung bei `auth`, `invalid_response`, `not_configured`
- Fehler werden je Quelle isoliert; `runSource` wirft nie
- Ergebnis je Lauf: `success`, `degraded` (mind. eine Quelle ausgefallen), `offline_fallback` (alle
  Netzquellen ausgefallen, nur Kalender/Evergreen), `no_candidates`

Kein LLM ist an der Trendbeschaffung beteiligt. Gemini/Replicate/Tavily sind keine Single Points of Failure:
Ohne Tavily-Key und ohne Netz liefern Kalender und Evergreen weiterhin Kandidaten.

### Bündelung, Klassifizierung, Bewertung

- Signale zum selben Ereignis werden gebündelt (gemeinsamer Trend-Suchbegriff oder deutliche Wortüberschneidung).
- `topic_id = tp_` + SHA-256 des Konzeptschlüssels (gemeinsame Kernwörter): stabil über Läufe → Dubletten und
  Cooldown greifen.
- Trendtypen: `BREAKING_NEWS`, `SOCIAL_HYPE`, `ENTERTAINMENT`, `SEASONAL`, `EVERGREEN`, `SEARCH_TREND`, `EVENT`,
  `CURIOSITY`, `PRACTICAL_LIFE`, `PRODUCT_ADJACENT` – regelbasiert über Signalart und deutsche Wortlisten.
- Bewertungen (`lib/topics/scoring.ts`): Aktualität, Trendstärke, Markenfit, Viralität, Nutzwert, Emotionalität,
  visuelles Potenzial, Videoeignung, Interaktion, Monetarisierung, Risiko, Quellenqualität. Jede Bewertung
  speichert ihre Faktoren (gefundene Wörter, Anzahl Quellen/Publisher, Alter, Quellsignalstärke). Keine
  geschätzten Reichweiten oder erfundenen Zahlen.
- Faktenstatus: `multi_source` (≥ 2 berichtende Publisher), `single_reputable_source`, `unverified`,
  `not_applicable` (Kalender/kuratiert).
- Hook, Angle, Kernbotschaft entstehen aus **Regelvorlagen** (`text_origin = rule_template`). Sie formulieren den
  Quellentitel und das Timing um, fügen aber keine Fakten hinzu. Das ist keine freie KI-Analyse.

### Jarvis Quality Gate (`lib/topics/gate.ts`)

Prüft Markenfit, Faktenlage, Aktualität, Risiko, Wiederholung, Qualität, Nutzwert, Viralität, Tonalität,
Account-Eignung, Klatsch/Sensationsniveau und unbelegte Aussagen. Entscheidungen:

- `accept`
- `revise` – z. B. reißerische Tonalität wird entschärft
- `request_variant` – z. B. Hook wiederholt sich oder enthält unbelegte Aussagen; höchstens zwei Varianten,
  danach `reject`
- `reject` – u. a. Fakt ohne belastbare Quelle, sensibles Thema nur aus einer Quelle, Risiko ≥ 55,
  Markenfit < 35, Klatsch, Meldung älter als eine Woche, Cooldown

Eine optionale Modell-Zweitmeinung kann das Urteil nur verschärfen (`combineTopicVerdicts`).

### Historie und Cooldown (`lib/topics/history.ts`)

| Status | Sperrfrist |
| --- | --- |
| veröffentlicht | 30 Tage |
| freigegeben | 21 Tage |
| abgelehnt | 14 Tage |
| von Jarvis verworfen | 7 Tage (Abzug) |
| ≥ 2× vorgeschlagen ohne Freigabe | 7 Tage gesperrt |
| ähnlicher Hook | 21 Tage → neue Variante |
| gleiche Problemstellung | 10 Tage (Abzug) |

Ähnlichkeit nutzt `sameConcept` des bestehenden Produkt-Trendscouts und dessen Auswahlhistorie
(`loadSelectionHistory`): ein Thema wiederholt kein gerade abgelehntes Produktkonzept.

### Datenbank (`db/migrations/028_topic_pipeline.sql`)

- `topic_runs` – Lauf, Slot-Schlüssel (idempotent je Slot), Quellenzustand, Ergebnis, gewähltes Thema
- `topic_candidates` – Kandidat + Gate-Urteil je Lauf
- `topic_history` – Verlauf für Cooldowns, idempotent über `(topic_id, status, origin)`

## Zentrale Freigabeschranke (harte Invariante)

`lib/publishing/approval-gate.ts`, Migration `029_publish_approvals.sql`.

> Kein Veröffentlichungsversuch – Cron, Retry, Fallback oder Plattform-Adapter – erreicht eine Plattform,
> solange keine ausdrückliche Freigabe einer aktiven Freigabeinstanz für genau diese Content-ID, Version
> und diesen Fingerprint vorliegt.

- **Bindung:** Freigabe gilt für `(content_id, version, fingerprint)`. Der Fingerprint (SHA-256 über
  kanonisches JSON) umfasst Hook, Caption, Body, CTA, Links, Assets (URL + Hash), Disclosures und alle
  Plattformvarianten. Schlüsselreihenfolge ändert ihn nicht, jede inhaltliche Änderung schon.
- **Automatische Invalidierung:** `registerContentVersion` legt bei jeder Änderung (neuer Hook, neues Asset,
  andere Caption, anderer Link, geänderter Plattformtext, zusätzliche Plattform) eine neue Version an und setzt
  alle früheren offenen/erteilten Freigaben auf `invalidated`. Wird abweichender Inhalt direkt veröffentlicht,
  verwirft `authorizePublish` die bestehende Freigabe und blockiert. Eine alte Freigabenachricht kann eine
  neue Version nicht freigeben.
- **Nur WhatsApp freigibt:** `ACTIVE_APPROVAL_AUTHORITIES = ["whatsapp_operator"]` (eingefroren). Eine Freigabe
  braucht den vertrauenswürdigen Absender (`WHATSAPP_APPROVER_WA_ID`), eine Antwort auf genau diese
  Freigabenachricht und das wörtliche „Freigeben“. „Passt so“ & Co. zählen als Änderungswunsch.
- **Executive-Agent:** nur Schnittstelle (`ApprovalAuthority`, `executive_agent` als Wert). Er ist nirgends
  verdrahtet und kann weder eine Entscheidung speichern noch eine gespeicherte Freigabe zum Veröffentlichen
  nutzen. Aktivierung ist ausschließlich eine geprüfte Codeänderung, keine Umgebungsvariable.
- **Kein Publish bei:** fehlender Version, `pending` (keine Antwort), `rejected`, `changes_requested`,
  `invalidated`, inaktiver Instanz, unvollständigem Nachweis, nicht freigegebener Plattform.
- **Datenbank erzwingt mit:** `CHECK` – eine Freigabe ohne Instanz, Anfrage-/Entscheidungsnachricht und
  Zeitpunkt ist nicht speicherbar. Eindeutiger Index – je Version und Plattform höchstens ein aktiver Versuch
  (`claimed`/`published`/`unknown`). `failed` (eindeutige Ablehnung durch die Plattform) erlaubt einen neuen
  Versuch derselben freigegebenen Version, `unknown` nie.
- **Permit:** Nur `authorizePublish` stellt ein `PublishPermit` aus (Identität registriert, eingefroren; Kopien
  sind ungültig). Jeder Publisher ruft unmittelbar vor dem Netzwerkaufruf `assertPermitMatches` mit dem
  exakt ausgehenden Inhalt auf.
- **Protokoll:** Jeder Versuch, auch jeder blockierte, steht in `publish_attempts`.
- Ein Test stellt sicher, dass außerhalb von `lib/publishing/` niemand diese Tabellen schreibt.

**Bestehende Meta-Wege:** Facebook-Bild (`claimPublish`) und Instagram-Reel (`checkPublication`) binden die
WhatsApp-Freigabe bereits an Freigabe-ID und Inhalts-Hash. Lücke geschlossen: Der Instagram-Bildpost
verwendet die Facebook-Freigabe nur noch, wenn die Caption exakt der freigegebenen entspricht
(`approval_mismatch` sonst).

## Publish-Rückmeldung per WhatsApp (`lib/publishing/report.ts`)

Nach jedem Veröffentlichungsversuch eine Nachricht mit zwei getrennten Klassifikationen in der Überschrift:
**Content-Kategorie** (Themen-Post | Affiliate-Post) und **Content-Format** (Bild | Karussell | Video |
Video (Avatar) | Text), z. B. „Themen-Post, Video veröffentlicht“, „Affiliate-Post, Bild teilweise
veröffentlicht“, „… nicht veröffentlicht“, „… noch nicht bestätigt veröffentlicht“.

Darunter je tatsächlich veröffentlichter Plattform: Name – Status – direkter Link. Ein Link erscheint nur,
wenn die Plattform-API eine https-URL auf der eigenen Plattform-Domain mit Beitragspfad geliefert hat;
sonst steht „Link nicht verfügbar“. Bei Teilerfolg getrennte Blöcke „Erfolgreich (live)“ und
„Nicht erfolgreich (nicht live)“ (fehlgeschlagen, Ergebnis unklar, wird verarbeitet, blockiert).

Angebunden: Facebook-/Instagram-Bildpost (Affiliate, Bild), Instagram-Reel (Affiliate, Video – vorher gab
es keine aktive Erfolgsmeldung), unklarer Facebook-Versuch (vorher stumm). Die neuen Plattform-Adapter
nutzen denselben Formatierer.

## Publish-Rückmeldung per WhatsApp (`lib/publishing/report.ts`)

### Architektur-Klarstellung

Die zentrale Rückmeldekomponente **trifft keine eigenen Entscheidungen**. Sie

- **sammelt** nur die Ergebnisse, die die bestehenden Router, Adapter und Publisher bereits ermittelt haben
  (Content-Kategorie, Content-Format, Status je Plattform, von der Plattform gelieferte Beitrags-URL),
- **vereinheitlicht** sie in ein gemeinsames Ergebnisformat und
- **formatiert** daraus eine einheitliche WhatsApp-Rückmeldung des Orchestrators.

Sie entscheidet nicht, ob, wo oder was veröffentlicht wird, löst keine Wiederholungen oder Fallbacks aus,
bestimmt weder Kategorie noch Format und ändert keinen Veröffentlichungsstatus. Diese Entscheidungen bleiben
bei den bestehenden Routern und Adaptern sowie der Freigabeschranke (`approval-gate.ts`). Ihre einzige Regel
ist eine Darstellungsregel: Ein Link wird nur angezeigt, wenn die Plattform eine https-URL auf ihrer eigenen
Domain geliefert hat, sonst „Link nicht verfügbar“. Es wird nichts konstruiert oder erfunden. Ziel ist eine
zentrale, konsistente Rückmeldung ohne neue Entscheidungslogik.

### Format

Überschrift mit zwei getrennten Klassifikationen: **Content-Kategorie** (Themen-Post | Affiliate-Post) und
**Content-Format** (Bild | Karussell | Video | Video (Avatar) | Text), z. B. „Themen-Post, Video
veröffentlicht“, „Affiliate-Post, Bild teilweise veröffentlicht“, „… nicht veröffentlicht“, „… noch nicht
bestätigt veröffentlicht“.

Darunter je tatsächlich veröffentlichter Plattform: Name – Status – direkter Link bzw. „Link nicht
verfügbar“. Bei Teilerfolg getrennte Blöcke „Erfolgreich (live)“ und „Nicht erfolgreich (nicht live)“
(fehlgeschlagen, Ergebnis unklar, wird verarbeitet, blockiert).

Angebunden: Facebook-/Instagram-Bildpost (Affiliate, Bild), Instagram-Reel (Affiliate, Video; vorher keine
aktive Erfolgsmeldung) und unklarer Facebook-Versuch (vorher stumm). Die neuen Plattform-Adapter nutzen
denselben Formatierer.

## Phase 2 – Format Router, Visual Content Engine, Karussell, Replicate

### Content Format Router (`lib/formats/router.ts`)

Entscheidet das tatsächlich produzierte Format: `TEXT`, `SINGLE_IMAGE`, `CAROUSEL`, `STANDARD_VIDEO`,
`AVATAR_VIDEO`. Der Scout empfiehlt nur (`suggested_format`, +5 Punkte).

Rangfolge: **1. manuelle WhatsApp-Anweisung** → 2. Executive-Vorgabe (`ExecutiveDirective`, nur vorbereitet,
nicht verdrahtet) → 3. Router → 4. Scout-Empfehlung.

Bewertung je Format aus den Themenwerten (Nutzwert, Videoeignung, Viralität, visuelles Potenzial,
Interaktion, Trendtyp), Plattform-Eignung (z. B. YouTube Shorts nur Video), Ziel (Reichweite/Vertrauen) und
Kosten (2 Punkte je Kosteneinheit, bei starken Reichweitenthemen 1). Bei vergleichbarem Nutzen
(±5 Punkte) gewinnt die günstigere Form. Nicht umsetzbar: Provider nicht verfügbar, Avatar-Kontingent
leer, über Budget, ausgeschlossen. Günstiges Affiliate-Produkt (`productPriceClass: "low"`) → höchstens
Karussell. „zu teuer“ → höchstens Bild. Ist ein manueller Wunsch nicht umsetzbar, wird die nächstbilligere
Form gewählt und der Grund (`manualNotHonoured`) zurückgemeldet. `TEXT` ist immer möglich.

Kostenklassen (relativ, keine Euro-Beträge): Text 1, Bild 2, Karussell 4, Video 7, Avatar-Video 10.

WhatsApp-Wünsche (`lib/formats/override.ts`, deterministisch): Karussell, Video, Nur Bild, Nur Text,
HeyGen/Avatar, Kein Avatar, Kein Video, „N Slides“ (auf 3–7 begrenzt), zu teuer, ohne Produkt,
weniger werblich, mehr Humor, sachlicher, kürzer, anderer Aufhänger, neues Thema. Spätere Wünsche
ergänzen frühere (`mergeOverrides`).

### Visual Content Engine (`lib/visual/`)

- `engine.ts` führt die Router-Entscheidung aus und degradiert bei Ausfall entlang
  `Avatar → Video → Karussell → Bild → Text` (nie teurer, nie in ausgeschlossene Formate).
- Renderer: `TextRenderer`, `SingleImageRenderer`, `CarouselRenderer` (Phase 3: Video-Renderer).
- Provider stehen hinter `ImageProvider`; Replicate-spezifischer Code liegt nur in `lib/visual/providers/`.
- Dry-Run: keine Provider-Aufrufe; meldet geplante Slides und wie viele Bilder erzeugt würden.

### Karussell

- `CarouselPlanner` erzeugt zuerst einen Plan: Hook → Problem → Punkte → (Lösung) → CTA. Die Anzahl folgt
  den tatsächlich vorhandenen Inhaltspunkten (3–7), sonst dem Betreiberwunsch. Zu viele Punkte für die
  gewünschte Länge werden zusammengefasst statt still verworfen.
- Jede Slide: `slide_number`, `purpose`, `headline`, `supporting_text`, `visual_type`, `visual_brief`,
  `requires_generated_image`, `cta`.
- Generierte Bilder nur, wo sie etwas bringen (Hook ab visuellem Potenzial 40, Problem ab 60, Lösung ab 75),
  höchstens 3 je Karussell; alle anderen Slides sind lokale Textgrafiken (SVG, keine Kosten).
- Gemeinsamer Style Brief (`style.ts`): Bildsprache, Typografie, Layout, Bildstil, Tonalität, Farben. Das
  Repository definiert keine Markenfarben; verwendet wird eine als `neutral_default` gekennzeichnete Palette,
  ersetzbar über `TOPIC_BRAND_PALETTE="#hex,#hex,#hex"` (Hintergrund, Text, Akzent).
- Fehler: Jede Slide hat einen eigenen Idempotenzschlüssel. Schlägt nur Slide 3 fehl, wird nur Slide 3
  wiederholt; fertige Slides werden wiederverwendet. Bleibt das Bild endgültig aus, wird die Slide zur
  Textgrafik (Status `degraded`), das Karussell bleibt nutzbar.

### Replicate (`lib/visual/providers/replicate.ts`)

Nutzt die vorhandenen, geprüften Helfer der bestehenden Integration (HTTP-Klassifizierung, ID- und
Output-URL-Prüfung, begrenzter PNG-Download) und dieselben Variablen (`REPLICATE_API_TOKEN`,
`REPLICATE_IMAGE_MODEL`). Bilder landen unter `generated/topics/<contentId>/<sha256>.png` im Blob-Store.

| Fall | Verhalten |
| --- | --- |
| 429 / 5xx beim Anlegen | nichts angenommen → erneuter Versuch mit Backoff (max. 3) |
| Timeout vor Prediction-ID | Ergebnis des bezahlten POST unklar → **kein** automatischer zweiter POST |
| Timeout/5xx beim Abfragen | Prediction-ID gespeichert → nächster Versuch fragt dieselbe Prediction ab |
| 401/402/403/422 | endgültig, kein Retry |
| failed/canceled, ungültiges Asset | endgültig; Renderer degradiert |

Job-Ledger (`ledger.ts`, Migration `030_visual_jobs.sql`): `visual_jobs` je Idempotenzschlüssel
(Content-ID + Rolle + Brief-Fingerprint) und `provider_usage` für Budget/Kontingente.

## Phase 3 – Video, HeyGen / AvatarVideoProvider, Kontingent, Fallbacks

Ablauf: Format Router → `AVATAR_VIDEO` → `AvatarVideoRenderer` → `VideoProvider` (HeyGen). HeyGen-spezifischer
Code liegt ausschließlich in `lib/visual/providers/heygen.ts`; Scout, Jarvis und Router importieren ihn nicht.
`STANDARD_VIDEO` ist getrennt modelliert (`StandardVideoRenderer`, Adapter auf die bestehende Runway-Anbindung,
nur mit `TOPIC_STANDARD_VIDEO_PROVIDER=runway`), damit später andere Video-Provider ergänzt werden können.

- **Kontingent:** HeyGen gilt als begrenzte Ressource. Ohne `HEYGEN_MONTHLY_VIDEO_LIMIT` wird kein Avatar-Video
  produziert. Lokaler Zähler `provider_usage` (geplant, erfolgreich, fehlgeschlagen, je Monat, idempotent je
  Job). Vor jedem Anlegen wird geprüft und reserviert; fehlgeschlagene Jobs zählen nicht, hängende Jobs
  vorsichtshalber schon. Kein HeyGen-Aufruf ohne vorherige Formatentscheidung.
- **Fehler:** Timeout beim Anlegen (Ergebnis unklar → kein zweiter POST), 429 (`rate_limited`), 401/403
  (`auth`, endgültig), Kontingent erschöpft (lokal ohne API-Aufruf oder von HeyGen gemeldet), Job `failed`,
  Job hängt (`job_stuck`, Standard 30 min), API down (beim Abfragen vorübergehend), ungültige Antwort.
- **Keine doppelte Generierung:** Videos laufen länger als ein Funktionsaufruf. Nach `maxWaitMs` bleibt der Job
  mit seiner Provider-ID `running` (`in_progress`) und wird beim nächsten Lauf per ID weiter abgefragt, nie neu
  angelegt. Fertige Videos werden in den Blob-Store kopiert (Provider-URLs laufen ab) und wiederverwendet.
- **Fallback:** Fällt HeyGen aus → `STANDARD_VIDEO` → `CAROUSEL` → `SINGLE_IMAGE` → `TEXT`; die Pipeline bricht
  nicht ab.
- **Nicht live geprüft:** HeyGen-Endpunkte (`POST /v2/video/generate`, `GET /v1/video_status.get`) sind nach
  öffentlicher Dokumentation umgesetzt und nur mit Mocks getestet. Benötigt: `HEYGEN_API_KEY`,
  `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `HEYGEN_MONTHLY_VIDEO_LIMIT` (PENDING_USER_INPUT).

## Phase 3 – Video, AvatarVideoProvider, Kontingent, Fallbacks

Ablauf: Format Router → `AVATAR_VIDEO` → `AvatarVideoRenderer` → `VideoProvider`-Schnittstelle (`kind: avatar_video`).
Der Renderer kennt keinen Anbieter. **HeyGen ist nur der aktuell vorhandene Adapter**
(`lib/visual/providers/heygen.ts`) und jederzeit durch einen anderen Avatar-Anbieter ersetzbar oder ergänzbar,
ohne Router, Engine, Scout oder Jarvis zu ändern. Kein Modul außerhalb von `lib/visual/providers/` enthält
HeyGen-spezifischen Code; ohne konfigurierten Avatar-Adapter wählt der Router `AVATAR_VIDEO` nie.

`STANDARD_VIDEO` ist davon getrennt (`StandardVideoRenderer`, eigener `VideoProvider` mit `kind: standard_video`).
Aktueller Adapter: die bestehende Runway-Anbindung, nur mit `TOPIC_STANDARD_VIDEO_PROVIDER=runway`. Es wird nicht
vorausgesetzt, dass ein Avatar-Anbieter Videos erzeugt.

- **Kontingent:** Avatar-Videos sind eine begrenzte Ressource. Lokaler Zähler `provider_usage` (geplant,
  erfolgreich, fehlgeschlagen, je Monat und Anbieter, idempotent je Job), weil Anbieter-Kontingente nicht
  zuverlässig abfragbar sind. Vor jedem Anlegen: Prüfen und Reservieren. Fehlgeschlagene Jobs zählen nicht,
  hängende vorsichtshalber schon. Kein Avatar-Aufruf ohne vorherige Formatentscheidung.
- **Fehler:** Timeout beim Anlegen (Ergebnis unklar → kein zweiter POST), 429, Auth-Fehler (endgültig),
  Kontingent erschöpft (lokal ohne API-Aufruf oder vom Anbieter gemeldet), Job fehlgeschlagen, Job hängt
  (Standard 30 min), API down beim Abfragen (vorübergehend), ungültige Antwort.
- **Keine doppelte Generierung:** Nach `maxWaitMs` bleibt ein laufender Job mit seiner Anbieter-ID `in_progress`
  und wird später per ID weiter abgefragt, nie neu angelegt. Fertige Videos werden in den Blob-Store kopiert
  (Anbieter-URLs laufen ab) und wiederverwendet.
- **Fallback:** Avatar → Standard-Video → Karussell → Bild → Text. Die Pipeline bricht nicht ab.
- **HeyGen-Adapter, nicht live geprüft:** `POST /v2/video/generate`, `GET /v1/video_status.get` nach öffentlicher
  Dokumentation, nur mit Mocks getestet. Benötigt `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`,
  `HEYGEN_MONTHLY_VIDEO_LIMIT` (PENDING_USER_INPUT). Ohne Limit kein Avatar-Video.

## Phase 4 – Master Content, Plattform-Adapter, WhatsApp-Ablauf, Status

### Ablauf (`lib/topic-pipeline/orchestrator.ts`, einziger Verbinder aller Ebenen)

1. **Themenvorschlag** (Cron `/api/cron/topic-scout`, je Stunde idempotent): Scout → Jarvis-Gate → Router →
   Text (Referenz- oder KI-Modus) → **Dry-Run-Produktionsplan** (keine Kosten). WhatsApp-Vorschlag mit
   Kategorie, Format, Kosten, Plan, Quellen, Modus.
2. **„Freigeben“ auf den Vorschlag = nur Produktionsfreigabe.** Produktion über die Visual Engine; Textgrafiken
   werden zu PNG gerastert. Laufende Videos: Stufe `in_production`, Fortsetzung per Cron/„Status“ ohne neuen
   Anbieter-Auftrag.
3. **Master Content** → fünf Plattformvarianten → neue Version in der Freigabeschranke →
   **Veröffentlichungsfreigabe** (eigene Nachricht, zeigt Link, Kennzeichnung, Medien, Plattformen).
4. **„Freigeben“ auf genau diese Fassung** → `publishAll` über die Schranke → Rückmeldung
   „Themen-Post/Affiliate-Post, Format …“ mit Status und Link je Plattform. Bei ausgeschalteter
   Live-Veröffentlichung (Standard) nur Probelauf, nichts wird gepostet.

Wünsche auf Vorschlag oder Freigabe (deterministisch): Format, Slides, Kein Avatar, Weniger werblich, Mehr Humor,
Anderer Aufhänger (neue Hook-Variante, erneut von Jarvis geprüft), Neues Thema (verwirft, nächstes Thema),
Ohne Produkt. Nach der Produktion erzeugt jede Änderung eine neue Version (alte Freigabe ungültig) und eine
neue Freigabenachricht; fertige Bilder/Slides werden über das Job-Ledger wiederverwendet. Webhook-Wiederholungen
und fremde Absender werden ignoriert. Der bestehende semantische Router bleibt für Produkt-Entwürfe zuständig;
Antworten auf Themen-Nachrichten werden vor ihm erkannt, damit er sie nicht als fremde Entwürfe deutet.

### Optionale Produktkopplung (nicht fest verdrahtet)

- Standard: **Themen-Post ohne Produkt und ohne Affiliate-Link.**
- Nur auf ausdrücklichen WhatsApp-Wunsch („Such mir dazu ein passendes Produkt“, optional „… wie eine Heizdecke“)
  beauftragt der Orchestrator den **bestehenden Produkt-Trendscout** (`seedIdeas`/`scoutProducts`, hinter der
  Schnittstelle `ProductSuggester`) und schickt **höchstens drei** Kandidaten mit kurzer Begründung.
- Erst die Auswahl „Produkt N“ übernimmt ein Produkt. Die Amazon-Seite wird wie in der Produkt-Pipeline geprüft
  (`findAmazonProduct`), dann wird der Affiliate-Link mit Kennzeichnung „Werbung | Affiliate-Link“ eingefügt.
  Veröffentlicht wird weiterhin erst nach der separaten Freigabe genau dieser Fassung.
- Ohne Auswahl kein Link: `buildMasterContent` verwirft Affiliate-Daten ohne WhatsApp-Nachweis
  (Nachrichten-ID) oder mit unzulässiger URL.
- **Sensible Themen** (Katastrophen, Unfälle, Gewalt, Skandale, Promi-Klatsch, erhöhtes Risiko): keine
  Produktvorschläge, der Scout wird gar nicht gefragt; eine Auswahl wird erneut geprüft und abgelehnt.
- Weder Scout noch Orchestrator wählen jemals selbst ein Produkt oder einen Link.

### Master Content (`lib/distribution/master-content.ts`)

`topic`, `hook`, `message`, `body`, `cta`, `assets`, `carousel`, `video`, `caption`, `hashtags`,
`source_references`, `campaign`, `affiliate_data`, `disclosures`, `selected_format`, `category`.
Kennzeichnungen: „Werbung | Affiliate-Link“ bei Affiliate-Daten, „Bild mit KI erstellt“ bei generierten Medien.

### Plattform-Adapter (`lib/distribution/platforms/adapters.ts`)

`InstagramAdapter`, `FacebookAdapter`, `TikTokAdapter`, `YouTubeAdapter`, `XAdapter`: Textlänge (X 280 mit
t.co-Linklänge), Titel (YouTube ≤ 100), Hashtags (2–5), CTA, Linkstrategie, Medienformat, Seitenverhältnis,
Kennzeichnung. Formattransformation:

| Master | Instagram | Facebook | TikTok | YouTube Shorts | X |
| --- | --- | --- | --- | --- | --- |
| Text | – (braucht Medium) | Text | – | – | Text |
| Bild | Bild 4:5 | Bild | Foto-Slideshow 9:16 | – | Text + Bild |
| Karussell | echtes Karussell | Album | Foto-Slideshow | – (keine Videoableitung) | Text + max. 4 Bilder |
| Video/Avatar | Reel 9:16 | Video | Video | Short | Video |

Linkstrategie zentral (`lib/distribution/link-policy.ts`, überschreibbar mit `TOPIC_LINK_POLICY`, Kennzeichnung
nie abschaltbar): Facebook/X Link im Text, Instagram/TikTok/YouTube „Link im Profil“ (Ziel: bestehende
Landingpage `/produkte`, `TOPIC_LANDING_URL`). Themen-Posts verlinken auf Facebook/X die Quelle.

### Veröffentlichung (`lib/distribution/publish.ts`)

Jede Plattform isoliert; ein Ausfall stoppt die anderen nicht. Jeder Live-Versuch läuft über
`authorizePublish` + `assertPermitMatches`. Standard ist der Dry-Run (`TOPIC_LIVE_PUBLISHING` nicht `true`):
er zeigt je Plattform Format, Linkstrategie, Freigabestatus und fehlende Zugänge, ohne etwas zu beanspruchen.

Live-Clients: nur Facebook-Foto über die bestehende `publishFacebookPhoto`-Anbindung. Instagram (Karussell/Reel
der Themen-Pipeline), TikTok, YouTube und X haben vollständige Adapter und Dry-Run, aber noch keinen Live-Client
(PENDING_USER_INPUT, siehe unten).

### Status

„Status“ ergänzt die bestehende Antwort um: Pipeline an/aus, Live an/aus, Scout-Gesundheit, letzter
(erfolgreicher) Lauf, Trendquellen ok/gestört, Replicate/Avatar/Video verfügbar (inkl. Kontingent), letzter Bild-,
Karussell-, Videojob, Plattformadapter und Live-Zugänge, offene Vorschläge/Freigaben, letzter Fehler.

### Umgebungsvariablen (neu)

| Variable | Zweck | Standard |
| --- | --- | --- |
| `TOPIC_PIPELINE_ENABLED` | Themen-Pipeline (Cron, WhatsApp-Antworten) einschalten | aus |
| `TOPIC_LIVE_PUBLISHING` | echte Veröffentlichung statt Probelauf | aus |
| `TOPIC_COPY_MODE` | `ai` = ein Modellaufruf für Texte (Replicate), sonst Referenzmodus | Referenz |
| `TOPIC_PLATFORMS` | z. B. `instagram,facebook` | alle fünf |
| `TOPIC_LANDING_URL` | Ziel des Profil-Links | – |
| `TOPIC_LINK_POLICY` | JSON-Overrides der Linkregeln | – |
| `TOPIC_BRAND_PALETTE` | `#bg,#text,#akzent` | neutrale Palette |
| `TOPIC_SOURCE_GOOGLE_NEWS` / `_GOOGLE_TRENDS` / `_WIKIPEDIA` | `false` schaltet Quelle ab | an |
| `TOPIC_STANDARD_VIDEO_PROVIDER` | `runway` schaltet Standard-Video frei | aus |
| `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `HEYGEN_MONTHLY_VIDEO_LIMIT` | Avatar-Adapter | – |

Wiederverwendet: `TAVILY_API_KEY`, `REPLICATE_API_TOKEN`, `REPLICATE_IMAGE_MODEL`, `RUNWAYML_API_SECRET`,
`META_*`, `WHATSAPP_*`, `CRON_SECRET`, `DATABASE_URL`.

Für Live-Clients später nötig (PENDING_USER_INPUT): TikTok (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
`TIKTOK_ACCESS_TOKEN`, Content Posting API), YouTube (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
`YOUTUBE_REFRESH_TOKEN`), X (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`).

### Einschalten (PENDING_USER_APPROVAL, nicht durchgeführt)

1. PR mergen, deployen (Migrationen 028–031 laufen automatisch).
2. `TOPIC_PIPELINE_ENABLED=true` setzen; Cron-Eintrag für `/api/cron/topic-scout` in `vercel.json` ergänzen.
3. Erst nach Probeläufen ggf. `TOPIC_LIVE_PUBLISHING=true`.

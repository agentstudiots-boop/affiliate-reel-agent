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

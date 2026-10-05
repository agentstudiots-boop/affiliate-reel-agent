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

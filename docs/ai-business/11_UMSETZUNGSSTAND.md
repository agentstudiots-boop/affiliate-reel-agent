# Umsetzungsstand der AI-Business-Roadmap (Stand 23.10.2026, `main`)

Diese Datei ist der **maßgebliche aktuelle Überblick**. Die Dokumente 01–10 und die datierten Abschnitte in
[`coordination/README.md`](coordination/README.md) sind der historische Planungs- und Review-Verlauf; ihre Aussagen zu „Draft“,
„nicht mergen“ oder „Merge nur durch den Betreiber“ beschreiben den Stand ihres Datums.

**Begriffe** (wie `CLAUDE.md` §8, strikt getrennt):

| Begriff | Bedeutung |
|---|---|
| gemergt | auf `main` |
| deployed | im READY-Production-Deployment (Vercel), geprüft nach `RELEASE_CHECKLIST.md` (D-05) |
| Migration angewendet | in der Production-Datenbank nachgewiesen |
| aktiviert | Schalter oder Cron in Production gesetzt |
| live geprüft | mit echten Production-Aufrufen beobachtet |

Ein erfolgreicher Build oder grüne Tests sind kein Nachweis für den Livebetrieb.

## 1. Kurzfassung

- **Code:** Alle Roadmap-PRs gegen `main` sind gemergt (21.–23.10.2026) und deployed. Die Merges hat Claude Code mit Freigabe des
  Betreibers vom 21.10. ausgeführt. Vor jedem Merge liefen die vollen Prüfungen auf dem simulierten Ergebnis.
- **Migrationen 039–042:** in der Production-DB angewendet. Nachweis siehe §3.
- **Aktiviert:** nichts Neues. Die Schalter `EXECUTIVE_ENABLED`, `EXECUTIVE_WEEKLY_REPORT`, `EXECUTIVE_WHATSAPP`,
  `OPPORTUNITY_SCOUT_ENABLED` und `OPPORTUNITY_DAILY_LIMIT` sind nicht gesetzt (Vercel-Namensliste, 22.10.).
  `/api/cron/executive-cycle` steht nicht in `vercel.json`.
- **Live geprüft:** nur die Anwendung der Migrationen. Die neuen Funktionen selbst sind nicht live geprüft, weil sie aus sind.
- **Dokumentation:** Mit dem konsolidierten Doku-PR #126 (23.10.) liegen Architektur, Roadmap, Übergabedateien, Reviews und die
  Daten-/Rechtscheckliste auf `main`. Er ersetzt #81, #82 und #111. Diese Übernahme ist eine reine Doku-Freigabe des Betreibers,
  keine Architektur- oder Betriebsfreigabe.

## 2. Aufgaben

Quellen: PR-Tabelle in `coordination/README.md`, D-05-Tabelle in `docs/PROJECT_STATUS.md` §2 (Merge-Commits, Deployment-IDs),
Vercel-Deploymentliste.

Bei gestapelten PRs ist der Merge-Commit der des PRs, der sie auf `main` brachte. Beispiel: #86 kam mit #112, Merge `90f3737`.
Übergabedatei bedeutet `coordination/tasks/<ID>/task.json`; „–“ heißt, für die Aufgabe gibt es keine.

| Aufgabe | Inhalt | PR | Merge auf `main` | Wirkung in Production | Übergabedatei |
|---|---|---|---|---|---|
| A-01 | Architektur, Roadmap, Koordination (Doku) | #82 → #126 | 23.10. (#126) | – (Doku) | ja |
| A-02 | Unabhängige Architekturprüfung GPT Work (Doku) | #81 → #126 | 23.10. (#126) | – (Doku) | ja |
| B-01 | Plan-Vertrag, Richtlinien, Register | #84 | `f0187eb` (mit #96) | rein, ohne eigene Wirkung | ja |
| B-02 | Migration 039 Aufgabenbuch | #89 | `7257fd7` | Migration angewendet | ja |
| B-03 | Repository Aufgabenbuch | #90 | `90f3737` (mit #112) | nur hinter `EXECUTIVE_ENABLED` | ja |
| B-04 | Abteilungsvertrag | #86 | `90f3737` | rein | ja |
| B-05 | Budgetwächter | #91 | `90f3737` | nur hinter `EXECUTIVE_ENABLED` | ja |
| B-06 | Migration 041 Entscheidungsvorlagen (führt nichts aus) | #96 | `f0187eb` | Migration angewendet | ja |
| B-07 | Executive-Zyklus + Cron-Route | #98 | `90f3737` | **aus**: `EXECUTIVE_ENABLED` fehlt, Route nicht geplant | ja |
| B-08 | KI-Planer im Schattenbetrieb | #99 | `90f3737` | nicht eingebunden | ja |
| B-09 | Monatsgrenze nur aus freigegebenem Budget | #104 | `90f3737` | nur hinter `EXECUTIVE_ENABLED` | ja |
| B-10 | Executive-Abschnitt im Wochenbericht | #114 | `9023e64` | **aus**: `EXECUTIVE_WEEKLY_REPORT` fehlt | ja |
| B-11 | WhatsApp-Befehl „Executive“ (nur lesend) | #117 | `4c976e7` | **aus**: `EXECUTIVE_WHATSAPP` fehlt | ja |
| C-01 | Übergabestruktur (`coordination/`) | #82 → #126 | 23.10. (#126) | wird vom Command Center gelesen (D-06) | – |
| C-02, C-03 | Validator + CI-Schritt | – | – | **zurückgestellt** (04 §C) | – |
| C-04 | PR-Vorlage | #101 | `f5ad79b` | – (Repo) | – |
| D-01 | Claude-Routine „Review-Wache“ | – | – | **nicht eingerichtet**; die Routine wurde am 19.10. gelöscht | – |
| D-02, D-03, D-07, D-08 | GPT-Automatisierung, Review-Action, Reviewer-Identität, Ereignis-Trigger | – | – | offen, Betreiberentscheidungen (BF-15 u. a.) | – |
| D-04 | Branch-Schutz `main` | – | – | **nicht eingerichtet**; `CLAUDE.md` §1: kein Branch-Schutz | – |
| D-05 | Release-Checkliste | #95 | `5f59d36` | – (Doku, wird angewendet) | – |
| D-06 | Entwicklungsstand aus den Übergabedateien | #110 | `90f3737` | **zeigt Daten erst ab #126**: vorher lag kein `coordination/tasks/` auf `main` | ja |
| E-01 | Migration 040 Kosten-/Erlösbuch | #92 | `ca4a986` | Migration angewendet | ja |
| E-02 | Preiskatalog-Pflege | #108 | `b5d4dcf` | nicht eingebunden | ja |
| E-03 | Importer `model_calls` → `cost_entries` | #93 | `90f3737` | nicht eingebunden | ja |
| E-04 | Manuelle Belege/Erlöse/CSV-Import | #107 | `b5d4dcf` (mit #108) | nicht eingebunden | ja |
| E-05 | Kennzahlen-Formeln | #83 | `c29815c` (mit #97) | rein | ja |
| E-06 | Abteilungszuordnung `model_calls` | #88 | `90f3737` | lesend, wirkt in den Übersichten | ja |
| E-07 | ControllingSnapshot + Anzeige | #100 | `90f3737` | lesend (Command Center, `/api/operations`) | ja |
| F-01 | Bewertungsraster | #85 | `c29815c` (mit #97) | rein; **ohne Gewichte (Q-07) keine Empfehlung** | – |
| F-02 | Migration 042 + Opportunity-Ledger | #118 | `a8ce404` | Migration angewendet; Ledger nur hinter Schalter beschrieben | ja |
| F-03 | Recherche (Tavily + ein Modellaufruf, begrenzt) | #119 | `0d2f632` | **aus**: `OPPORTUNITY_SCOUT_ENABLED` fehlt | ja |
| F-04 | Wirtschaftlichkeitsrechnung | #97 | `c29815c` | rein; ohne Betreiber-Grenzen kein Test empfohlen | ja |
| F-05 | WhatsApp „Geschäftsidee prüfen: …“ | #120 | `a736bf4` | **aus**: `OPPORTUNITY_SCOUT_ENABLED` fehlt | ja |
| F-06 | Wöchentliche Beobachtung | – | – | optional, nicht gebaut | – |
| G-01 | Affiliate-Adapter (nur lesend) | #87 | `90f3737` | nur im Executive-Zyklus (aus) | ja |
| G-02 | Aufgabenart `affiliate.status_report` | – | – | durch G-01 (`handle()`) und B-07 abgedeckt (`coordination/README.md`) | – |
| G-03 | `affiliate.manual_order` | – | – | optional, nicht gebaut | – |
| H-01, H-02 | Unternehmensebene als lesender Datenvertrag (`/api/architecture` → `enterprise`) | #102 | `90f3737` | lesend hinter Login; Inhalte mit Produktionsdaten von keiner Sitzung gesehen | ja (H-01) |
| H-03 | Planetenebene in der 3D-Szene | #109 | `90f3737` | lesend; Sichtabnahme Betreiber 21.10. | ja |
| H-04, H-05 | Ansicht „Unternehmen“ (2D, Detailpanel) | #103 | `90f3737` | lesend; Sichtabnahme Betreiber 21.10. | ja (H-04) |
| I-01 | Bewertung „Immobilienanalyse“ | #115 | `b91ff44` | Ergebnis **„Daten fehlen“** (`I01_BEWERTUNG_IMMOBILIENANALYSE.md`) | – |
| I-02 | Datenquellen- und Rechtscheckliste | #111 → #126 | 23.10. (#126) | Vorlage, keine Rechtsberatung (`10_DATENQUELLEN_RECHTSCHECKLISTE.md`) | ja |
| I-03 | Abteilungsskelett Immobilienanalyse | – | – | **nicht gebaut**: nur nach Go auf I-01 | – |
| J-01 | Ende-zu-Ende-Szenarien (Tests) | #105 | `b7d1089` (mit #106) | – (Tests) | ja |
| J-02 | Härtung (Obergrenzen, Importer-Sperre) | #112 | `90f3737` | wie die gehärteten Bausteine | ja |
| J-03 | Kostenobergrenzen unter Retries (Tests) | #106 | `b7d1089` | – (Tests) | ja |
| J-04 | Lasttest gegen echtes Postgres (Tests) | #113 | `2bd4772` | – (Tests; ohne `J04_DATABASE_URL` übersprungen) | ja |
| J-05 | Preview-Lauf mit isolierten Ressourcen (Leitfaden, Skripte) | #116 | `06ae6cc` | – (`J05_PREVIEW_LAUF.md`, Betreiber führt aus) | – |

Für D-05, C-04, F-01, I-01 und J-05 gibt es keine Übergabedatei. Sie wurden ohne eigene Übergabedatei umgesetzt (zweite Sitzung bzw.
Doku), ihr Stand steht in den PRs. Das Command Center (D-06) zeigt deshalb nur die Aufgaben mit Übergabedatei.

Die Übergabedatei von **A-02** schreibt nur GPT Work (Regel in `coordination/README.md`). Sie steht deshalb unverändert auf
`in_review`, obwohl der Inhalt mit #126 auf `main` liegt. A-01 behält das letzte Review-Ergebnis von GPT Work
(`changes_requested`, `tasks/A-01/review-2.json`) als historischen Stand. Es wurde kein neues Review erstellt oder angenommen.

### Weitere gemergte Änderungen außerhalb der Aufgabenliste

| PR | Inhalt | Merge | Production |
|---|---|---|---|
| #94 | Videomodellaufrufe in `model_calls` | `e270bcc` | deployed; wirkt nur bei Videoaufrufen (keiner beobachtet) |
| #121 | Doku: Projektstand und Schalterliste | `c677759` | deployed (Doku) |
| #122 | DIAG-MODEL Stufe A: Diagnose der Redaktionsmodell-Fehler | `ab77937` | deployed; erste Daten 23.10. 07 UTC (zu lange Freitextfelder) |
| #123 | Command Center: Migrationen 001–042 als belegt | `d6217f9` | deployed |
| #124 | **Sicherheit:** Next.js 16.3.8 → 16.4.2 (GHSA-2464-fhr4-w9xw u. a.) | `1fe0bb2` | deployed; Cron-Läufe unter 16.4.2 am 23.10. ohne Fehler, Login/Webhook noch ohne Nachweis |
| #125 | DIAG-MODEL Stufe B: zu lange interne Freitexte kürzen statt verwerfen | `07f3987` | deployed (`dpl_81nfxtja2LJfyVKk3hQ5xYfWFxrR` READY); Wirkung noch nicht beobachtet |

Deployment-IDs je Merge stehen in `docs/PROJECT_STATUS.md` §2.

## 3. Nachweis der Migrationen 039–042

- **039–041:** waren am 22.10. vor 15:50:56 UTC bereits in `schema_migrations` eingetragen. Der Aufruf des Betreibers meldete sie
  als vorhanden (Log `alreadyApplied`). Der genaue Zeitpunkt ihrer Anwendung ist nicht belegt; wahrscheinlich war es der erste
  Cron- oder Webhook-Aufruf nach dem Merge am 21.10.
- **042:** am **22.10.2026 um 15:50:56 UTC** angewendet. Der Betreiber hat sie angemeldet über `/api/admin/migrate` ausgelöst; der
  Production-Laufzeitlog `database_migration` meldet `applied: ["042_opportunities.sql"]`. Die zweite Sitzung hat den Log
  ausgelesen, nur lesend.
- **Bestätigung:** Zwei Folgeaufrufe meldeten „Schema bereits aktuell“ für 001–042 (Screenshot des Betreibers vom 22.10.).
- **Bedeutung:** Damit sind nur die **Tabellen** angelegt. Beschrieben werden sie nur hinter den Schaltern oben.

## 4. Offen: Entscheidungen des Betreibers

| Punkt | Wirkung, solange offen | Fundstelle |
|---|---|---|
| **Q-07** Gewichte, Schwellen und Ausschlusskriterien des Bewertungsrasters, Amortisationsgrenze | Jede Bewertung ist „blocked“; kein Test wird empfohlen (`lib/enterprise/opportunity/operator-config.ts` = `null`) | 07, I-01 |
| **I-03** Ausbau Immobilienanalyse | Nicht gebaut. Voraussetzung: Go auf I-01, Zuschnitt, Recherchebudget, rechtliche Prüfung (K.O.-Fragen aus I-02) | I-01, 10 |
| Aktivierung der Schalter (Executive, Opportunity Scout) und Planung `executive-cycle` | Funktionen bleiben aus. Der Betreiber hat am 21.10. „erst mal aus lassen“ entschieden | `CLAUDE.md` §8 |
| **BF-16** (ADR-01, ADR-13 … ADR-16) als Teil von Gate G0 | **Formal nicht als entschieden dokumentiert.** Der Code wurde mit Betreiberfreigaben vom 19. und 21.10. gebaut und gemergt. Die Doku-Übernahme vom 23.10. ist ausdrücklich keine Architekturfreigabe | 04 §1, 07 |
| D-01 … D-04, D-07, D-08, BF-14, BF-15, BF-05 | Prozess und Infrastruktur unverändert | 04 §D, 07 |
| `DATABASE_URL` mit `sslmode=verify-full` | Bekannter `pg`-SSL-Hinweis in jedem Lauf | `docs/PROJECT_STATUS.md` §5 |

## 5. Offen: Live-Nachweise

- Login und WhatsApp-Webhook unter Next.js 16.4.2. Seit dem Deploy am 22.10. lag bis 23.10. morgens kein Aufruf vor.
- Wirkung von #125 auf die Tagesentwürfe: Kürzungen (`editorial_model_soft_trim`) und verbleibende Fehler. Die Auswertung
  der zweiten Sitzung beginnt nach dem daily-draft am 23.10. um 16 UTC.
- Command Center: Unternehmensebene und Entwicklungsstand mit Produktionsdaten. Keine Sitzung hat sie gesehen, weil der Login nur
  beim Betreiber liegt.
- Alle abgeschalteten Funktionen: erst nach Aktivierung durch den Betreiber.

## 6. Nächster Arbeitsauftrag (vom Betreiber am 23.10. festgelegt, am 24.10. gestartet)

Die **Themen-Pipeline** für „Alltäglich leichter“ wird ausgerichtet auf:

- alltagsnahes Storytelling,
- Aha-Effekte, Humor und Emotionen,
- hilfreiche Hacks,
- eigene WhatsApp-Themenvorschläge,
- eine sinnvolle Kombination aus Recherche und kreativer Generierung.

Ausgangslage: Die Themen-Pipeline ist in Production aktiv. Am 23.10. um 07:15 UTC erzeugte der Cron einen Vorschlag
(`topic_cron_completed status=proposed`); er wurde gehalten, weil das WhatsApp-Servicefenster geschlossen war. Die Beobachtung
stammt aus den Laufzeitlogs der zweiten Sitzung.

Stand 27.10.:

- **P1a „eigene WhatsApp-Themenvorschläge“: gemergt (#130) und deployed, nicht aktiviert.** Der Betreiber schreibt „Mach etwas über X“,
  „Thema: X“ oder „Erstelle einen Beitrag zum Thema X“. Daraus entsteht ein normaler Themenvorschlag mit doppelter Freigabe
  (`lib/topic-pipeline/topic-order.ts`, `requestTopicOrder`).
  - Übergangen werden nur redaktionelle Schwellen; sie werden im Vorschlag genannt.
  - Schutzprüfungen gelten weiter: Fakten, Risiko, Klatsch, unbelegte Aussagen. Sensible Themen ohne Quelle werden abgelehnt.
  - Eigener Schalter `TOPIC_ORDERS_ENABLED` (Rollout-Wert in `lib/config/rollout.ts`), Standard aus. Tageslimit `TOPIC_ORDERS_PER_DAY`, Standard 5, höchstens 10.
  - Die Aktivierung kommt als eigener PR.
- **P1b (redaktionelle Ausrichtung): implementiert und getestet, nicht gemergt.** `lib/topics/editorial.ts` gibt jedem Thema eine
  Erzählweise: Mini-Geschichte, Aha-Moment, Humor, Gefühl oder Alltagskniff.
  - Die Auswahl hängt vom Thementyp ab und ist je Thema stabil; eine neue Variante wechselt die Erzählweise.
  - Kein Humor und kein Kniff bei sensiblen Themen oder Klatsch, kein Gefühl bei sensiblen Themen.
  - Ein Aha-Moment nur mit Quelle: der Publisher wird genannt, und es steht nur, was wörtlich im Quellentitel steht.
  - Geschichte und Kniff nur, wenn der Text vom Modell kommt (`TOPIC_COPY_MODE=ai`), weil der Regeltext sie nicht einlösen kann.
  - Ein Kniff-Text mit Risikobezug (Chemie, Strom, Gas, Feuer, Lebensmittel, Schimmel, Medikamente) fällt auf den Regeltext zurück.
  - Referenzmodus: passender Hook, Winkel und Abschlussfrage. KI-Modus: eine Leitlinie zusätzlich zu den unveränderten Regeln gegen Erfindungen.
  - Im Vorschlag steht „Erzählweise: …“.
  - Schalter `TOPIC_EDITORIAL_STYLE` (Rollout-Wert in `lib/config/rollout.ts`, Standard aus). Ohne Schalter sind alle Texte unverändert.

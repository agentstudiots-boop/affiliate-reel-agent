# 07 – Offene Fragen, Risiken, Architekturentscheidungen, Betreiberfreigaben

Kennungen: **Q** = offene Frage · **R** = Risiko · **ADR** = Architekturentscheidung · **BF** = notwendige Betreiberfreigabe.
Runde 2 (18.10.2026): Bewertung der GPT-Befunde (§0), ADRs angepasst bzw. ergänzt (ADR-01, -03, -04, -12 geändert; ADR-13 … -16 neu).

## 0. Bewertung der GPT-Befunde aus PR #81 (`tasks/A-01/review-1.json`) durch Claude Code

Unabhängig gegen den Code auf `main` = `c56711e` geprüft. Maschinenlesbar: `tasks/A-01/task.json` → `responses_to_review`.

| Befund | Schwere (GPT) | Bewertung | Begründung / Korrektur |
|---|---|---|---|
| GPT-01 Executive „nur Sprache“ widerspricht Betreiberziel | blocker | **akzeptiert** | Hybrid-Executive: KI plant, analysiert, priorisiert, entscheidet im Mandat L0–L2; Kern validiert (02 §3, ADR-01 neu). Die Aussage „Jarvis rein regelbasiert“ war falsch (`lib/content/orchestrator.ts:172`, `:217`) – in 01 korrigiert. |
| GPT-02 Zyklus E-07 ↔ H | major | **akzeptiert** | Controlling liefert `ControllingSnapshot` und zeigt ihn in der 2D-Übersicht; H konsumiert nur (02 §9, 04 §1). |
| GPT-03 Schema ohne Wartezustände/Lease/Kriterien/Budget, `foreign_paths` | major | **akzeptiert**, Validator **teilweise abgelehnt** | Schema Revision 2 additiv ergänzt, `decision.schema.json` neu. Ein CI-Validator wird nicht jetzt gebaut, sondern erst bei nachgewiesenem Engpass (Betreiberauftrag „gezielt automatisieren“). |
| GPT-04 Baum-Claim, keine atomare Übernahme | major | **akzeptiert** | Datei-genaue Zuständigkeit in `ownership.json`; A-01-Claim verengt. Atomarität über den Git-Ref (Fast-Forward-Push/`expected_sha`) statt eines neuen Lease-Dienstes (ADR-13). |
| GPT-05 gemeinsames GitHub-Konto | major | **akzeptiert**, Vorbedingung **abgelehnt** | Bestätigt: PR #74–#81 alle von `agentstudiots-boop`. Übergangsregel: Review = `review-<n>.json` + PR-Kommentar mit SHA, Vertrauensanker Betreiber-Merge (ADR-14). Eigene Identität mittelfristig (D-07, BF-15), aber keine Voraussetzung für den ersten Baustein. |
| GPT-06 Idempotenz ≠ genau-einmal extern | major | **akzeptiert** | Outbox, `outcome_unknown`, Fencing, Abgleich statt Wiederholung (02 §1 Nr. 8, §4.2, §5). Muster existiert bereits (`provider_usage`, Publisher-Statusabgleich). |
| GPT-07 `model_calls` kein Budgetwächter | major | **akzeptiert**; Rechnungsabgleich als Vorbedingung **teilweise abgelehnt** | Code bestätigt (`lib/observability/model-calls.ts:38` verschluckt Speicherfehler). Harte Grenze = `budget_reservations` (B-05). Rechnungsabgleich folgt in E-04, blockiert aber nicht E-05/E-07, solange die Anzeige „unvollständig“ ausweist. |
| GPT-08 Bestandsaufnahme veraltet | major | **akzeptiert** | 038, 12 Crons, PR #78–#80 in 01 und `ownership.json` nachgezogen. |
| GPT-09 Vercel Hobby nichtkommerziell | major | **akzeptiert (Fakt, Quelle von GPT, nicht erneut abgerufen)**; Einordnung geändert | Betrifft schon das heutige Affiliate-Studio. Keine Architekturfrage, sondern Betreiberentscheidung BF-14; kein eigenständiger Tarifwechsel. |
| GPT-10 L3 zirkulär | minor | **akzeptiert** | Aufteilung L3a (vorab autorisierte Mitteilung an den Betreiber) / L3b (Außenwirkung) (02 §3.5). |
| GPT-11 „0 €“ unbelegt | minor | **akzeptiert** | „keine zusätzlichen Anbieterkosten; DB-/Hosting-/Entwicklungsaufwand ungemessen“ (03 §3). |
| GPT-12 Kalender dominiert, M1 doppeldeutig | minor | **akzeptiert** | Roadmap auf DAG + eindeutige Gates G0–G6 umgestellt, keine Kalenderwochen (04). |

Vollständig abgelehnt wurde kein Befund. Abweichungen von GPT (zur Entscheidung durch den Betreiber, ADR-16): erster Code-Baustein ist
**nicht** der Koordinations-Validator C-02, sondern ein fachlicher Baustein des Unternehmens (B-01 ∥ E-05), damit die Koordination nicht
zum Hauptprojekt wird.

## 1. Architekturentscheidungen (zur Entscheidung in A-06)

| ID | Entscheidung | Empfehlung | Alternativen |
|---|---|---|---|
| ADR-01 | **Hybrid-Executive:** KI für Planung, Analyse, Priorisierung und Entscheidungen im Mandat (L0–L2, reserviertes Budget); deterministischer Kern validiert Pläne, leitet Stufen ab, reserviert Budget; organisatorisch unabhängig vom Affiliate-Jarvis; zuerst Schattenbetrieb (geändert, GPT-01) | **annehmen** | rein regelbasiert (verfehlt Betreiberziel); frei wirkendes LLM (unsicher) |
| ADR-02 | Executive erhält **kein** Freigaberecht; `ACTIVE_APPROVAL_AUTHORITIES` bleibt `["whatsapp_operator"]` | **annehmen** | – |
| ADR-03 | Berechtigungsstufen L0, L1, L2, L3a, L3b, L4 im Code; Stufe aus der Aktion abgeleitet; L4 nur Betreiber außerhalb des Systems (geändert, GPT-10) | **annehmen** | – |
| ADR-04 | Engineering arbeitet mit Claude-Code- und Codex-Agenten außerhalb der Production-App, Rollen Planung/Implementierung/Prüfung getrennt; GitHub/Vercel-Rechte später eng und eigene Identität | **annehmen** | Laufzeit-Agent mit Repo-Token in der App (abgelehnt, Sicherheitsrisiko) |
| ADR-05 | Controlling ohne KI | **annehmen** | – |
| ADR-06 | Aufgabenwarteschlange in Postgres, kein externer Broker | **annehmen** | Queue-Dienst (Kosten, neue Abhängigkeit) |
| ADR-07 | Neue Tabellen mit Präfix, nur additiv; bestehende Tabellen bleiben unverändert bis Phase G | **annehmen** | – |
| ADR-08 | Abteilungsregister als statischer Code statt DB-Tabelle | **annehmen** | DB-Register (änderbar ohne Review – unerwünscht) |
| ADR-09 | Übergabedateien je Aufgabe mit Schreibrecht je Datei (Implementierer/Prüfer/Betreiber) | **annehmen** | eine zentrale Datei (Konflikte, Überschreiben) |
| ADR-10 | Kein Auto-Merge für Code; optional für Doku/Koordination nach Phase D | **annehmen** | Auto-Merge mit Review-Bot (Merge = Production-Deploy) |
| ADR-11 | Immobilien-Abteilung erst nach Machbarkeits- und Rechtsprüfung | **annehmen** | sofortiger Aufbau |
| ADR-12 | Gate G4 trennt Messreife, Verlust-/Erkundungsbudget und Ausbauentscheidung; kleiner Recherche-Pilot schon vorher erlaubt (geändert, GPT-Review D.6) | **annehmen** | starres Go/No-Go |
| ADR-13 | Lease/Statuswechsel als Fast-Forward-Commit auf den Koordinationsbranch (atomarer Git-Ref, `generation` als Fencing); inhaltliche Änderungen weiter per PR | **annehmen** | zentraler Lease-Dienst/DB (neue Infrastruktur); Read-then-write ohne Ref-Prüfung (nicht atomar) |
| ADR-14 | Übergang bis zur eigenen Reviewer-Identität: Review = `review-<n>.json` + PR-Kommentar mit geprüfter SHA; Betreiber-Merge ist Vertrauensanker; keine technische Merge-Sperre behaupten | **annehmen** | sofort Machine User/App (Einrichtungsaufwand, BF-15) |
| ADR-15 | **Ein** Engineering-System mit je Aufgabe vergebenen Rollen (Planer, Implementierer, Prüfer), Modelle austauschbar; Neubewertung nach ca. 5 Paketen anhand der Messgrößen in 05 §2 (Prüfpunkt aus Betreiberbeschluss `aa6ce5a`) | **annehmen** | zwei eigenständige Engineering-Systeme (doppelte Infrastruktur) |
| ADR-16 | Erster Code-Baustein: **B-01** (Claude plant, Codex implementiert, Claude prüft) parallel zu **E-05** (Codex plant, Claude implementiert, Codex prüft); Validator C-02 zurückgestellt | **annehmen** | C-02 zuerst (GPT-Vorschlag, 09 §K) |

## 2. Offene Fragen

| ID | Frage | Wer klärt | Bis |
|---|---|---|---|
| Q-01 | Wie viele Review-/Freigabefenster hat der Betreiber pro Woche im Winter? Welche Wochen sind Saisonspitze? | Betreiber | A-06 |
| Q-02 | ~~Was ist GPT Work?~~ **beantwortet (A-02):** ChatGPT Work/Codex (Web/Cloud), GitHub über Connector unter `agentstudiots-boop`. Offen: Tarif/Limits | Betreiber | – |
| Q-03 | Soll das Repository privat werden? (öffentlich ⇒ keine Geschäftsdaten im Repo; privat ⇒ Branch-Schutz ggf. kostenpflichtig) | Betreiber | A-06 |
| Q-04 | Vercel Hobby: laut Doku nur nichtkommerziell (A-02, S2). **Offen nur noch die Entscheidung** → BF-14 | Betreiber | vor weiterer kommerzieller Nutzung |
| Q-05 | Welche Einnahmequellen gibt es real (Amazon-Provisionen, Höhe, Export-Möglichkeit)? Provisionssätze je Kategorie? | Betreiber | Phase E |
| Q-06 | Welche Abos/Infrastrukturkosten fallen monatlich an (Vercel, Neon, Replicate, Tavily, Claude, GPT, Meta-WhatsApp-Gebühren)? | Betreiber | Phase E |
| Q-07 | Gewichte des Opportunity-Bewertungsrasters; Ausschlusskriterien (Branchen, Mindestkapital, Risikobereitschaft)? | Betreiber | Phase F |
| Q-08 | Monatsbudgets je Abteilung (hart) | Betreiber | Phase B-05 |
| Q-09 | Welche Geschäftsbereiche außer Immobilien sind gewünscht? | Betreiber | Phase F |
| Q-10 | GPT Work: PR **ja (getestet)**; Review-Werkzeug vorhanden, ungetestet; Ereignis-Trigger verfügbar, nicht eingerichtet | D-08 | bei Bedarf |
| Q-11 | GPT Work: Komprimierung vorgesehen, Prozentmessung nicht verfügbar; Kontextgröße unbekannt | – | – |
| Q-12 | ~~Video-Sitzung~~ **beantwortet:** PR #78–#80 gemergt, letzte Migration 038 | – | – |
| Q-13 | Sollen Executive-Berichte außerhalb des 24-h-Fensters per genehmigter WhatsApp-Vorlage zugestellt werden (Kosten je Nachricht)? | Betreiber | Phase B-08 |
| Q-14 | Ist die GitHub-Action für Claude-Reviews (API-Kosten) gewünscht? | Betreiber | Phase D |

## 3. Technische Risiken

| ID | Risiko | Wahrscheinlichkeit | Wirkung | Gegenmaßnahme |
|---|---|---|---|---|
| R-01 | Merge-Konflikte mit der Video-Sitzung in Hot Files | hoch | mittel | Claims, Hot-File-Liste, Phase H nach Video-Merge |
| R-02 | Migrationsnummer doppelt vergeben | mittel | hoch (Schema-Prüfung schlägt fehl) | Reservierung in `ownership.json` |
| R-03 | Kostenspirale durch Cron + Retries | mittel | hoch | Budgets hart, max. Versuche, keine Ersatzroute |
| R-04 | Prompt-Injection über Rechercheinhalte | mittel | hoch | Modellausgaben ohne Berechtigungswirkung, Tests |
| R-05 | Geschäftsdaten gelangen ins öffentliche Repo | mittel | hoch | Regel + Review-Punkt; optional Secret-/Datenscan in CI |
| R-06 | Betreiber-Engpass staut PRs | hoch | mittel | WIP-Limit, kleine PRs, Pufferzeit Weihnachten |
| R-07 | Übergabedateien veralten / werden überschrieben | mittel | mittel | Revision + Schreibrecht je Datei + Validator |
| R-08 | GPT-Work-Fähigkeiten geringer als angenommen | mittel | mittel | Betreiber als Übergabeglied; Plan funktioniert auch manuell |
| R-09 | Anbieterabhängigkeit Replicate/Tavily/Vercel/Neon | niedrig | hoch | bestehende Abstraktionen; keine neuen Anbieter ohne Entscheidung |
| R-10 | Vercel-Hobby-Bedingungen/Grenzen | unbekannt | mittel | Q-04 |
| R-11 | Fehlende Erlösdaten machen Controlling/Scout aussagelos | hoch | hoch | M5-Gate, ehrliche „unbekannt“-Anzeige |
| R-12 | Zu viele WhatsApp-Meldungen | mittel | mittel | Bündelung, Drosselung |
| R-13 | Rechtliche Risiken neuer Geschäftsfelder (Beratungsrecht, Datenlizenzen, Datenschutz) | mittel | hoch | Checkliste, keine Datenbeschaffung ohne L4-Freigabe; keine Rechtsberatung durch das System |
| R-14 | Cloud-Sitzung endet ohne gepushten Checkpoint | mittel | mittel | Checkpoint-Regeln (05, §8) |
| R-15 | Gemeinsames GitHub-Konto: Reviews/Urheberschaft sind Selbstauskünfte | sicher (Ist-Zustand) | mittel | ADR-14, D-07 |
| R-16 | Externe Wirkung mit unklarem Ausgang wird doppelt ausgelöst | mittel | hoch | Outbox, `outcome_unknown`, keine automatische Wiederholung |
| R-17 | Koordination wird zum Hauptprojekt | mittel | hoch | ADR-16, Validator zurückgestellt, Automatisierung nur bei gemessenem Engpass |
| R-18 | Ein System ist längere Zeit am Abo-Limit (keine Zusatz-Credits, `e7692d0`); Reviews stauen sich, und das verfügbare System könnte versucht sein, eigene Arbeit selbst freizugeben | hoch (aktuell GPT Work) | mittel | `waiting_capacity` + Checkpoint; nur andere Aufgaben übernehmen; keine Selbstfreigabe, kein Merge nur wegen grüner CI |

## 4. Ungeklärte Abhängigkeiten

- Video-Sitzung: Änderungen an `lib/architecture/*`, Migrationen, Router/Webhook (Q-12).
- YouTube-/Meta-/HeyGen-Blocker aus `docs/PROJECT_STATUS.md` betreffen die Affiliate-Abteilung, nicht den Kern; sie verzögern G-03 nicht.
- Erlösdaten (Q-05) für E und F.
- GPT-Work-Integration (Q-02, Q-10, Q-11) für C/D.

## 5. Notwendige Betreiberfreigaben

| ID | Freigabe | Phase |
|---|---|---|
| BF-01 | Freigabe dieser Planung (oder Änderungswünsche) | A |
| BF-02 | Merge des Planungs-PRs (nur Doku) | A |
| BF-03 | Entscheidung ADR-01 … ADR-12 | A |
| BF-04 | Branch-Schutz/Ruleset für `main` | C/D |
| BF-05 | Repository-Sichtbarkeit (Q-03) | A |
| BF-06 | Einrichtung einer Claude-Code-Routine für Reviews (verbraucht Kontingent) | D |
| BF-07 | GitHub-Action mit API-Schlüssel (Kosten) | D |
| BF-08 | Jede neue Migration (Merge = automatische Anwendung in Production) | B, E, F |
| BF-09 | Preise im Preiskatalog und Monatsbudgets | E |
| BF-10 | Aktivierung jedes neuen Schalters (`EXECUTIVE_ENABLED`, Scout-Cron …) | nach J |
| BF-11 | Recherchebudget Opportunity Scout | F |
| BF-12 | Go/No-Go M5 | G/F |
| BF-13 | Aufbau einer weiteren Geschäftseinheit (Immobilien) | I |
| BF-14 | Hosting-Tarif angesichts der Vercel-Hobby-Bedingungen (betrifft schon das Affiliate-Studio) | sofort |
| BF-15 | Eigene GitHub-Identität (Machine User oder App) für mindestens ein System | D |
| BF-16 | Freigabe ADR-01, ADR-13 … ADR-16 und Start von B-01/E-05 (= Gate G0) | jetzt |

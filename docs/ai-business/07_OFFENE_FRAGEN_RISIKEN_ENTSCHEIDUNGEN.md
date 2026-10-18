# 07 – Offene Fragen, Risiken, Architekturentscheidungen, Betreiberfreigaben

Kennungen: **Q** = offene Frage · **R** = Risiko · **ADR** = Architekturentscheidung · **BF** = notwendige Betreiberfreigabe.

## 1. Architekturentscheidungen (zur Entscheidung in A-06)

| ID | Entscheidung | Empfehlung | Alternativen |
|---|---|---|---|
| ADR-01 | Executive als deterministischer Kern + KI nur für Sprache | **annehmen** | LLM-gesteuerter Executive (teurer, nicht reproduzierbar) |
| ADR-02 | Executive erhält **kein** Freigaberecht; `ACTIVE_APPROVAL_AUTHORITIES` bleibt `["whatsapp_operator"]` | **annehmen** | – |
| ADR-03 | Berechtigungsstufen L0–L4 im Code; L4 nur Betreiber außerhalb des Systems | **annehmen** | – |
| ADR-04 | Engineering ist Prozess + Werkzeuge im Repo, **kein** Laufzeit-Agent auf Vercel | **annehmen** | Laufzeit-Agent mit Repo-Token (abgelehnt, Sicherheitsrisiko) |
| ADR-05 | Controlling ohne KI | **annehmen** | – |
| ADR-06 | Aufgabenwarteschlange in Postgres, kein externer Broker | **annehmen** | Queue-Dienst (Kosten, neue Abhängigkeit) |
| ADR-07 | Neue Tabellen mit Präfix, nur additiv; bestehende Tabellen bleiben unverändert bis Phase G | **annehmen** | – |
| ADR-08 | Abteilungsregister als statischer Code statt DB-Tabelle | **annehmen** | DB-Register (änderbar ohne Review – unerwünscht) |
| ADR-09 | Übergabedateien je Aufgabe mit Schreibrecht je Datei (Implementierer/Prüfer/Betreiber) | **annehmen** | eine zentrale Datei (Konflikte, Überschreiben) |
| ADR-10 | Kein Auto-Merge für Code; optional für Doku/Koordination nach Phase D | **annehmen** | Auto-Merge mit Review-Bot (Merge = Production-Deploy) |
| ADR-11 | Immobilien-Abteilung erst nach Machbarkeits- und Rechtsprüfung | **annehmen** | sofortiger Aufbau |
| ADR-12 | Meilenstein M5 „Wirtschaftlichkeitsnachweis“ als Go/No-Go für F und I | **annehmen** | ohne Gate weiterbauen |

## 2. Offene Fragen

| ID | Frage | Wer klärt | Bis |
|---|---|---|---|
| Q-01 | Wie viele Review-/Freigabefenster hat der Betreiber pro Woche im Winter? Welche Wochen sind Saisonspitze? | Betreiber | A-06 |
| Q-02 | Was genau ist „GPT Work“ (Produkt, Tarif, Zugang zu GitHub: eigenes Konto/App oder Betreiberkonto)? | Betreiber | A-03 |
| Q-03 | Soll das Repository privat werden? (öffentlich ⇒ keine Geschäftsdaten im Repo; privat ⇒ Branch-Schutz ggf. kostenpflichtig) | Betreiber | A-06 |
| Q-04 | Ist der Vercel-Hobby-Plan für den geplanten kommerziellen Betrieb zulässig? Wann Wechsel auf Pro? | GPT Work recherchiert, Betreiber entscheidet | A-07 |
| Q-05 | Welche Einnahmequellen gibt es real (Amazon-Provisionen, Höhe, Export-Möglichkeit)? Provisionssätze je Kategorie? | Betreiber | Phase E |
| Q-06 | Welche Abos/Infrastrukturkosten fallen monatlich an (Vercel, Neon, Replicate, Tavily, Claude, GPT, Meta-WhatsApp-Gebühren)? | Betreiber | Phase E |
| Q-07 | Gewichte des Opportunity-Bewertungsrasters; Ausschlusskriterien (Branchen, Mindestkapital, Risikobereitschaft)? | Betreiber | Phase F |
| Q-08 | Monatsbudgets je Abteilung (hart) | Betreiber | Phase B-05 |
| Q-09 | Welche Geschäftsbereiche außer Immobilien sind gewünscht? | Betreiber | Phase F |
| Q-10 | Kann GPT Work PRs erstellen, Reviews mit Zeilenkommentaren abgeben und per Ereignis ausgelöst werden? | A-03 | A-03 |
| Q-11 | Kontextfenster, Messbarkeit und Komprimierung bei GPT Work | A-03 | A-03 |
| Q-12 | Stand, Branch und geplante Migrationen der parallelen Video-Sitzung | A-04 | A-04 |
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

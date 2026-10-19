# Autonomous AI Business System – Planungsbericht zur gemeinsamen Prüfung

Stand **18.10.2026, Runde 2** · Koordinationsbranch `architecture/ai-business-roadmap` · Arbeitsbranch dieser Runde `claude/nice-ptolemy-k4p1c3`
(Draft-PR, Prüfer GPT Work). **Nur Planung.** Keine App-Codeänderung, keine Migration, keine Schalter, keine Secrets, keine kostenpflichtigen
Aufrufe, kein Merge.

**Aktueller Stand in einem Satz:** GPT Work hat Runde 1 geprüft (PR #81, 12 Befunde); Claude hat alle Befunde bewertet (9 akzeptiert,
3 teilweise, 0 abgelehnt – 07 §0), die bestehenden Dokumente korrigiert, PR #81 geprüft und den ersten Code-Baustein B-01 geplant.
Nächster Schritt: GPT-Gegenprüfung dieser Runde und Betreiberentscheidung BF-16 (= Gate G0), danach sofort Code.

> Abschnitte „Kurzfassung“ unten stammen aus Runde 1; maßgeblich für Executive, Engineering und Roadmap sind 02 §3, 05 §2 und 04 (Runde 2).

## Kurzfassung

1. **Gute Ausgangslage, falsch benannt:** „Jarvis“ ist heute kein KI-Agent, sondern eine regelbasierte Ablaufsteuerung mit sehr belastbaren
   Freigabe-Gates, Budgets, Runtime-Guard, Modellaufruf-Protokoll und einem ehrlichen Command Center. Genau das ist das richtige Fundament.
2. **Kernentscheidung (Runde 2):** **Hybrid-Executive** – KI plant, analysiert, priorisiert und entscheidet im Mandat (L0–L2, Budget);
   ein deterministischer Kern validiert jeden Plan. **Kein** Freigaberecht; der Betreiber bleibt einzige Freigabeinstanz.
3. **Nicht jede Abteilung ist ein Agent:** Controlling ist reine Software. Engineering ist ein Entwicklungsprozess im Repository, kein
   Laufzeit-Agent in Production (Sicherheitsrisiko). Der Opportunity Scout ist der einzige neue KI-intensive Baustein – mit hartem Budget.
4. **Größtes Risiko ist wirtschaftlich, nicht technisch:** Es gibt heute keine erfassten Erlöse und keine Euro-Kosten im System. Deshalb
   kommt Controlling vor dem Scout, und ein Go/No-Go-Meilenstein (M5, Ende Januar) entscheidet über weitere Geschäftseinheiten.
5. **Repository ist öffentlich:** Geschäftsdaten gehören nie ins Repo – auch nicht in Übergabedateien.
6. **Engpass ist die Betreiberzeit:** WIP-Limit von 2 offenen Code-PRs, kleine PRs, Pufferzeit über Weihnachten.
7. **Claude ↔ GPT:** Die einzige belegte gemeinsame Schnittstelle ist GitHub (Branches, PRs, Reviews, CI) plus Dateien. Fähigkeiten von
   GPT Work sind in dieser Sitzung nicht prüfbar und als offene Parameter geführt; nichts wird als automatisiert dargestellt, was nicht
   nachgewiesen ist.

## Dokumente

| Datei | Inhalt |
|---|---|
| [`01_BESTANDSAUFNAHME.md`](01_BESTANDSAUFNAHME.md) | Bestand mit Statusbegriffen, Rahmenbedingungen, Lücken, Konfliktzonen |
| [`02_ZIELARCHITEKTUR.md`](02_ZIELARCHITEKTUR.md) | Zielarchitektur, Executive, Abteilungen, Vertrag, Nachrichtenformat, Datenmodell, Bewertungsraster, Command Center |
| [`03_ARCHITEKTURKRITIK.md`](03_ARCHITEKTURKRITIK.md) | Kritische Prüfung, was kein Agent sein sollte, Mindestvariante |
| [`04_ROADMAP.md`](04_ROADMAP.md) | Phasen A–J, Zeitplan, Meilensteine, Abhängigkeiten, Ressourcen |
| [`05_ENTWICKLUNGSORGANISATION.md`](05_ENTWICKLUNGSORGANISATION.md) | Zusammenarbeit, Review-Prozess, Übergabe, Sitzungs-/Kontext- und Tokenmanagement |
| [`06_PHASE_A_UMSETZUNGSPLAN.md`](06_PHASE_A_UMSETZUNGSPLAN.md) | Konkreter Plan der ersten Phase |
| [`07_OFFENE_FRAGEN_RISIKEN_ENTSCHEIDUNGEN.md`](07_OFFENE_FRAGEN_RISIKEN_ENTSCHEIDUNGEN.md) | Offene Fragen, Risiken, ADRs, Betreiberfreigaben |
| [`08_KAPAZITAETSGESTEUERTE_KOORDINATION.md`](08_KAPAZITAETSGESTEUERTE_KOORDINATION.md) | Betreiber-Chat-Notiz (in 04/05 übernommen) |
| [`09_GPT_ARCHITEKTURPRUEFUNG.md`](09_GPT_ARCHITEKTURPRUEFUNG.md) | Unabhängige Prüfung durch GPT Work (A-02, PR #81) |
| [`coordination/`](coordination/README.md) | Die **einzige** Übergabestruktur (Schemas, Besitz, Ressourcen, Aufgaben A-01, A-02, B-01) |

## Abdeckung der erwarteten Ergebnisse (Auftrag §17)

| # | Ergebnis | Wo |
|---|---|---|
| 1 | Priorisierte Entwicklungsroadmap | 04 §1–§3 |
| 2 | Grobe technische Zielarchitektur | 02 |
| 3 | Agenten, Abteilungen, Zuständigkeiten, Schnittstellen | 02 §3–§4, 01 §2 |
| 4 | Aufgabenverteilung Claude Code / GPT Work | 05 §2, 04 je Phase, `coordination/ownership.json` |
| 5 | Zeitplan, Meilensteine, Abhängigkeiten | 04 §1–§2 |
| 6 | Ressourcenplanung (Tokenbudgets, Limits, Zeitfenster) | 04 §4, 05 §9, `coordination/resources.json` (unbekannte Werte = `null`) |
| 7 | Prüf- und Reviewprozess | 05 §3–§5, `schema/review.schema.json` |
| 8 | Übergabeprotokoll (Branches, PRs, Sitzungswechsel, Kontextkomprimierung) | 05 §6–§8, `schema/task.schema.json` |
| 9 | Umsetzungsplan erste Phase | 06 |
| 10 | Offene Fragen, Risiken, Entscheidungen, Freigaben | 07 |

## Bitte um Entscheidung

- **BF-16 (Teil von Gate G0, Definition in 04 §1):** ADR-01 (Hybrid-Executive), ADR-13 (Lease per Fast-Forward-Commit), ADR-14 (Review-Übergangsregel bei gemeinsamem
  Konto), ADR-15 (ein Engineering-System mit Rollen), ADR-16 (erster Baustein B-01 ∥ E-05).
- **BF-14** Hosting-Tarif (Vercel Hobby ist laut Doku nichtkommerziell). **BF-15** eigene GitHub-Identität. **BF-05** Repo öffentlich/privat.

## Hinweise zur Isolation

- Branch: Der Auftrag nennt `architecture/ai-business-roadmap` (existierte nicht und wurde neu von `main` angelegt). Derselbe Stand liegt
  zusätzlich auf dem Sitzungs-Branch `claude/nice-ptolemy-k4p1c3`, den die Cloud-Umgebung vorgibt.
- Arbeitsumgebung: eigener, frisch geklonter Cloud-Container (vollständig isoliert); kein Git-Worktree nötig.
- Nicht verändert: `main`, Branches anderer Sitzungen, `CLAUDE.md`, `docs/PROJECT_STATUS.md`, `lib/architecture/*` (Konfliktzonen mit der
  parallelen Video-Sitzung). Ein Verweis in `docs/PROJECT_STATUS.md` folgt erst nach Freigabe als eigener kleiner PR.

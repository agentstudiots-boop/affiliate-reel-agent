# 05 – Entwicklungsorganisation: Claude Code ↔ GPT Work (Codex)

Verbindlicher Vorschlag zur Prüfung, **Runde 2** (nach GPT-03, -04, -05, -12 und Betreiberbeschlüssen vom 18.10. in `coordination/README.md`).
Gilt ab Freigabe für alle Arbeiten am KI-Unternehmenssystem; `CLAUDE.md` und `AGENTS.md` haben Vorrang. Es gibt **ein** Koordinationssystem:
`docs/ai-business/coordination/` – für Claude Code, GPT Work und den normalen ChatGPT-Chat.

## 1. Was heute tatsächlich funktioniert (Nachweisstand 18.10.2026)

| Fähigkeit | Claude Code | GPT Work (Codex) | Normaler ChatGPT-Chat |
|---|---|---|---|
| Repo lesen, Branch, Commit, Push | **getestet** | **getestet** über Connector (PR #81) | Commits auf dem Architektur-Branch belegt (`22272fd`, `a7f1b7e`, `aa6ce5a`) |
| PR erstellen | **getestet** (dieser Draft-PR) | **getestet** (PR #81) | nicht belegt |
| PR-Review | Kommentar **getestet**; **kein Approve möglich** | Werkzeug vorhanden, nicht getestet | – |
| Eigene GitHub-Identität | **nein**: alle PRs laufen unter `agentstudiots-boop` | **nein**: ebenfalls `agentstudiots-boop` | ebenfalls |
| Vercel | Werkzeuge vorhanden (lesend genutzt in früheren Sitzungen), hier nicht genutzt | nicht belegt | – |
| Automatischer Start durch GitHub-Ereignis | **nein** (keine Action eingerichtet) | Quelle verfügbar, **nicht eingerichtet/getestet** | nein |
| Zeitgesteuerte Folgearbeit | verfügbar, **nicht eingerichtet** | verfügbar, **nicht eingerichtet** | nein |
| Direkte Kommunikation untereinander | **keine** | **keine** | **keine** |

Folgerung: Die Übergabe über GitHub ist **real dokumentiert**, aber **kein automatischer Aufgabenwechsel**. Eine Übergabedatei startet keine
Sitzung. Bis ein Trigger mit Testlauf nachgewiesen ist, stößt der Betreiber zweimal täglich manuell an (Betreiberbeschluss).

## 2. Ein Engineering-System mit getrennten Rollen

Bewertung des Prüfpunkts aus `coordination/README.md` (Betreiberbeschluss `aa6ce5a`, als Prüfhypothese behandelt):
**Empfehlung: ein gemeinsames Engineering-System mit drei je Aufgabe vergebenen Rollen, nicht zwei eigenständige Engineering-Systeme.**

| Kriterium | Ein System, Rollen je Aufgabe | Zwei eigenständige Systeme |
|---|---|---|
| Infrastruktur | eine Koordination, eine CI, ein Regelwerk | doppelte Aufgabenlisten, Regeln, Übergaben – widerspricht „kein zweites Koordinationssystem“ |
| Parallelität | über überschneidungsfreie Claims gleich gut | nur scheinbar höher; Konflikte an Hot Files bleiben |
| Unabhängige Prüfung | Prüfer ist per Regel ein anderes System | gleich, aber mit Schnittstellenaufwand zwischen zwei Systemen |
| Austauschbarkeit der Modelle | hoch (Rolle ≠ Modell) | gering (Modell = System) |
| Kosten/Token | eine Pflege, geringerer Kontextaufwand je Übergabe | höher |
| Risiko | gemeinsame Fehlerquelle in der Koordination | Abweichende Standards, doppelte Wahrheiten |

Prüfbare Erfolgskriterien (nach ca. 5 Paketen messen): Nacharbeitsquote, Befunde je Review, Durchlaufzeit, Wartezeit auf Review/Betreiber,
Konflikte an Dateien, Kosten je akzeptiertem Paket. Weicht das Ergebnis deutlich ab, wird die Frage erneut vorgelegt (ADR-15).

**Rollen (je Task-Datei festgelegt):**
- **Planer** – technische Planung: Ziel, Schnittstellen, Dateien/Claims, Akzeptanzkriterien, Testanforderungen, Budget. Regel: das jeweils
  **andere** System plant, als das, das implementiert.
- **Implementierer** – setzt um, hält den Lease, pflegt `task.json` ab der Übernahme.
- **Prüfer** – unabhängig vom Implementierer; schreibt `review-<n>.json` und einen PR-Kommentar mit geprüfter SHA. Der Planer darf Prüfer sein.
- **Betreiber** – merged, entscheidet ADRs, Kosten, Production. Der normale ChatGPT-Chat dokumentiert Betreiberideen als Prüfhypothesen.

Kein System gibt eigene Arbeit allein frei. Betreiberideen sind Prüfhypothesen: beide Systeme bewerten sie unabhängig am realen Code;
abweichende Einschätzungen werden gegenübergestellt (Betreiberbeschluss `aa6ce5a`).

## 3. Workflow je Aufgabe

```
Planer: tasks/<ID>/task.json (Status planned → ready, Kriterien, Claims, Budget)        [PR oder Zustands-Commit]
   │
Implementierer: Lease per Fast-Forward-Commit auf den Koordinationsbranch (ADR-13) → in_progress
   │   Code-Branch <system>/<ID>-<kurz> von aktuellem main · kleine Commits mit Trailer · lokale Prüfungen
   ▼
PR gegen main (bzw. gegen den Architektur-Branch bei reiner Doku) · Status waiting_review
   │
Prüfer: review-<n>.json + PR-Kommentar mit SHA ──► changes_requested ──► Implementierer behebt ──► review-<n+1>
   ▼
approved_by_reviewer + CI grün ──► waiting_operator ──► Betreiber merged ──► merged ──► Deploy-Nachweis ──► deployed/verified
```

Branch-Namen: `claude/<ID>-<kurz>`, `gpt/<ID>-<kurz>`; Cloud-Sitzungen mit vorgegebenem Branch nennen ihn in `task.json`. Nie auf `main` direkt,
nie Force-Push auf fremde Branches, nie Merge ohne Betreiber.

## 4. Urheberkennung und Reviewer-Identität (GPT-05)

Alle Systeme arbeiten heute unter **demselben GitHub-Konto**. Deshalb:
- Jeder Commit trägt Trailer: `Task: <ID>`, `Implemented-By: claude-code | gpt-work`, bei Review-Fixes zusätzlich `Reviewed-By:`.
- Model- bzw. Systemkennungen in JSON und Trailern sind **Selbstauskünfte**, kein manipulationssicherer Nachweis.
- GitHub-„Approve“ ist unmöglich (Autor = Prüfer-Konto). Ein Review gilt als erbracht durch `review-<n>.json` **und** einen PR-Kommentar mit
  geprüfter SHA. Vertrauensanker bleibt der **Betreiber-Merge**.
- Mittelfristig (D-07, BF-15): eigene Identität für mindestens ein System (Machine User oder GitHub-App), danach Branch-Schutz mit Pflicht-Review
  und Pflicht-Check `check`. Bis dahin keine technische Merge-Sperre behaupten.

## 5. Prüfliste für das prüfende Modell

Zusätzlich prüft der Prüfer die **Akzeptanzkriterien und Testanforderungen der Task-Datei** einzeln (`acceptance_criteria[].met`).

1. **Architekturkonformität:** Abteilungsvertrag, keine Importe zwischen Spezialisten/Abteilungen, Orchestrator-Regel aus `AGENTS.md`.
2. **Freigabe-Invarianten:** keine neue Außenwirkung ohne Gate; `ACTIVE_APPROVAL_AUTHORITIES` unverändert; kein Schreiben in Freigabetabellen
   außerhalb `lib/publishing/`.
3. **Sicherheit:** `authorized()` je Route, `proxy.ts`, Runtime-Guard je Wirkung, keine Secrets/Geschäftsdaten in Code/Logs/Repo,
   Prompt-Injection (Modellausgabe kann keine Stufe ≥ L3 auslösen).
4. **Fehlerbehandlung:** unklare Anbieterantworten nicht wiederholen (`outcome_unknown` + Abgleich), Idempotenz, Leases mit Fencing, Outbox.
5. **Kosten:** jeder Modellaufruf über `recordModelCall`; harte Grenze nur über Budgetreservierung vor dem Aufruf; keine kostenpflichtigen Aufrufe in Tests.
6. **Datenbank:** nur additiv, Nummer reserviert, Registrierung in `migrations.ts`, `ensure-automation-schema.ts`, Upgrade-Test.
7. **Tests:** realer Code, nur I/O ersetzt; Regressionstest je Fehlerbehebung; Abdeckung der Fehlerpfade.
8. **Integrationsrisiken:** Berührung von Konfliktzonen (01, §4), Schalter Standard „aus“.
9. **Technische Schulden:** Duplikate, tote Pfade, unklare Namen.
10. **Ehrlichkeit der Doku/Oberfläche:** implementiert ≠ aktiviert ≠ live verifiziert; Referenzmodus vs. KI-Modus.

Befunde werden klassifiziert: `blocker` (muss vor Merge behoben sein) · `major` · `minor` · `nit`. Ein PR mit offenem `blocker` wird nicht gemergt.

## 6. Konfliktvermeidung zwischen den Modellen (GPT-04)

- **Datei-genaue Claims:** `claims.paths` nennt einzelne Dateien oder enge Globs, nie ganze Bäume wie `docs/ai-business/**`. Fremde Dateien nur
  über `claims.foreign_paths` mit Link auf die Zustimmung des Besitzers.
- **Hot Files** (`ownership.json`): nur mit Abstimmung, nie parallel; vorher `origin/main` und offene PRs prüfen.
- **Migrationsnummern:** Reservierung in `ownership.json` → `migration_reservations` per Zustands-Commit; zuletzt auf `main`: **038**.
- **Übernahme per kooperativem Lease-Protokoll (ADR-13, korrigiert nach GPT-R2-04):** Lease und Statuswechsel werden als kleiner Commit auf
  den **Koordinationsbranch** `architecture/ai-business-roadmap` geschrieben – per Fast-Forward-Push bzw. Connector mit `expected_sha`.
  Vor **jedem** Zustandswrite (nicht nur bei der Übernahme):
  1. Ref `R` lesen und `task.json` **an genau diesem Ref** auswerten.
  2. Nur schreiben, wenn `lease.holder` = eigenes System, `lease.generation` = die eigene Generation und `lease.expires_at` > jetzt.
     Übernahme nur, wenn kein gültiger fremder Lease besteht; dann `generation` + 1.
  3. Commit exakt auf `R` aufbauen; Push nur als Fast-Forward bzw. mit `expected_sha = R`, nie Force-Push.
  4. Push abgelehnt ⇒ neu lesen und Schritt 2 **erneut** prüfen; ist der Lease verloren, Arbeit anhalten und Checkpoint nur im eigenen Branch.
  **Grenze:** Git verhindert nur konkurrierende Ref-Updates, nicht dass ein System ohne gültigen Lease schreibt. Das Protokoll ist eine
  kooperative Regel aller Beteiligten, **keine technisch erzwungene Sperre**; `generation` ist ein kooperativer Fencing-Zähler. Ein Rennen
  zweier Systeme wurde noch nicht getestet. Technisch erzwingen ließe sich das erst mit einem prüfenden CI-Check oder eigenen Identitäten (D-07).
- **Schreibrechte je Datei:** `task.json` (Planer bis Lease, danach Implementierer), `review-<n>.json` (Prüfer), `decision.json` (Betreiber;
  ein Modell trägt nur mit nachprüfbarer Quelle ein). `resources.json`: jedes System nur seinen Abschnitt.
- Merge-Konflikte in Koordinationsdateien werden nie automatisch zugunsten einer Seite aufgelöst.

## 7. Übergabeprotokoll (Branch, PR, Sitzungswechsel, Kontextkomprimierung)

Maschinenlesbar: `docs/ai-business/coordination/schema/task.schema.json` (JSON Schema 2020-12) mit Beispiel
`coordination/tasks/A-01/task.json`. Ein Verzeichnis je Aufgabe:

```
coordination/
  ownership.json            Modulbesitz, Hot Files, Migrationsreservierungen
  resources.json            Modell-/Zeitressourcen; unbekannte Werte = null (offene Parameter)
  schema/task.schema.json   Aufgabe inkl. Änderungsprotokoll (log[])
  schema/review.schema.json Review-Ergebnis
  schema/decision.schema.json Betreiberentscheidung (mit nachprüfbarer Quelle)
  tasks/<ID>/task.json      Aufgabe (Schreibrecht: Planer bis Lease, danach Implementierer)
  tasks/<ID>/review-<n>.json Review (Schreibrecht: Prüfer)
  tasks/<ID>/decision.json  Betreiberentscheidung (Schreibrecht: Betreiber)
```

Pflichtfelder (Auszug): Aufgaben-ID, Modul, Planer/verantwortliches/implementierendes/prüfendes Modell, Akzeptanzkriterien, Testanforderungen, Budget, Lease, Wartezustand, Ausgangscommit, Branch, geänderte Dateien,
implementierte Funktionen, Testergebnisse (Befehl, Ergebnis, Commit), bekannte Probleme, offene Entscheidungen, PR-Status, Freigabestatus,
nächste Schritte, `updated_at`, `revision`, `log[]` (wer, wann, was, Commit).

**Pflichtzeitpunkte für eine Aktualisierung:** Aufgabenstart · jeder Push mit fachlichem Fortschritt · PR-Erstellung · nach jedem Review ·
vor Sitzungsende · beim Checkpoint (§8) · nach Merge/Deployment.

Das Änderungsprotokoll beantwortet: wer implementiert (log `actor`), wer geprüft (`review-*.json`), welche Tests (`tests[]`), welche Fehler
(`known_issues[]`, Review-Befunde), was integriert ist (`pr.state = merged`, `merge_commit`), was offen ist (`next_steps[]`, `open_decisions[]`).

## 8. Sitzungs- und Kontextmanagement

### 8.1 Messbarkeit
- **Claude Code:** besitzt automatische Kontextkomprimierung; im CLI zeigt `/context` die Auslastung für den Bediener. Ob das Modell in einer
  Cloud-Sitzung die eigene Auslastung zuverlässig abfragen kann, ist **nicht nachgewiesen** → nicht als Messgröße verwenden.
- **GPT Work:** automatische Komprimierung laut eigener Umgebung vorgesehen, nicht ausgelöst getestet; keine verlässliche Prozentanzeige (A-02, `resources.json`).

### 8.2 Ersatzindikatoren für „≈ 80 %“ (beide Systeme)
Ein Checkpoint wird geschrieben, sobald **einer** zutrifft:
1. Ein Arbeitspaket (eine Aufgabe oder ein PR) ist abgeschlossen.
2. Mehr als ca. 40 umfangreiche Werkzeugergebnisse (Dateilesungen, Testausgaben) seit dem letzten Checkpoint.
3. Mehr als ca. 90 Minuten Arbeit seit dem letzten Checkpoint.
4. Eine Kontextkomprimierung ist erkennbar erfolgt (Zusammenfassung früherer Schritte erscheint) → **sofort** Checkpoint.
5. Vor riskanten oder langen Schritten (vollständige Testsuite ~10 min, Build, Merge-Vorbereitung).

Die Schwellen sind Startwerte (`resources.json`) und werden nach den ersten Phasen angepasst.

### 8.3 Inhalt eines Checkpoints (in `task.json` → `session`)
Entwicklungsstand · letzter Commit · aktiver Branch · offene Aufgaben · bekannte Fehler · getroffene Entscheidungen · Teststatus ·
**nächster konkreter Arbeitsschritt** (ein Satz, ausführbar). Checkpoint wird committet und gepusht – nur so überlebt er das Sitzungsende
(Cloud-Container sind flüchtig).

Ein Commit kann seine eigene SHA nicht enthalten: `session.last_commit` nennt den letzten **bereits existierenden** Stand; der neue Stand ist
über `git log` des Branches auffindbar.

### 8.4 Wiederaufnahme und Aufgabenübernahme
Neue Sitzung liest in dieser Reihenfolge: `CLAUDE.md` → `docs/PROJECT_STATUS.md` → `AGENTS.md` → `docs/ai-business/README.md` →
`coordination/tasks/<ID>/task.json` (+ letzte `review-*.json`) → offene PRs/CI/Remote-Heads. Erst dann Arbeit fortsetzen.
Übernimmt ein **anderes** System eine Aufgabe (Kapazität erschöpft, Sitzung beendet), gilt: Lease abgelaufen oder vom Halter freigegeben →
neuer Lease mit höherer `generation` per Fast-Forward-Commit → Arbeit auf dem vorhandenen Branch fortsetzen, nicht neu beginnen.

### 8.5 Wartezustände
`waiting_capacity` (Kontingent/Anstoß fehlt), `waiting_review`, `waiting_operator`, `blocked` (technisch/extern). Jeder Wartezustand nennt in
`waiting.resume_condition` die konkrete Bedingung und in `waiting.wake_mechanism`, wie es weitergeht: heute `manual_start`;
`tested_trigger` erst nach einem dokumentierten Testlauf.


## 9. Token-, Zeit- und Ressourcenmanagement

**Keine erfundenen Limits.** Kontingente, Kontextgrößen, Reset-Zeiten und Preise stehen in `coordination/resources.json`; unbekannt = `null`
und nie „unendlich“.

**Harte Kostengrenze (Betreiberbeschluss `e7692d0`):** Entwicklung nur innerhalb der bezahlten Abonnements – keine zusätzlichen Credits,
Aufladungen oder nutzungsabhängigen Kontingente, keine kostenpflichtige Umgehung von Limits. Ist ein System am Limit: Checkpoint, Status
`waiting_capacity`, Reset-Zeit „unbekannt“, wenn nicht belegt. Ein anderes, bereits verfügbares System darf **andere** Aufgaben übernehmen,
aber nie die unabhängige Prüfung der eigenen Arbeit ersetzen.

1. **Takt:** zwei manuelle Anstöße täglich (morgens, abends) – eine Routine, keine Garantie, dass beide Systeme verfügbar sind. Je Anstoß: offene Reviews → eigene `changes_requested` → laufende Aufgabe →
   nächste startbereite Aufgabe per Lease (04, Einleitung).
2. **Kapazität erschöpft:** Checkpoint schreiben, Status `waiting_capacity`, Lease freigeben oder ablaufen lassen; das andere System darf
   übernehmen (8.4).
3. **Kleine Aufgaben:** Zielgröße ≤ ca. 400 geänderte Zeilen ohne Tests; WIP höchstens 2 offene Code-PRs.
4. **Teure Schritte bündeln:** volle Testsuite (≈ 10 min) vor PR und nach Review-Fixes, dazwischen gezielte Tests.
5. **Review ist günstiger als Implementierung:** Prüfer liest Diff, Task-Datei und betroffene Dateien, nicht das ganze Repo.
6. **Keine kostenpflichtigen Laufzeitaufrufe in der Entwicklung**; Modellvergleiche nur nach Freigabe.
7. **GitHub/Vercel:** Schreibzugriffe nur auf eigene Branches/PRs; Vercel ausschließlich lesend (Deployment-Status, Laufzeitfehler,
   Env-**Namen**); keine Änderung an Env, Domains, Crons, Projekteinstellungen ohne Betreiberfreigabe.
8. **Automatisierung erst bei gemessenem Engpass** (Betreiberauftrag): z. B. wenn Reviews regelmäßig > 1 Anstoß warten → D-08 Trigger.

## 10. Merge-Regeln

- Jeder Merge manuell durch den Betreiber nach grüner CI und dokumentiertem Review des anderen Systems (ADR-10). Kein Auto-Merge für Code
  (Merge = Production-Deployment).
- Optional später: Auto-Merge nur für reine Doku-/Koordinations-PRs, frühestens nach D-07 (eigene Reviewer-Identität).
- Empfohlen: Branch-Schutz für `main` (Pflicht-Check `check`, keine Force-Pushes) – Betreiberentscheidung BF-04; Pflicht-Review erst nach D-07.

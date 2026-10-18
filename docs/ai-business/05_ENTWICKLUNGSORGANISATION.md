# 05 – Entwicklungsorganisation: Claude Code ↔ GPT Work

Verbindlicher Vorschlag zur Prüfung. Gilt ab Freigabe für alle Arbeiten am KI-Unternehmenssystem; bestehende Regeln aus `CLAUDE.md` und
`AGENTS.md` haben Vorrang.

## 1. Was heute tatsächlich automatisierbar ist (Nachweisstand 18.10.2026)

| Fähigkeit | Claude Code (Cloud-Sitzung) | GPT Work | Status |
|---|---|---|---|
| Repository lesen, Branch anlegen, pushen | ja (in dieser Sitzung genutzt) | laut Historie wahrscheinlich (PR #71 „Codex-Audit“, Commits über Betreiberkonto) | GPT: **nicht verifiziert** |
| Pull Request erstellen | ja (GitHub-MCP `create_pull_request`) | unbekannt | offen (Q-10) |
| PR-Review mit Zeilenkommentaren abgeben | ja (GitHub-MCP `pull_request_review_write`) | unbekannt | offen |
| Auf PR-Ereignisse reagieren (Kommentare, CI) | ja, solange die Sitzung lebt (`subscribe_pr_activity`) | unbekannt | Claude: vorhanden |
| Zeitgesteuerte Folgesitzung (z. B. „prüfe offene PRs täglich“) | ja (Routinen/`create_trigger`, `send_later`) | unbekannt | Claude: vorhanden, **nicht eingerichtet** |
| Claude per `@claude`-Kommentar im PR auslösen | nur mit GitHub-Action `anthropics/claude-code-action` + API-Schlüssel als Repo-Secret | – | **nicht installiert** (nur `quality.yml`); kostenpflichtig → Betreiberfreigabe |
| GPT per Kommentar/Ereignis aus GitHub auslösen | – | unbekannt | offen |
| Direkte Kommunikation Claude ↔ GPT | **keine Schnittstelle** | **keine Schnittstelle** | nicht vorhanden |
| Gemeinsame Qualitätsprüfung | CI `Quality` je PR (typecheck, lint, 660 Tests, build, audit) | dieselbe CI | vorhanden |
| Merge-Sperre ohne grüne CI / Review | – | – | **nicht vorhanden** (kein Branch-Schutz) |

Folgerung: Die einzige verlässliche gemeinsame Schnittstelle ist **GitHub** (Branches, PRs, Reviews, CI) plus **Dateien im Repository**.
Der Betreiber ist heute das Übergabeglied, wenn GPT Work eine Aufgabe beginnen soll. Nichts davon wird als automatisiert dargestellt,
bevor es nachgewiesen ist.

## 2. Rollen und Zuständigkeitsprinzip

- Jede Aufgabe hat genau ein **implementierendes** und ein **prüfendes** Modell; nie dasselbe.
- **Verantwortlich** ist das implementierende Modell bis zum Merge; der Betreiber merged.
- Module haben einen **Besitzer** (`coordination/ownership.json`). Nur der Besitzer ändert Dateien eines Moduls; andere nur über eine
  eigene Aufgabe mit ausdrücklichem Eintrag `foreign_paths` und Zustimmung des Besitzers im PR.
- Vorschlag der Grundaufteilung (nach Kontext, nicht nach „Fähigkeit“ – ein belastbarer Fähigkeitsvergleich liegt nicht vor):

| Bereich | Implementiert | Prüft | Begründung |
|---|---|---|---|
| Executive-Kern, Aufgabenbuch, Migrationen, Integration in bestehende Gates/Router | Claude Code | GPT Work | tiefe Kopplung an bestehenden Code, den Claude-Sitzungen überwiegend geschrieben haben (59 Commits) |
| Controlling: Preiskatalog, Kostenbuch-Importer, Kennzahlenfunktionen (reine Funktionen + SQL) | GPT Work | Claude Code | gut isolierbar, klarer Vertrag, unabhängige Sicht auf Zahlenlogik |
| Opportunity-Bewertungsraster (reine Funktionen), Schemas | GPT Work | Claude Code | isoliert |
| Opportunity-Orchestrator inkl. Recherche/Modellaufrufe | Claude Code | GPT Work | nutzt `tavily.ts`, `Generator`, `recordModelCall` |
| Command-Center-Unternehmensebene | Claude Code | GPT Work | Konfliktzone `lib/architecture/*` |
| Koordinationswerkzeuge (Schema-Validator, Besitzprüfung in CI) | GPT Work | Claude Code | unabhängig vom App-Code |
| Sicherheits-Review jeder L3/L4-nahen Änderung | beide (zweites Review durch das jeweils andere Modell) | – | Vier-Augen-Prinzip |

Die Aufteilung ist eine **Startannahme** und wird nach Phase C anhand der Review-Befunde und Nacharbeitsquote überprüft.

## 3. Workflow je Aufgabe

```
 Betreiber/Executive-Plan ──► Aufgabe anlegen (coordination/tasks/<ID>/task.json, Status planned)  [Koordinations-PR]
          │
          ▼
 Implementierer: Branch <modell>/<ID>-<kurzname> von aktuellem main · Status in_progress · Dateien in "claims"
          │   kleine Commits mit Trailer · lokale Prüfungen
          ▼
 PR (Vorlage: Ziel, Diff-Umfang, Tests, Risiken, Übergabedatei aktualisiert) · Status in_review
          │
          ▼
 Prüfer: Review gegen Prüfliste (§5) · schreibt coordination/tasks/<ID>/review-<n>.json · GitHub-Review
          │            ├── Änderungen nötig ──► Implementierer behebt ──► neues Review (n+1)
          ▼
 Freigabe Prüfer + CI grün ──► Betreiber merged (manuell) ──► Status merged ──► Deploy-Nachweis ──► Status deployed/verified
```

Branch-Namen: `claude/<ID>-<kurz>`, `gpt/<ID>-<kurz>`, Planung `architecture/<thema>`. Basis immer das aktuelle `main`.
Nie auf `main` direkt, nie Force-Push auf fremde Branches, nie Merge ohne Betreiber.

## 4. Urheberkennung (Pflicht)

Jeder Commit trägt Trailer, damit Verantwortung nachvollziehbar ist, auch wenn GPT über das Betreiberkonto pusht:

```
Task: B-03
Implemented-By: claude-code | gpt-work
Reviewed-By: gpt-work | claude-code   (nur in Review-Fix-Commits / Merge-Beschreibung)
```

Keine Modellversionen in Commits (bestehende Regel); die Kennung nennt nur das System.

## 5. Prüfliste für das prüfende Modell

1. **Architekturkonformität:** Abteilungsvertrag, keine Importe zwischen Spezialisten/Abteilungen, Orchestrator-Regel aus `AGENTS.md`.
2. **Freigabe-Invarianten:** keine neue Außenwirkung ohne Gate; `ACTIVE_APPROVAL_AUTHORITIES` unverändert; kein Schreiben in Freigabetabellen
   außerhalb `lib/publishing/`.
3. **Sicherheit:** `authorized()` je Route, `proxy.ts`, Runtime-Guard je Wirkung, keine Secrets/Geschäftsdaten in Code/Logs/Repo,
   Prompt-Injection (Modellausgabe kann keine Stufe ≥ L3 auslösen).
4. **Fehlerbehandlung:** unklare Anbieterantworten nicht wiederholen, Idempotenz, Leases, Budgetreservierung vor Aufruf.
5. **Kosten:** jeder Modellaufruf über `recordModelCall`; Obergrenzen; keine kostenpflichtigen Aufrufe in Tests.
6. **Datenbank:** nur additiv, Nummer reserviert, Registrierung in `migrations.ts`, `ensure-automation-schema.ts`, Upgrade-Test.
7. **Tests:** realer Code, nur I/O ersetzt; Regressionstest je Fehlerbehebung; Abdeckung der Fehlerpfade.
8. **Integrationsrisiken:** Berührung von Konfliktzonen (01, §4), Schalter Standard „aus“.
9. **Technische Schulden:** Duplikate, tote Pfade, unklare Namen.
10. **Ehrlichkeit der Doku/Oberfläche:** implementiert ≠ aktiviert ≠ live verifiziert; Referenzmodus vs. KI-Modus.

Befunde werden klassifiziert: `blocker` (muss vor Merge behoben sein) · `major` · `minor` · `nit`. Ein PR mit offenem `blocker` wird nicht gemergt.

## 6. Konfliktvermeidung zwischen den Modellen

- **Datei-Claims:** `task.json` → `claims.paths` (Globs). Zwei offene Aufgaben dürfen sich nicht überschneiden. Prüfung zuerst manuell durch
  den Implementierer beim Anlegen, ab Phase C per Skript in CI.
- **Hot Files** (nur mit Koordination, nie parallel): `lib/memory/migrations.ts`, `lib/memory/ensure-automation-schema.ts`,
  `tests/migration-upgrade.test.cjs`, `lib/architecture/model.ts`, `app/api/whatsapp/webhook/route.ts`, `lib/whatsapp/router.ts`,
  `proxy.ts`, `lib/security/access-policy.ts`, `tests/admin-session.test.cjs`, `vercel.json`, `package.json`/`package-lock.json`,
  `CLAUDE.md`, `AGENTS.md`, `docs/PROJECT_STATUS.md`.
- **Migrationsnummern:** Reservierung in `coordination/ownership.json` → `migration_reservations` vor Beginn der Aufgabe.
  Die parallele Video-Sitzung erhält Vorrang für die nächste freie Nummer, solange ihr Stand unbekannt ist.
- **Veraltete Zustände verhindern:**
  1. Jede Übergabedatei hat `revision` (Ganzzahl) und `based_on_commit`.
  2. Vor jeder Änderung `git fetch` und Abgleich mit `origin/main` bzw. dem Aufgabenbranch; ist `revision` auf dem Remote höher als gelesen,
     wird **nicht** überschrieben, sondern neu gelesen und zusammengeführt.
  3. **Schreibrechte je Datei, nicht je Feld:** `task.json` schreibt nur der Implementierer, `review-<n>.json` nur der Prüfer,
     `decision.json` nur der Betreiber. Damit überschreiben sich zwei Modelle nie gegenseitig.
  4. Git-Merge-Konflikte in Übergabedateien werden nie automatisch zugunsten einer Seite aufgelöst.

## 7. Übergabeprotokoll (Branch, PR, Sitzungswechsel, Kontextkomprimierung)

Maschinenlesbar: `docs/ai-business/coordination/schema/task.schema.json` (JSON Schema 2020-12) mit Beispiel
`coordination/tasks/A-01/task.json`. Ein Verzeichnis je Aufgabe:

```
coordination/
  ownership.json            Modulbesitz, Hot Files, Migrationsreservierungen
  resources.json            Modell-/Zeitressourcen; unbekannte Werte = null (offene Parameter)
  schema/task.schema.json   Aufgabe inkl. Änderungsprotokoll (log[])
  schema/review.schema.json Review-Ergebnis
  tasks/<ID>/task.json      Aufgabe (Schreibrecht: Implementierer)
  tasks/<ID>/review-<n>.json Review (Schreibrecht: Prüfer)
  tasks/<ID>/decision.json  Betreiberentscheidung (Schreibrecht: Betreiber)
```

Pflichtfelder (Auszug): Aufgaben-ID, Modul, verantwortliches/implementierendes/prüfendes Modell, Ausgangscommit, Branch, geänderte Dateien,
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
- **GPT Work:** Messbarkeit und Komprimierungsverhalten **unbekannt** (Q-11).

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

### 8.4 Wiederaufnahme
Neue Sitzung liest in dieser Reihenfolge: `CLAUDE.md` → `docs/PROJECT_STATUS.md` → `AGENTS.md` → `docs/ai-business/README.md` →
`coordination/tasks/<ID>/task.json` (+ letzte `review-*.json`) → `git log` des Branches. Erst dann Arbeit fortsetzen.

## 9. Token-, Zeit- und Ressourcenmanagement

**Keine erfundenen Limits.** Alle Kontingente, Kontextgrößen, Abo-Grenzen und Preise stehen in `coordination/resources.json`; unbekannte
Werte sind `null` und werden vom Betreiber ergänzt.

Strategie:
1. **Engpass Betreiber:** WIP-Limit 2 offene Code-PRs; Reviewfenster des Betreibers als Taktgeber (Startannahme: 2 Fenster/Woche, je 30–60 min – Q-01).
2. **Kleine Aufgaben:** Zielgröße je PR ≤ ca. 400 geänderte Zeilen ohne Tests; große Vorhaben in Folgen zerlegen.
3. **Teure Schritte bündeln:** volle Testsuite (≈10 min) vor PR und nach Review-Fixes, dazwischen gezielte Tests (`node --test tests/<datei>`).
4. **Parallelität nur bei disjunkten Claims:** Claude und GPT arbeiten gleichzeitig nur an Aufgaben ohne gemeinsame Dateien.
5. **Review ist günstiger als Implementierung:** das prüfende Modell liest Diff + Übergabedatei, nicht das ganze Repo; gezielte Dateien.
6. **Keine kostenpflichtigen Laufzeitaufrufe in der Entwicklung** (bestehende Regel); Modellvergleiche nur nach Freigabe.
7. **Zeitfenster:** Implementierung kann asynchron laufen (Cloud-Sitzungen, Routinen); Merges nur in Betreiberfenstern; keine Merges
   unmittelbar vor Cron-Slots (07/08/09/16/17/18 UTC), damit ein fehlerhaftes Deployment nicht direkt einen Tageslauf trifft.

## 10. Merge-Regeln

- Stufe 0 (ab sofort): Jeder Merge manuell durch den Betreiber nach grüner CI und freigebendem Review des anderen Modells.
- Stufe 1 (optional, nach Phase D und Betreiberentscheidung): automatischer Merge **nur** für reine Koordinations-/Doku-PRs
  (`docs/**`, `coordination/**`) bei grüner CI und Review-Freigabe. **Kein Auto-Merge für Code**, weil Merge = Production-Deployment.
- Empfohlen: Branch-Schutz für `main` (erforderlicher Check `check`, keine Force-Pushes, keine Löschung) – Betreiberentscheidung (BF-04).

# Release-Checkliste (Aufgabe D-05)

Gilt für jeden PR, der nach `main` gemergt wird – Code, Migration oder Doku. Ein Merge nach `main` löst automatisch ein
Production-Deployment aus (Vercel, Projekt `affiliate-reel-agent`), und `ensureAutomationSchema` wendet neue Migrationen beim
ersten Webhook-/Cron-Aufruf an. „Gemergt“ ist deshalb nie dasselbe wie „live verifiziert“.

Der Merge bleibt Betreiberentscheidung. Diese Liste beschreibt, was vorher belegt sein muss und was nachher nachgewiesen wird.
Ergebnisse gehören in den PR (Kommentar) bzw. in das Übergabefeld der Task-Datei (`tests`, `pr`, `next_steps`) – nie
Geschäftsdaten, Secrets oder Werte von Umgebungsvariablen (öffentliches Repository).

## 1. Statusbegriffe (verbindlich, strikt getrennt)

| Begriff | Bedeutung | Nachweis |
|---|---|---|
| **implementiert** | Code liegt auf einem Branch | Commit-SHA |
| **getestet** | automatisierte Offline-Prüfungen grün (siehe §2) | Befehle + Ergebnis + SHA |
| **gemergt** | in `main` | Merge-Commit-SHA |
| **deployed** | im READY-Production-Deployment enthalten | Deployment-ID, Status READY, Commit-SHA des Deployments = Merge-Commit |
| **aktiviert** | nötige Schalter/Zugänge in Production gesetzt (nur durch den Betreiber) | Variablen**name** vorhanden, Redeploy-ID |
| **live verifiziert** | ein echter Production-Aufruf zeigt das erwartete Verhalten | URL/Route, Zeitpunkt, beobachtete Antwort bzw. DB-Nachweis |

Ein Schritt wird nur mit seinem Nachweis behauptet. Fehlt der Nachweis, steht der nächstniedrigere Begriff.
Ein grüner Build ist kein Deploy-Nachweis; ein READY-Deployment ist kein Live-Nachweis.

## 2. Vor dem Merge (Autor)

- [ ] Branch von aktuellem `main`, kleiner PR, Draft bis zur Prüfung; keine fremden Branches verändert.
- [ ] `npm ci`, `npm run typecheck`, `npm run lint` (bekannte Warnungen benennen), `npm test`, `npm run build` – alle grün,
      jeweils mit Commit-SHA im PR. Build im Hauptcheckout, nicht in einer Kopie/einem Worktree mit verlinktem `node_modules`.
- [ ] CI (`check`) auf dem PR-Kopf grün.
- [ ] Neue Funktion hinter Schalter mit Standard „aus“; kein Schalter wird im Code aktiviert.
- [ ] Keine kostenpflichtigen Aufrufe, Live-Posts oder Nachrichten in Tests (nur I/O ersetzt, `tests/helpers/`).
- [ ] Neuer Modellaufruf ⇒ `recordModelCall` (Tabelle `model_calls`).
- [ ] Neue öffentliche Route ⇒ bewusste Entscheidung + Eintrag in `tests/admin-session.test.cjs`; jede interne Route prüft `authorized()`.
- [ ] Freigabeinvarianten unberührt oder ausdrücklich geprüft (Inhalts-, Bild-, Kosten-, Veröffentlichungsfreigabe; CLAUDE.md §4).
- [ ] Commits ohne Modellkennung; Doku (`CLAUDE.md`, `docs/PROJECT_STATUS.md`) angepasst, wo sich Architektur oder Stand ändert.
- [ ] Review: Ergebnis als PR-Kommentar mit geprüfter SHA; offene major-/blocker-Befunde erledigt oder vom Betreiber bewusst akzeptiert.

## 3. Zusätzlich bei Migrationen (Merge = Anwendung in Production)

- [ ] Nur additiv (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`); kein `DROP`, `ALTER … TYPE`, `UPDATE`, `DELETE`.
- [ ] Nummer frei und reserviert (keine Kollision mit offenen PRs); registriert in `lib/memory/migrations.ts`,
      Prüfung in `lib/memory/ensure-automation-schema.ts`, `tests/migration-upgrade.test.cjs`, Anzeige in `lib/architecture/model.ts`,
      Zähler in `CLAUDE.md` §6 und `docs/PROJECT_STATUS.md`.
- [ ] Zweimal anwendbar (Test); Upgrade einer befüllten Vorgänger-Datenbank getestet.
- [ ] CHECK-Constraints decken die im Code geschriebenen Zustände ab (Negativtests); Lücken, die nach dem Merge nur per
      `ALTER TABLE … ADD CONSTRAINT` zu schließen wären, vorher beheben.
- [ ] **Ausdrückliche Migrationsfreigabe des Betreibers** im PR („Migration NNN freigegeben“), getrennt von der Code-Freigabe.
- [ ] Nach dem Deploy: Status lesend prüfen (`node scripts/check-migration-status.cjs` mit Lesezugang des Betreibers oder
      `/api/admin/migrate` angemeldet) und Ergebnis notieren.

## 4. Nach dem Merge (Nachweis)

1. **Deployment:** Production-Deployment zum Merge-Commit suchen; Status **READY** und Commit-SHA notieren
   (Vercel-Dashboard oder Vercel-Werkzeug „list_deployments“/„get_deployment“). Bei ERROR: Build-Log lesen, nichts weiter behaupten.
2. **Laufzeitfehler:** Runtime-Fehler der ersten Stunde prüfen (Hobby-Plan: Logs nur 1 h) – neue Fehler oder keine.
3. **Production-Aufruf:** mindestens ein echter Aufruf, passend zur Änderung, z. B.
   - öffentliche Seite: `GET https://affiliate-reel-agent.vercel.app/produkte` → 200;
   - geschützte Route ohne Anmeldung: `GET /api/architecture` → 401, Seite `/` → Weiterleitung `/login`;
   - Cron-/Webhook-Wirkung: erst beim nächsten geplanten Lauf, Nachweis über die DB-Tabellen (`daily_slot_runs`,
     `model_calls`, …), nicht über Logs.
   Keine Schreibtests in Preview (teilt DB/Blob/WhatsApp/Meta mit Production); keine Aufrufe, die Kosten, Nachrichten oder Posts auslösen.
4. **Ergebnis festhalten:** Begriff aus §1 mit Nachweis in `docs/PROJECT_STATUS.md` (Tabelle „Gemergte PRs“) und in der Task-Datei.
5. **Aktivierung** (falls vorgesehen): nur durch den Betreiber in Vercel, danach Redeploy und erneuter Nachweis nach Punkt 1–3.

## 5. Rückweg

- Code: Revert-PR auf `main` (kein Force-Push); neues Deployment nach Punkt 4 prüfen.
- Schalter: Variable entfernen + Redeploy (Standard „aus“).
- Migration: additive Tabellen bleiben stehen; der vorherige Code ignoriert sie. Ein Rückbau ist eine eigene, freizugebende Entscheidung.

## 6. Übergabefeld (Vorschlag für die Task-Datei)

Bis das Schema ein eigenes Feld bekommt, steht der Release-Stand in den vorhandenen Feldern:
- `pr.state` / `pr.merge_commit` – gemergt;
- `tests[]` – je Prüfung `command`, `result`, `commit`, `at`; ergänzt um `"command": "production:deployment"` (Detail: Deployment-ID,
  READY) und `"command": "production:call"` (Detail: Route, erwartete und beobachtete Antwort);
- `next_steps` – offene Aktivierung oder Live-Verifikation mit Zuständigkeit (meist Betreiber).

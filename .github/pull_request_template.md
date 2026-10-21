<!-- Ausfüllen, nicht zutreffende Punkte mit „–“ markieren. Öffentliches Repository: keine Geschäftsdaten, keine Secrets,
     keine Werte von Umgebungsvariablen (nur Namen). Checkliste: docs/ai-business/RELEASE_CHECKLIST.md (D-05). -->

## Aufgabe
- **Task-ID:** <!-- z. B. B-03; Task-Datei docs/ai-business/coordination/tasks/<ID>/task.json -->
- **Rollen:** Planer: … · Implementierer: … · Prüfer: … <!-- Solo-Betrieb: Selbstprüfung ist kein unabhängiges Review -->
- **Status:** Draft, nicht mergen · Merge nur durch den Betreiber
- **Basis / gestapelt auf:** <!-- Basis-Commit; ggf. „erst nach #NN mergen“ -->

## Inhalt
<!-- Was ändert sich, warum, welche Dateien. Referenzmodus und KI-Modus klar unterscheiden. -->

## Akzeptanzkriterien und Nachweis
| AC | Kriterium | Nachweis (Test/Datei) |
|---|---|---|
| AC-1 | | |

## Prüfungen (mit Commit-SHA)
- Commit: `…`
- [ ] `npm run typecheck`
- [ ] `npm run lint` (bekannte Warnungen benennen)
- [ ] `npm test` – … / … bestanden
- [ ] `npm run build` (Hauptcheckout, kein Worktree mit verlinktem `node_modules`)
- [ ] CI (`check`) grün

## Sicherheit und Freigaben
- [ ] Neue Funktion hinter Schalter mit Standard „aus“; kein Schalter im Code aktiviert
- [ ] Keine kostenpflichtigen Aufrufe, Live-Posts oder Nachrichten (auch nicht in Tests)
- [ ] Neue Modellaufrufe protokollieren über `recordModelCall`
- [ ] Neue öffentliche Route: bewusst entschieden und in `tests/admin-session.test.cjs` eingetragen; interne Routen prüfen `authorized()`
- [ ] Freigabeinvarianten (Inhalt, Bild, Videokosten, Veröffentlichung; `CLAUDE.md` §4) unberührt oder ausdrücklich geprüft
- [ ] Commits ohne Modellkennung

## Migration
- [ ] Keine Migration
- [ ] Migration `NNN` (Nummer abgesprochen): nur additiv, zweimal anwendbar, an allen Pflichtstellen registriert
      (`lib/memory/migrations.ts`, `ensure-automation-schema.ts`, `tests/migration-upgrade.test.cjs`, `lib/architecture/model.ts`, Doku)
- **Achtung:** Ein Merge wendet die Migration automatisch in Production an. Sie braucht eine **eigene Migrationsfreigabe des Betreibers**
  im PR („Migration NNN freigegeben“), getrennt von der Code-Freigabe.

## Risiken und offene Punkte
<!-- Was kann schiefgehen, was ist bewusst nicht enthalten, welche Betreiberentscheidungen fehlen (z. B. Q-07). -->

## Nach dem Merge
<!-- Statusbegriffe strikt getrennt: implementiert · getestet · gemergt · deployed · aktiviert · live verifiziert.
     Nachweis: READY-Deployment zum Merge-Commit, Laufzeitfehler der ersten Stunde, ein echter Production-Aufruf. -->

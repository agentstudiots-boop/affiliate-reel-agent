# Vorprüfung von PR #6 und PR #8

Stand: 24.09.2026. Isolierte lokale Integrationsprüfung, kein Remote-Merge.

## Exakt geprüfte Stände

| Arbeitsstrang | Commit |
| --- | --- |
| PR #6: Produktionspipeline | `324dc8c57875be1b5d5413fce455a7ea4ceae59e` |
| PR #8: Bild-/Textrevisionen und Wochenbilanz | `cd7d35a7abe451a9715b30c15a7c19c0b08051db` |

PR #8 ist ein separater Draft mit Base `feat/production-gates-whatsapp`.
In einer eigenen, nicht veröffentlichten Arbeitskopie wurden beide Stände per
`git merge --no-commit --no-ff` zusammengeführt. Keine Konflikte, keine manuellen
Codeanpassungen. Der Quellcode des anderen Agenten wurde nicht verändert.

## Beobachtetes Ergebnis

- TypeScript und ESLint erfolgreich.
- Die kombinierte Testsuite besteht mit **50 Tests**. Die sieben Handler-
  Integrationstests aus PR #6 bestehen auch mit den Erweiterungen von PR #8.
- Next.js-Build erfolgreich. Der erste Versuch scheiterte ausschließlich an
  einer externen `node_modules`-Verknüpfung der lokalen Prüfumgebung; nach
  regulärem `npm ci` lief derselbe Quellcode ohne Änderung erfolgreich durch.
- Der erzeugte Migrations-Handler enthält alle acht SQL-Dateien 001–008.
- GitHub Quality und Vercel-Commitstatus des oben genannten PR-#8-Heads sind
  ebenfalls erfolgreich. Das ist dessen eigener Build, kein Remote-Build der
  nur lokal kombinierten Fassung.

Die Tests verwenden eine isolierte Datenbank und simulierte Provider. Sie
belegen weder echte WhatsApp-Zustellung noch Remote-Postgres-Parallelität,
Facebook-Schreibberechtigung, Faceless-Videoerstellung oder Live-Wochenberichte.

## Reihenfolge für die spätere Integration

1. PR #6 auf seinem eigenen Preview weiter verifizieren. Seine geschützte
   Migrationsroute kennt ausschließlich 001–006. **Nicht das Preview von PR #8
   für den Nachweis „nur Migration 006 anwenden“ verwenden.** Dort würden auch
   die offenen Migrationen 007/008 ausgeführt.
2. Die bestehenden Freigabenachweise von PR #6 abschließen; erst danach den
   vorgesehenen Merge-/Production-Prozess durchführen.
3. PR #8 anschließend gegen den tatsächlichen neuen Basisstand aktualisieren
   und die kombinierte Prüfung wiederholen, falls seit den oben fixierten SHAs
   weiterer Code hinzugekommen ist.
4. In einem separaten Preview Migrationen 007/008 prüfen und den echten
   Bild-/Text-Änderungsdialog sowie Wochenbericht verifizieren. Der erweiterte
   WhatsApp-Handler fragt `weekly_reports` ab; die Migration ist daher eine
   Voraussetzung für seinen Betrieb, auch bei normalen Freigaben.
5. Den Wochen-Cron und die beiden getrennten Tages-/Wochenvorlagen erst nach
   den jeweiligen Betriebs- und Kostenfreigaben aktiv verwenden.

## Unverändert offen

Nachtrag 24.09., ca. 08:28 UTC: Der folgende Vercel-403 wurde durch erneute
Autorisierung behoben. Aktuelle Nachweise und verbleibende Grenzen stehen in
[VERIFICATION.md](VERIFICATION.md). Die Migration und echten E2E bleiben offen.

Der Vercel-Connector wurde erneut geprüft und ist weiterhin nur für
`thorsten1988la-1943` autorisiert. Das Projekt-Team `agentstudiots-boop` antwortet
mit 403. Für Runtime-Logs und Live-Konfiguration muss diese Verbindung korrigiert
werden. Die zuvor abgelehnte sichere Eingabe für den Migrations-POST wurde nicht
erneut versucht. Kein Zugangscode erhoben, kein echter Job erstellt, kein
WhatsApp-Versand, kein Facebook-Post und kein Faceless-Kauf ausgelöst.

Beide PRs bleiben Draft; die erfolgreiche Vorprüfung ist keine Merge-Freigabe.

# Image Quality Manager: Verifikation (Audit P-03)

Stand der Belege: **IMPLEMENTIERT, LOKAL GETESTET (Mocks), GEMERGT (#62), DEPLOYED** (Production-Deployment `72cc3ab`, `READY`).
**NICHT live verifiziert:** (1) Migration 034 in der Produktionsdatenbank, (2) die Bildfähigkeit des Vision-Modells.

## 1. Vision-Modell: Konfiguration (aus dem Code)
- Modell: `IMAGE_QUALITY_MODEL`, sonst `ROUTER_MODEL = "openai/gpt-5.6-terra"` (`lib/whatsapp/route-llm.ts`). Die Variable ist in Vercel **nicht gesetzt** (nur Variablennamen geprüft) → es gilt der Standard.
- Aufruf: `replicateObserve()` in `lib/content/image-quality/gate.ts` → `routerModelCall()` → `POST https://api.replicate.com/v1/models/{model}/predictions` mit `input.image_input = [bildUrl]`, `system_prompt`, `prompt`, `max_completion_tokens: 900`. Die Antwort wird mit `visionSchema` (strict) validiert; die Entscheidung trifft `decide()` im Code.
- Sicherheitsverhalten (durch Tests belegt): Fehler, ungültiges Schema, `unclear` und `confidence < 0.6` ⇒ **nie freigegeben**. Die Produktidentität wird nie bestätigt (`identity: "not_verifiable"`).
- **Offen:** Existiert der Modellname bei Replicate, akzeptiert er `image_input`, und sieht er das Bild wirklich? Aus dieser Umgebung nicht prüfbar (Zugriff auf replicate.com gesperrt, kein kostenpflichtiger Aufruf erlaubt).

## 2. Smoke-Test (reproduzierbar, in drei Stufen)
```
npx tsc -p tsconfig.test.json
node scripts/vision-smoke-test.cjs                      # Stufe 0: offline, kostenlos – Konfiguration und Fehlerbehandlung
REPLICATE_API_TOKEN=… node scripts/vision-smoke-test.cjs --metadata   # Stufe 1: kostenloser GET – Modell vorhanden? image_input deklariert?
REPLICATE_API_TOKEN=… VISION_SMOKE_APPROVED=1 node scripts/vision-smoke-test.cjs --live   # Stufe 2: GENAU EIN kostenpflichtiger Aufruf
```
Stufe 2 sendet ein synthetisches 64×64-Bild (rotes Quadrat auf Weiß) mit dem Briefing „blauer Kreis“. Bestanden ist sie nur, wenn
(a) das Modell erreichbar ist und die Bildeingabe akzeptiert, (b) die Antwort dem Schema entspricht, (c) `depicted_main_subject` das rote Quadrat benennt (ein blindes Modell kann das nicht wissen), (d) das geforderte Motiv als nicht sichtbar gemeldet wird und (e) `decide()` das Bild **nicht** freigibt.
Kosten: ein Replicate-Aufruf mit höchstens 900 Ausgabetoken (voraussichtlich wenige Cent; **nicht gemessen**). **Stufe 2 wurde nicht ausgeführt; sie braucht die ausdrückliche Freigabe des Betreibers.**
Fällt Stufe 1 durch (Modell unbekannt), `IMAGE_QUALITY_MODEL` in Vercel auf ein bei Replicate vorhandenes bildfähiges Modell setzen und Stufe 1/2 wiederholen. Bis dahin stoppt jedes Bild mit dem Hinweis „Automatische Bildprüfung nicht möglich“ (kein Fehlfreigabe-Risiko, aber auch kein automatischer Bildpost).

## 3. Migration 034: Status prüfen (nur lesend)
```
DATABASE_URL=<Produktions-URL, Lesezugriff genügt> node scripts/check-migration-status.cjs
```
Das Skript läuft in `BEGIN READ ONLY` (die Datenbank lehnt jeden Schreibzugriff ab), gibt die Verbindungs-URL nie aus und meldet fehlende Migrationen sowie die vier Tabellen aus 034. Exit 0 = alles angewendet, 2 = etwas fehlt, 1 = Prüfung nicht möglich.
**Nicht ausgeführt** (kein Produktionszugang in dieser Sitzung; Laufzeitprotokolle zeigten seit dem Deployment keine Anfrage, daher kein Beleg).

### Wie 034 in Produktion ankommt
Die Migration läuft automatisch beim ersten Webhook-/Cron-Aufruf (`ensureAutomationSchema` → `applyMigrations`, transaktional, Advisory-Lock `83624001`, nur `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`, rein additiv). Eine manuelle Ausführung ist `npm run db:migrate` (wendet **alle** fehlenden Migrationen an) bzw. der Studio-Pfad `/api/admin/migrate`.

### Migrationsplan (nur nach Freigabe auszuführen)
1. Vorher: Neon-Branch/Snapshot als Rücksicherungspunkt anlegen.
2. `node scripts/check-migration-status.cjs` – Ausgangszustand dokumentieren.
3. Migration anwenden (oder den ersten Cron/Webhook abwarten).
4. `node scripts/check-migration-status.cjs` erneut: Exit 0 und „034 angewendet und Tabellen vorhanden“.
5. Fachlich: ein Probelauf eines Bildauftrags erzeugt eine Zeile in `image_generation_attempts` (nur nach separater Kostenfreigabe).

### Rollback (Annahme: 034 ist additiv, nur die vier neuen Tabellen)
Zuerst den vorherigen Code (vor `72cc3ab`) wieder ausliefern – er kennt die Tabellen nicht –, dann:
```sql
BEGIN;
DROP TABLE IF EXISTS image_quality_experiences, image_generation_grants, image_quality_notices, image_generation_attempts;
DELETE FROM schema_migrations WHERE name = '034_image_quality.sql';
COMMIT;
```
Das löscht gespeicherte Bildversuche, Hinweise und Lernerfahrungen. Ohne Datenverlust-Bedarf besser **nicht** zurückrollen, sondern vorwärts beheben. Achtung: `ensureAutomationSchema` legt die Tabellen beim nächsten Aufruf des aktuellen Codes erneut an.

## 4. Lernen aus Qualitätsfehlern (Befund)
`image_quality_experiences` speichert strukturierte Befunde; `lessonsFor()` (`lib/content/image-quality/learning.ts`) bildet daraus feste Hinweisvorlagen, wenn eine Regel Score ≥ 3 aus ≥ 2 Aufträgen hat und entweder eine erfolgreiche Korrektur oder menschliche Evidenz vorliegt. Das ist **regelbasierte Statistik, kein modellgestütztes Lernen** (kein Modellaufruf). Wirksam erst nach mehreren echten Fehlfällen; bis dahin ist die Lernschicht leer.

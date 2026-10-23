# J-02 Sicherheitsreview – Claude-Hälfte (20.10.2026)

Geprüft: `origin/main...claude/J-03-cost-limits` und `origin/main...claude/H-04-enterprise-panel`, nur lesend; jeder Befund im Code nachgeprüft.
Eingebunden sind nur `/api/cron/executive-cycle` (`EXECUTIVE_ENABLED` aus, nicht geplant), `enterprise` in `/api/architecture` und `controlling` in `/api/operations`.

| ID | Stufe | Befund | Korrektur |
|---|---|---|---|
| M1 | mittel (latent) | Budgetbetrag nur im frei übergebenen `subjectKey`, nicht im Fingerprint und nicht im angezeigten Text; Schritt nicht gegen das Register geprüft. Auch von Session 2 in #104 gemeldet. | B-06 `ec54358`: Register-Prüfung, `subjectKey`+`planId` im Fingerprint, `executive.budget_change` nur strukturiert (Schlüssel und Betrag im Betreff aus denselben Werten), `budget:` reserviert · B-09 `37ab038` · J-03 `e709752` |
| L1 | niedrig | H-Stack enthielt `reserveBudget(..., { limitCents })` vor B-09 | H-01 enthält B-09 (`7b60880`); Kern auf J-03 und H-04 identisch |
| L2 | niedrig | Zeitlimit bricht Handler nicht ab, wurde als `failed/internal` gebucht | B-07 `aa3f0b3`: `outcome_unknown` (keine Wiederholung, Reservierungen strittig) |
| L3 | niedrig | `resolveDispute(db, id, 0)` gab strittige Reservierung ohne Nachweis frei | B-05 `6d62a84`: Quelle + Akteur Pflicht, Ereignis `dispute_resolved` |
| L4 | niedrig | `leaseNext` bis zu 1000 Transaktionen je Aufruf | B-03 `6105ff0`: höchstens 50 |

Hinweise für die spätere Einbindung (kein Handlungsbedarf jetzt):
- `trustedWaId` nur aus der Serverkonfiguration, nie aus der Nachricht.
- `attachRequestMessage` nur mit der ID, die der Versand genau dieser Vorlage zurückgibt; Antworten im Webhook exklusiv zuordnen.
- AbortSignal für Abteilungen mit der ersten kostenpflichtigen Abteilung (Vertragsänderung B-04).
- Obergrenzen für `maxModelCalls`/`budget.*` und Größe von `result.output` beim Einbinden ergänzen.
- `budgets.approved_decision_id` ohne Fremdschlüssel: nur mit direktem DB-Schreibzugriff umgehbar.

Ohne Befund: Auth/Cron-Secret, Runtime-Guard-Reihenfolge, SQL parametrisiert, Freigaben (nur `whatsapp_operator`, wörtliches Wortset,
Antwort auf genau die Anfrage), Planer (Stufe aus dem Register), Lease/Fencing, Datenexposition, Migrationen 039–041 additiv.

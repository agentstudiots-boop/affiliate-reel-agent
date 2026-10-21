# Bewertung „Immobilienanalyse“ als Opportunity (Aufgabe I-01)

Stand: 21.10.2026 · Grundlage: Bewertungsraster F-01 (`lib/enterprise/opportunity/scoring.ts`) und Wirtschaftlichkeitsrechnung
F-04 (`lib/enterprise/opportunity/economics.ts`) · Eingaben: `tests/fixtures/i01-real-estate.json` · Nachrechnung:
`tests/enterprise-i01-real-estate.test.cjs` (prüft, dass die Zahlen und das Ergebnis in diesem Dokument zum Code passen).

## Ergebnis

**Daten fehlen** – weder Go noch No-Go.

- Raster F-01: Empfehlung **blocked**, Konfidenz **0,06** (3 von 14 Kriterien als Annahme mit Konfidenz 0,3; 11 Kriterien fehlen),
  Gesamtwert **unbekannt** (Gewichte und Schwellen sind Betreiberentscheidung Q-07).
- Wirtschaftlichkeit F-04: **insufficient_data** – kein Investitionsbedarf, keine Gewinnspanne, keine Messwerte; Amortisation unbekannt.
- Test empfohlen: **nein**.

Ein **No-Go** wäre nicht begründet: Es gibt keinen belegten Ausschlussgrund, nur fehlende Belege. Ein **Go** ist ausgeschlossen, solange
die K.O.-Fragen der Rechtscheckliste (I-02) offen sind. Deshalb wird I-03 (Abteilungsskelett) **nicht** gebaut.

## Vorgehen und Grenzen

- Jede Angabe ist eine **Annahme mit Quelle** oder fehlt („unbekannt“). Es gibt **keine Marktdaten** (Marktgröße, Preise, Wettbewerber,
  Erlöse) und **keine Geschäftszahlen des Betreibers** – beides wurde nicht erhoben, weil Recherche Budget braucht (Phase I:
  „Recherchebudget; mögliche Datenlizenzen – Betreiberentscheidung L4“) und das Repository öffentlich ist.
- Bewertet (Favorabilität 1–5) wird **nichts**: Ohne Daten wäre jede Note erfunden. Alle Einträge haben `score: null`.
- Die Nachrechnung nutzt die echten Funktionen `evaluateOpportunity` und `assessEconomics` ohne Gewichte (`config = null`).

## Raster F-01 je Kriterium

| Kriterium | Stand | Art / Konfidenz | Grundlage bzw. was fehlt |
|---|---|---|---|
| Marktpotenzial | unbekannt | – | Marktgröße und Nachfrage je Zuschnitt (I-02 §1); Recherche mit Budget |
| Zielgruppe | Annahme | assumption / 0,3 | Offen zwischen Gebietsinhalten für Privatpersonen und Analysen einzelner Objekte (K-05, I-02 §1) |
| Wettbewerb | unbekannt | – | bestehende Portale/Analyseangebote; Recherche |
| Eintrittsbarrieren | unbekannt | – | hängt an Datenzugang und Erlaubnisfragen (I-02 §3, §5) |
| Investitionsbedarf | unbekannt | – | Datenlizenzen, Einrichtung; Angebote nötig (I-02 4.6) |
| Laufende Kosten | unbekannt | – | Lizenzen, Modellaufrufe; erst mit gewählten Quellen |
| Umsatz-/Gewinnpotenzial | unbekannt | – | Erlösmodell offen (I-02 1.3); als Prognose nur mit offengelegter Formel |
| Skalierbarkeit | unbekannt | – | hängt an Lizenzumfang und Automatisierbarkeit |
| Amortisationsdauer | unbekannt | – | folgt aus Investition und Gewinnspanne (F-04) |
| Technische Umsetzbarkeit | unbekannt | – | erst mit konkreten Datenquellen (Zugriffsweg, Format) |
| Automatisierungsgrad | unbekannt | – | Freigabeinvarianten bleiben; Anteil automatisierbarer Schritte offen |
| Rechtliche Risiken | Annahme | assumption / 0,3 | sechs benannte, ungeprüfte Risiken = K.O.-Fragen 3.1, 3.2, 4.4, 5.1, 5.2, 6.1 aus I-02 |
| Abhängigkeit von Drittanbietern | Annahme | assumption / 0,3 | Datenquellen (noch keine gewählt), Tavily, Replicate |
| Voraussichtliche Trenddauer | unbekannt | – | Prognose nur mit Formel und Quelle |

## Wirtschaftlichkeit F-04

- Formel (aus dem Code): Amortisation (Monate) = Investition / monatlicher Gewinn nach direkten Kosten; als Spanne.
- Investition, Gewinnspanne und Amortisation: **unbekannt** („nicht bewertet“).
- Messwerte aus einer Testphase: keine. Urteil: **insufficient_data**; eine Betreiber-Obergrenze für die Amortisation ist ebenfalls
  noch nicht festgelegt (Q-07).

## Offene Fragen (aus der Rechtscheckliste I-02, PR #111)

Ausschlusskriterien, die vor jedem Go geklärt sein müssen:

- **3.1 / 3.2** Erlauben die Nutzungsbedingungen den Zugriffsweg und die gewerbliche Nutzung?
- **4.4** Werden Fotos, Grundrisse oder Kartenkacheln Dritter verwendet – mit Nutzungsrecht?
- **5.1 / 5.2** Reicht das Angebot in Anlageberatung/-vermittlung oder Immobilien-/Darlehensvermittlung?
- **6.1** Werden personenbezogene Daten verarbeitet, und sind 6.2–6.10 geklärt?

Weitere offene Punkte: Zuschnitt und Erlösmodell (§1), Quelleninventar (§2), Lizenzkosten (§4.6), Pflichthinweise (§5.5).

## Was für eine echte Bewertung nötig ist (Betreiberentscheidungen)

1. **Zuschnitt festlegen** (I-02 §1): z. B. nur aggregierte Gebietsinhalte ohne Einzelobjekte und ohne Empfehlungen – das senkt
   die Risiken 5.1, 5.2 und 6.1 deutlich, ist aber eine Annahme, bis es geprüft ist.
2. **Recherchebudget freigeben** (L4): Marktpotenzial, Wettbewerb, Datenquellen mit Bedingungen und Preisen.
3. **Gewichte und Schwellen** für das Raster festlegen (Q-07), inkl. maximaler Amortisationsdauer.
4. **Rechtliche Prüfung** der K.O.-Fragen durch eine zugelassene Person (I-02 §7).

Danach wird die Fixture mit den neuen Annahmen und Quellen ergänzt und die Nachrechnung erneut ausgeführt; die Empfehlung ändert
sich nur über diese Daten, nie durch Handanpassung dieses Dokuments.

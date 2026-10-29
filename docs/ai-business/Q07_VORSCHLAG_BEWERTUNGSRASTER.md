# Vorschlag zu Q-07: Gewichte, Schwellen, Amortisationsgrenze und Budget des Opportunity Scouts

Stand: 29.10.2026 · **Entwurf, nicht wirksam.** Q-07 entscheidet der Betreiber. Bis dahin bleibt
`lib/enterprise/opportunity/operator-config.ts` auf `null`. Jede Bewertung bleibt damit „blocked“, und der Schalter
`OPPORTUNITY_SCOUT_ENABLED` bleibt aus.

Die Werte stehen maschinenlesbar in `tests/fixtures/q07-proposal.json`. Der Test `tests/enterprise-q07-proposal.test.cjs` rechnet
sie mit den echten Funktionen `evaluateOpportunity` (F-01) und `assessEconomics` (F-04) nach. Er prüft, dass die Zahlen in diesem
Dokument zum Code passen und dass der Entwurf noch nicht in der Betreiberkonfiguration steht.

## 1. Was zu entscheiden ist

| Punkt | Wirkung im Code | Vorschlag |
|---|---|---|
| Gewichte der 14 Kriterien | Gesamtwert = Σ Gewicht · Note / Σ Gewicht (Noten 1–5, höher = besser) | Tabelle §2, Summe 100 |
| Mindestgesamtwert | darunter „nicht empfohlen“ | **3,5** von 5 |
| Mindestkonfidenz | darunter „blocked“ | **0,5** |
| Maximale Amortisationsdauer | Prognose im ungünstigen Fall bzw. Messwert muss darunter liegen, sonst kein Test | **12 Monate** |
| Ausschlusskriterien | im Code **nicht** abgebildet | Liste §4, vorerst Prüfung durch den Betreiber |
| Kostenbremse | Tageslimit `OPPORTUNITY_DAILY_LIMIT` (Standard 3, höchstens 10) | **2 Prüfungen pro Tag** |

## 2. Gewichte (Vorschlag)

Leitgedanke: Ein Solo-Betreiber mit wenig Zeit und ohne Kapitalpuffer. Deshalb zählen Geld rein, wenig Geld raus und schnelle
Amortisation am meisten (zusammen 40). Danach folgen Markt und Automatisierbarkeit. Kein Gewicht ist 0, weil ein Kriterium mit
Gewicht 0 trotzdem bewertet sein muss (siehe §5).

| Kriterium | Gewicht | Begründung |
|---|---|---|
| Marktpotenzial | 10 | ohne Nachfrage kein Erlös |
| Zielgruppe | 4 | wichtig, aber meist nur Text, schwer zu benoten |
| Wettbewerb | 7 | starker Wettbewerb drückt Preise und Reichweite |
| Eintrittsbarrieren | 5 | niedrige Barrieren helfen beim Start, schützen aber nicht |
| Investitionsbedarf | 10 | kein Kapitalpuffer |
| Laufende Kosten | 8 | monatliche Belastung auch ohne Erlös |
| Umsatz-/Gewinnpotenzial | 12 | Kern der Wirtschaftlichkeit (Gewinn nach direkten Kosten) |
| Skalierbarkeit | 6 | Wachstum ohne Mehrarbeit |
| Amortisationsdauer | 10 | Geld muss schnell zurückkommen |
| Technische Umsetzbarkeit | 6 | mit dem bestehenden System machbar? |
| Automatisierungsgrad | 8 | Zeit des Betreibers ist der Engpass |
| Rechtliche Risiken | 8 | Abmahn- und Haftungsrisiko |
| Abhängigkeit von Drittanbietern | 3 | betrifft fast jede Idee, unterscheidet wenig |
| Voraussichtliche Trenddauer | 3 | Prognose mit hoher Unsicherheit |
| **Summe** | **100** | |

## 3. Schwellen und Amortisation

- **Mindestgesamtwert 3,5:** Eine Idee mit lauter Noten von 3 („mittel“) ergibt 3,0 und wird *nicht empfohlen*. Lauter Noten
  von 4 ergeben 4,0. Nur eine überwiegend gute Idee kommt durch.
- **Mindestkonfidenz 0,5:** Die Konfidenz ist der Mittelwert über alle 14 Kriterien. Fehlende Kriterien zählen mit 0. Aussagen
  ohne abgerufene Quelle sind auf 0,3 begrenzt (F-03). Beispiel: 6 Kriterien mit Quelle bei 0,8 und 8 ohne Quelle bei 0,3
  ergeben 0,51. Das reicht knapp. Mit 0,6 bräuchte es etwa 9 belegte Kriterien, was mit 3 Websuchen kaum erreichbar ist.
- **Amortisation höchstens 12 Monate**, gemessen am ungünstigen Ende der Prognosespanne:
  - Investition 300 EUR und Gewinn 50–150 EUR/Monat ergeben 2–6 Monate: *innerhalb*.
  - Investition 300 EUR und Gewinn 20–100 EUR/Monat ergeben 3–15 Monate: *außerhalb*.
  - Ist nur der niedrigste Gewinn ≤ 0 (der höchste aber positiv), ist das Ergebnis immer *außerhalb*.
  - Ist schon der höchste Gewinn ≤ 0, gibt es keine Amortisationsprognose: Ergebnis *unzureichende Daten*, ebenfalls kein Test.

  Sobald eine Testphase Messwerte hat, entscheiden nur diese.

## 4. Ausschlusskriterien (Vorschlag, Betreiberentscheidung)

Der Code kennt heute keine Ausschlussliste. Bis zu einer eigenen Code-Änderung prüft der Betreiber diese Punkte selbst,
bevor er einen Test freigibt.

1. **Regulierte Beratung oder Vermittlung:** Anlage-, Steuer-, Rechts-, Gesundheits- und Immobilien- oder Darlehensvermittlung.
   Vergleiche I-02 5.1/5.2.
2. **Glücksspiel, Finanzspekulation, Erotik, Waffen, Strukturvertrieb (MLM).**
3. **Verarbeitung personenbezogener Daten Dritter** in größerem Umfang (I-02 6.1). Ausnahme nur nach Datenschutzprüfung.
4. **Investition über 500 EUR** oder **neues Abonnement** ohne eigene Betreiberentscheidung. Das ist der Betrag für
   „Mindestkapital und Risikobereitschaft“ aus Q-07 und als Vorschlag zu verstehen.
5. **Fremde Inhalte ohne Nutzungsrecht:** Fotos, Grundrisse, Kartenkacheln, Datenbanken (I-02 3.x/4.4).

## 5. Was die Werte praktisch bedeuten (ehrliche Erwartung)

- **Jedes fehlende Kriterium blockiert die Empfehlung**, unabhängig vom Gewicht (`evaluateOpportunity`). Die Recherche lässt
  ein Kriterium bewusst weg, wenn sie nichts weiß. Viele WhatsApp-Prüfungen werden deshalb mit „keine Empfehlung möglich“ enden.
  Sie zeigen dann je Kriterium, was belegt ist und was fehlt. Das ist gewollt: lieber „unbekannt“ als erfunden.
- Die Amortisation zählt nur, wenn Investitionsbedarf und Gewinnspanne gültig sind (in EUR bzw. EUR/Monat).
- „Test empfohlen“ ist nie eine Freigabe. Jeder nächste Schritt braucht weiter eine ausdrückliche Entscheidung des Betreibers.

## 6. Kosten und Budget

- **Je Prüfung höchstens 3 Tavily-Suchen** (je 5 Ergebnisse) **und 1 Modellaufruf** über das Router-Modell, mit höchstens 3000
  Ausgabe-Tokens. Es gibt keine Wiederholungen (F-03).
- **Mit dem Tageslimit 2:** höchstens 62 Prüfungen im Monat, also 186 Suchen und 62 Modellaufrufe im ungünstigsten Fall.
  Realistisch sind es nur so viele, wie der Betreiber per WhatsApp anstößt.
- **Euro-Beträge sind nicht angegeben**, weil im Repository keine belegten Preise stehen. Die Preise trägt der Betreiber im
  Betriebsbereich ein (`/api/controlling/prices`). Formel je Prüfung:
  3 × Preis je Tavily-Suche + Eingabe-Tokens × Eingabepreis + Ausgabe-Tokens × Ausgabepreis.
- **Lücken, die vor der Aktivierung geschlossen werden sollten** (Paket P3b, eigener PR):
  1. Der Modellaufruf landet in `model_calls` und damit im Controlling. **Die Tavily-Suchen werden nirgends gezählt.** Die
     Bewertung speichert `cost_cents = 0`.
  2. Ein Lauf, den das Zeitlimit der Funktion abbricht, bleibt im Status `researching` hängen (bekannte Grenze aus Review #120).
     Eine Aufräumfunktion darf ihn nur beenden, nicht erneut recherchieren.
  3. Ein hartes Monatsbudget gibt es nicht. Begrenzt wird nur über das Tageslimit (Q-08 Abteilungsbudgets ist ebenfalls offen).

## 7. Weg zur Aktivierung (je Schritt ein PR, Notaus bleibt die Umgebungsvariable)

1. **Betreiber entscheidet Q-07:** übernimmt §2–§4 unverändert oder nennt geänderte Werte.
2. **PR „Q-07 Betreiberkonfiguration“:** setzt `SCORING_CONFIG` und `ECONOMICS_LIMITS` in `operator-config.ts` mit Version und
   Datum der Entscheidung.
3. **PR P3b:** zählt die Tavily-Suchen, schreibt echte Kosten statt 0 und beendet hängende `researching`-Läufe.
4. **Rollout-PR `OPPORTUNITY_SCOUT_ENABLED`:** dafür muss der Schalter über `lib/config/rollout.ts` laufen (bisher nur
   `process.env`), dazu `OPPORTUNITY_DAILY_LIMIT=2`. Der Funktionsnachweis ist eine echte Prüfung per WhatsApp
   („Geschäftsidee prüfen: …“) mit Eintrag in `opportunity_assessments` und `model_calls`.

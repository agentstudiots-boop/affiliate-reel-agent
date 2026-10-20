# Datenquellen- und Rechtscheckliste – Vorlage (Aufgabe I-02)

Vorlage für den Betreiber zur Machbarkeitsprüfung einer möglichen Abteilung „Immobilienanalyse“ (Roadmap Phase I, ADR-11,
Kritik K-05). Sie ergänzt die Bewertung als Opportunity (I-01, Raster F-01: Kriterien `legalRisks`, `thirdPartyDependency`,
`investmentNeed`, `runningCosts`). Eine Abteilung wird erst nach dieser Prüfung gebaut (I-03 nur bei Go, Schalter aus).

> **Keine Rechtsberatung.** Diese Liste enthält nur Prüffragen und benennt Rechtsgebiete, die einschlägig sein *können*. Sie trifft
> keine rechtliche Bewertung und ersetzt keine Prüfung durch eine dafür zugelassene Person (Rechtsanwalt, Steuerberater,
> Datenschutzbeauftragter). Ob eine Vorschrift greift, entscheidet allein diese Prüfung.

> **Öffentliches Repository.** Hier liegt nur die leere Vorlage. Die **ausgefüllte** Fassung mit Quellen, Verträgen, Kosten,
> Ansprechpartnern oder Prüfergebnissen gehört **nicht** ins Repository, sondern in einen privaten Ablageort des Betreibers.
> In Übergabedateien, PRs und Commits steht höchstens: „I-02 ausgefüllt am …, Ergebnis Go/No-Go/offen“.

## 0. Gebrauch

- Jede Frage bekommt einen **Status**: `offen` · `geklärt` · `nicht anwendbar` – und bei `geklärt` einen **Nachweis**
  (Dokument, Datum, wer hat geprüft). Eine Antwort ohne Nachweis bleibt `offen`.
- Fragen mit **[K.O. wenn: …]** sind Ausschlusskriterien; jede nennt ihre Bedingung selbst, denn je nach Frage ist „ja“ oder „nein“
  die unbedenkliche Antwort. Trifft die Bedingung zu oder ist die Frage noch `offen`, lautet das Ergebnis in §7 **kein Go**.
- Annahmen und Fakten getrennt halten (Abnahme Phase I): Was nur vermutet wird, steht unter „Annahme“, nicht unter „Antwort“.
- Keine Datenbeschaffung, kein Test-Abruf einer Quelle und keine kostenpflichtige Lizenz während des Ausfüllens ohne
  ausdrückliche Freigabe (Phase I: „keine Datenbeschaffung ohne Freigabe“; Lizenzen sind Betreiberentscheidung L4).

Antwortschema je Frage:

```
Antwort:   …
Status:    offen | geklärt | nicht anwendbar
Nachweis:  … (Dokument/Datum/geprüft von) – nur in der privaten Fassung
Annahme:   … (falls die Antwort nicht belegt ist)
```

## 1. Zweck und Zuschnitt der Abteilung

Ohne klaren Zuschnitt lassen sich die übrigen Fragen nicht beantworten.

| # | Prüffrage | Antwort | Status |
|---|---|---|---|
| 1.1 | Was genau soll die Abteilung liefern (z. B. allgemeine Marktberichte, Inhalte für Social Media, Analysen einzelner Objekte, Einschätzungen für einzelne Personen)? | | |
| 1.2 | Für wen – Öffentlichkeit, zahlende Kunden, nur den Betreiber selbst? | | |
| 1.3 | Wie wird Geld verdient (Werbung/Affiliate, Verkauf von Berichten, Vermittlungsprovision, Abonnement)? | | |
| 1.4 | Werden Aussagen über **einzelne** Objekte, Adressen oder Eigentümer gemacht oder nur über aggregierte Gebiete? | | |
| 1.5 | Gibt es Empfehlungen („kaufen“, „gute Rendite“), Bewertungen in Euro oder nur Beschreibungen? | | |
| 1.6 | Welche Teile laufen automatisch (Recherche, Text, Veröffentlichung) und wo gibt der Betreiber frei? (Bestehende Freigabeinvarianten gelten unverändert.) | | |

## 2. Datenquellen – Inventar

Eine Zeile je Quelle. Arten z. B.: amtlich/offene Daten · kommerzieller Anbieter mit Vertrag · Online-Portal · eigene Erhebung ·
Nutzer-Eingabe. Eine Quelle ohne Eintrag in dieser Tabelle wird nicht genutzt.

| Quelle (Name) | Art | Zugriff (API / Download / manuell / automatisiertes Auslesen) | Inhalt | personenbezogen? | Lizenz / Bedingungen | Kosten | Aktualität | Status |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Je Quelle:

| # | Prüffrage | Antwort | Status |
|---|---|---|---|
| 2.1 | Wer ist Rechteinhaber bzw. Anbieter, und gibt es einen erreichbaren Ansprechpartner für Lizenzfragen? | | |
| 2.2 | Wie verlässlich und wie aktuell sind die Daten; gibt es eine dokumentierte Methodik? | | |
| 2.3 | Was passiert, wenn die Quelle entfällt oder die Bedingungen ändert (Ersatzquelle, Kündigungsfrist)? → Raster `thirdPartyDependency` | | |
| 2.4 | Entstehen laufende Kosten oder Mindestlaufzeiten? → Raster `runningCosts`, Budget nur per L4-Entscheidung | | |

## 3. Nutzungsbedingungen

| # | Prüffrage | Antwort | Status |
|---|---|---|---|
| 3.1 | **[K.O. wenn: nein oder unklar]** Erlauben die Nutzungsbedingungen den geplanten Zugriffsweg? Insbesondere: Ist automatisiertes Auslesen (Scraping, Crawler) ausdrücklich erlaubt, verboten oder nicht geregelt? | | |
| 3.2 | **[K.O. wenn: nein oder unklar]** Ist die **gewerbliche** Nutzung erlaubt? | | |
| 3.3 | Gibt es Vorgaben zu Abrufhäufigkeit, API-Schlüsseln, technischen Schutzmaßnahmen oder `robots.txt`, die eingehalten werden müssen? | | |
| 3.4 | Dürfen Daten oder Auszüge **veröffentlicht** oder an Dritte weitergegeben werden, oder nur intern ausgewertet? | | |
| 3.5 | Dürfen abgeleitete Ergebnisse (Statistiken, Karten, Texte) veröffentlicht werden, und mit welcher Quellenangabe? | | |
| 3.6 | Dürfen die Daten an KI-Modelle bzw. Dienstleister übermittelt werden (heute u. a. Replicate, Tavily, Neon, Vercel)? Ist die Nutzung für das Training fremder Modelle ausgeschlossen? | | |
| 3.7 | Prüfen lassen: Kann ein Schutzrecht des Datenbankherstellers (z. B. §§ 87a ff. UrhG) betroffen sein, wenn wesentliche Teile einer Datenbank entnommen werden? | | |
| 3.8 | Wer haftet bei Verstoß; gibt es Vertragsstrafen oder Sperrklauseln? | | |

## 4. Lizenzen und Urheberrechte

| # | Prüffrage | Antwort | Status |
|---|---|---|---|
| 4.1 | Unter welcher Lizenz stehen offene Daten (z. B. Datenlizenz Deutschland, Creative Commons, ODbL bei Kartendaten)? Ist die Lizenzversion festgehalten? | | |
| 4.2 | Welche Pflichten folgen daraus (Namensnennung, Weitergabe unter gleichen Bedingungen, Kennzeichnung von Änderungen)? Wie und wo wird die Namensnennung angezeigt? | | |
| 4.3 | Sind Lizenzen verschiedener Quellen miteinander **und** mit gewerblicher Nutzung vereinbar? | | |
| 4.4 | **[K.O. wenn: Material Dritter wird verwendet und das Nutzungsrecht fehlt oder ist unklar]** Werden Fotos, Grundrisse, Exposé-Texte oder Kartenkacheln Dritter verwendet? Falls ja: Liegt dafür ein Nutzungsrecht vor? | | |
| 4.5 | Wer hält die Rechte an selbst erzeugten Inhalten (Texte, KI-Bilder), und widersprechen die Bedingungen der Modellanbieter der geplanten Nutzung? | | |
| 4.6 | Bei kostenpflichtigen Lizenzen: Umfang (Nutzer, Abrufe, Gebiet), Laufzeit, Preis – Freigabe nur als L4-Entscheidung über das Budget (B-05/B-09). | | |

## 5. Beratungsabgrenzung

Ziel: klären, ob das Angebot in einen erlaubnis- oder berufsrechtlich geregelten Bereich hineinreicht. Die genannten Gebiete
sind Prüfhinweise, keine Einordnung.

| # | Prüffrage | Antwort | Status |
|---|---|---|---|
| 5.1 | **[K.O. wenn: ja oder unklar, solange eine etwa erforderliche Erlaubnis nicht nachgewiesen ist]** Prüfen lassen: Kann das Angebot als Anlageberatung, Anlage- oder Finanzanlagenvermittlung verstanden werden (z. B. Empfehlungen zu Kauf/Verkauf, Renditeaussagen; mögliche Bezüge: KWG, § 34f GewO)? | | |
| 5.2 | **[K.O. wenn: ja oder unklar, solange eine etwa erforderliche Erlaubnis nicht nachgewiesen ist]** Prüfen lassen: Wird Immobilien- oder Darlehensvermittlung betrieben oder angebahnt, etwa durch Provisionen oder Weiterleitung von Interessenten (mögliche Bezüge: § 34c, § 34i GewO)? | | |
| 5.3 | Prüfen lassen: Enthalten Ausgaben Einschätzungen im Einzelfall, die als Rechts- oder Steuerberatung gelten könnten (mögliche Bezüge: RDG, StBerG)? | | |
| 5.4 | Werden Wertangaben gemacht, die mit einem Verkehrswertgutachten verwechselt werden können (mögliche Bezüge: ImmoWertV, Sachverständigenwesen)? Wie wird das ausgeschlossen? | | |
| 5.5 | Welche Hinweise müssen sichtbar sein (keine Beratung, keine Gewähr, Datenstand, Quelle), und wurden sie von einer zugelassenen Person geprüft? | | |
| 5.6 | Gilt die bestehende Affiliate-Compliance (CLAUDE.md §8: keine erfundenen Zahlen, keine Garantien, keine Superlative, Werbekennzeichnung) auch hier, und reicht sie? | | |
| 5.7 | Welche Haftungsrisiken entstehen bei falschen Daten oder Aussagen; ist eine Versicherung nötig? | | |

## 6. Datenschutz

| # | Prüffrage | Antwort | Status |
|---|---|---|---|
| 6.1 | **[K.O. wenn: ja oder unklar und 6.2–6.8 nicht vollständig `geklärt`]** Werden personenbezogene Daten verarbeitet? Zu bedenken: Eigentümer- und Mieterangaben, aber auch Adressen, Fotos oder genaue Koordinaten einzelner Objekte können Personen zuzuordnen sein. | | |
| 6.2 | Falls ja: Auf welche Rechtsgrundlage stützt sich jede Verarbeitung (Art. 6 DSGVO), und ist sie dokumentiert? | | |
| 6.3 | Wie werden Betroffene informiert, wenn Daten nicht bei ihnen selbst erhoben werden (Art. 14 DSGVO)? | | |
| 6.4 | Zweckbindung und Datenminimierung: Reichen aggregierte Daten (z. B. je Stadtteil) statt Einzelobjekten? | | |
| 6.5 | Speicherdauer und Löschung: Was wird wie lange gespeichert, und wie wird gelöscht? (Datenbankmigrationen sind nur additiv – Löschung braucht einen eigenen, freigegebenen Weg.) | | |
| 6.6 | Welche Dienstleister erhalten Daten (Modellanbieter, Recherche-API, Datenbank, Hosting)? Liegen Verträge zur Auftragsverarbeitung (Art. 28 DSGVO) vor? Findet eine Übermittlung in Drittländer statt (Art. 44 ff. DSGVO)? | | |
| 6.7 | Ist eine Datenschutz-Folgenabschätzung nötig (Art. 35 DSGVO), z. B. bei systematischer Auswertung vieler Objekte oder Personen? | | |
| 6.8 | Wie werden Betroffenenrechte (Auskunft, Berichtigung, Löschung, Widerspruch) praktisch erfüllt? | | |
| 6.9 | Muss die Datenschutzerklärung (`/datenschutz`) bzw. das Verzeichnis der Verarbeitungstätigkeiten ergänzt werden? | | |
| 6.10 | Ist sichergestellt, dass keine personenbezogenen Daten in Logs, `model_calls`, WhatsApp-Texten, Übergabedateien oder im öffentlichen Repository landen? | | |

## 7. Ergebnis und Folgen

| Feld | Eintrag |
|---|---|
| Ergebnis | Go · No-Go · offen |
| K.O.-Fragen mit zutreffender Bedingung oder Status `offen` | (Nummern) |
| Geprüft durch zugelassene Person? | ja (wer, wann – nur privat) · nein |
| Erlaubter Zuschnitt (aus §1, ggf. eingeschränkt) | |
| Freigegebene Quellen (aus §2, Name genügt) | |
| Benötigte Budgets/Lizenzen (L4-Entscheidung, Verweis) | |
| Nächste Prüfung fällig am | |
| Datum, Betreiber | |

Bei **Go** gelten für I-03 (Abteilungsskelett) mindestens:

- Schalter mit Standard „aus“; keine Datenquelle außer den in §7 freigegebenen (feste Liste im Code, kein freies Nachladen).
- Kein Abruf, keine Lizenz und kein Modellaufruf mit Kosten ohne Budget aus einer L4-Entscheidung; jeder Modellaufruf über `recordModelCall`.
- Bestehende Freigaben unverändert: Inhalt, Kosten und Veröffentlichung jeweils einzeln durch den Betreiber.
- Pflichthinweise aus §5.5 und Quellenangaben aus §4.2 sind Teil der Ausgabe und werden getestet.
- Keine personenbezogenen Daten, solange §6 nicht vollständig `geklärt` ist.

Bei **No-Go** oder **offen**: keine Arbeit an I-03; die Opportunity bleibt im Raster mit dem Vermerk, welche Fragen fehlen.

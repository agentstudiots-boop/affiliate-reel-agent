# Bildqualität: Briefing, Prompt-Prüfung, visuelles Quality Gate, Lernen

Gilt für die bestehende Affiliate-Bildpipeline (`requestFacebookApproval`) und optional für Themenbilder
(Visual Engine). Es gibt keine zweite Bildpipeline: Die bestehenden Provider, Claims und Freigaben bleiben, die
Qualitätsschritte sind dazwischen geschaltet (`lib/content/image-quality/`).

## Fehleranalyse Pilz-Dekoration

**Im Code bestätigt:**
1. **Keine Prüfung des erzeugten Bildes:** Bisher ging jedes erzeugte Bild direkt zur WhatsApp-Veröffentlichungsfreigabe
   (`request-publication.ts`).
2. **Hauptmotiv nur über die Kategorie:** Für unbekannte Produkte war das Hauptmotiv „die Anwendung der Produktkategorie
   <ersten fünf Titelwörter>“. Das Briefing nannte „Dekoration“ zudem ausdrücklich als Nebensache („Person und Dekoration
   unterstützen nur die Handlung“) – bei einem Deko-Produkt ein Widerspruch.
3. **Korrekturen ersetzten das Briefing:** `reviseStructured` ersetzte Szene, Konzept und Prompt vollständig durch den
   kurzen Änderungstext. „Mach das Bild gemütlicher“ oder „Entferne den Hund“ wurde so zur einzigen Bildbeschreibung;
   das Hauptmotiv ging verloren.
4. **Kein Budget je Auftrag:** Jede geänderte Fassung (neuer Inhalts-Hash) bekam einen neuen kostenpflichtigen Versuch.
5. **Ausschlüsse im Provider-Prompt:** FLUX 1.1 Pro hat keinen Negativ-Prompt. Der lange deutsche Prompt enthielt viele
   Verneinungen („Keine Kinder …“). Frühere Betreiberkritik derselben Produktfamilie wurde wörtlich eingebaut
   („Bestätigter früherer Bildfehler …“).

**Wahrscheinlich, aber ohne Produktionsdaten nicht belegt** (kein Zugriff auf die Produktionsdatenbank aus dieser Umgebung):
- Das Hundemotiv entstand durch die Nennung eines Tieres im Prompt, etwa aus einer Korrektur wie „ohne Hund“ oder aus
  übernommener Kritik.
- Möglich ist auch eine Szene des Creative Agents mit Tier oder eine abgeschnittene Prompt-Länge.

**Nicht bestätigt:** Alte Bild-URLs oder Jobs wurden nicht vertauscht. Der Blob-Pfad enthält Job-ID und SHA-256; das prüft
`prepareWithVisual`.

## Ablauf

```
Creative-Plan → strukturiertes Briefing (imageSpec) → Briefing-Validierung → Provider-Prompt → Prompt-Validierung
  → 1 kostenpflichtige Generierung → technische Prüfung + Vision-Prüfung → bestanden: Veröffentlichungsfreigabe (Mensch)
                                                                        → nicht bestanden: Feedback → Briefing-Korrektur
                                                                          → Budget? → 1 gezielter Korrekturversuch → Prüfung
                                                                        → sonst Stopp + WhatsApp-Hinweis
```

- **Briefing** (`spec.ts`, gespeichert als `content.imageSpec`): Ausgangspunkt ist der konkrete Artikel.
  - Inhalte: Produkttyp (Leuchte, Dekofigur, Gartenstecker …), Motiv, Material und Umgebung laut Titel, belegte Fakten,
    fehlende Informationen, Pflicht- und Ausschlussobjekte, Komposition, Format 4:5, Werbezweck, Identitätsklasse
    (symbolisch / generisch / Markenartikel).
  - Beispiel: „Pilzlampe LED Tischleuchte aus Holz“ ergibt „Pilz-Leuchte aus Holz“, „Keramik Pilz Dekofigur“ ergibt
    „Pilz-Dekofigur aus Keramik“, „Pilz Gartenstecker“ ergibt den „Pilz-Gartenstecker“ draußen.
- **Provider-Prompt** (`prompt.ts`): kurz, positiv, das Hauptmotiv zuerst.
  - Ausgeschlossene Objekte und Verneinungen werden nie genannt.
  - Validiert wird vor jedem Aufruf: Hauptmotiv am Anfang, Pflichtobjekte vorhanden, keine ausgeschlossenen Objekte,
    kein Widerspruch, 4:5, Länge, keine Referenzbilder.
  - Fehler werden deterministisch korrigiert, sonst stoppt der Auftrag. Replicate wird dann nicht aufgerufen.
  - Das lange deutsche Briefing bleibt der lesbare Nachweis (`imageBrief`).
- **Quality Gate** (`gate.ts`):
  - **Technische Prüfung (H):** Das Bild muss abrufbar sein, ein vollständiges PNG im Format 4:5.
  - **Vision-Prüfung (A–G):** Das Modell meldet nur strukturierte Beobachtungen; über Bestehen entscheidet der Code.
  - **Harte Fehler:**
    - Hauptmotiv fehlt.
    - Ausgeschlossenes Objekt sichtbar.
    - Falsches Produkt.
    - Schwere Bildfehler.
    - Schrift oder Logo im Bild.
    - Unrealistische Handhabung.
  - **Unsicherheit** wird nie als bestanden gewertet und löst keine Neugenerierung aus. Unsicher ist ein Ergebnis bei:
    - Modell nicht erreichbar,
    - ungültiger Antwort,
    - Konfidenz unter 0,6,
    - „unclear“ bei Hauptmotiv oder Produktart.
- **Produktidentität:** wird aus einem KI-Bild nie bestätigt (`identity: not_verifiable`).
  - Es werden keine Händlerbilder als Referenz genutzt (bestehende Affiliate-/Bildregeln).
  - Die Freigabenachricht sagt ausdrücklich, dass das Bild die Produktart zeigt, nicht das Originalprodukt.
  - Markenartikel werden als generische, unmarkierte Produktart beschrieben.

## Kosten und Wiederholungen

| Regel | Standard | Variable |
| --- | --- | --- |
| Kostenpflichtige Versuche je Auftrag | 2 (Erstbild + 1 gezielte Korrektur) | `IMAGE_MAX_GENERATIONS_PER_JOB` |
| Tageslimit über alle Aufträge (24 h) | 12 | `IMAGE_DAILY_GENERATION_LIMIT` |
| Kostenschätzung je Bild | 0,04 USD (flux-1.1-pro) | `IMAGE_COST_PER_GENERATION_USD` |
| Vision-Prüfung | an, wenn `REPLICATE_API_TOKEN` gesetzt | `IMAGE_QUALITY_GATE=strict\|off` |
| Vision-Modell | Router-Modell über Replicate | `IMAGE_QUALITY_MODEL` |

- **Jede Operator-Entscheidung** gibt genau einen weiteren Versuch frei. Das ist eine Bildänderung per WhatsApp oder die
  Antwort „Neues Bild“.
- **HTTP 429:**
  - Mit Wartehinweis des Providers: höchstens 2 Wiederholungen mit exponentiellem Backoff im selben Versuch, ohne Kosten.
  - Ohne Hinweis: Der Claim wird wie bisher freigegeben, und „Weiter“ startet neu.
- **Unklares Providerergebnis:** Die Auftrags-ID ist gespeichert. „Bildstatus prüfen“ fragt sie einmal ab und erzeugt nie ein
  neues Bild.
- **Doppelte Ausführung:** Ein eindeutiger Claim je Versuch `(job_id, attempt_no)` verhindert parallele Doppelgenerierung.
  Antworten werden über `whatsapp_events` nur einmal verarbeitet.
- **Zusatzkosten:** genau 1 Vision-Aufruf je erzeugtem Bild. Er läuft über das vorhandene Replicate-Konto und ist voraussichtlich deutlich
  günstiger als eine Bildgenerierung (Preis nicht live gemessen). Das Lernen verursacht keine Modellaufrufe; es sind reine SQL-Abfragen.

## WhatsApp

- **Stopp-Nachricht:** Ein angehaltener Bildauftrag erzeugt eine Nachricht mit Grund und Budget. Wer direkt darauf antwortet,
  trifft die manuelle Entscheidung:
  - „Neues Bild“ bzw. „Neues Bild: <Wunsch>“,
  - „Bild trotzdem senden“ (nur nach unsicherer Prüfung; die Freigabe weist das aus),
  - „Bildstatus prüfen“,
  - „Stopp“.
- **Änderungswünsche zur Freigabe** (`structured-revision.ts`): Das Briefing bleibt erhalten.
  - Atmosphäre, Licht, Größe, Position oder Entfernen: Die Szene bleibt, der Wunsch wird ergänzt. Entfernte Objekte werden
    ausgeschlossen.
  - „Komplett anderes Bild“: neue Szene, das Hauptmotiv bleibt.
  - Konkrete neue Szene: Das Hauptmotiv wird ergänzt, falls es fehlt.
  - Eine echte Bildbearbeitung gibt es nicht (FLUX 1.1 Pro). Es wird immer neu erzeugt und erneut geprüft.

## Feedback und Lernen

- **Feedback** (`feedback.ts`): Jeder Befund nennt Problem, verletzte Anforderung und Ursache.
  - Mögliche Ursachen: Briefing, Prompt-Transformation, Generierung, Produktreferenz, Technik, unbekannt.
  - Die Ursache trägt eine Sicherheit (wahrscheinlich/unsicher), dazu eine gezielte Korrektur und die zu erhaltenden
    Anforderungen.
  - Die Briefing-Stufe wendet nur die verletzten Aspekte an (`reviseSpecFromFeedback`).
- **Gedächtnis** (`learning.ts`, Tabelle `image_quality_experiences` im bestehenden PostgreSQL):
  - Gespeichert wird pro geprüftem Versuch: Kategorie, Produkttyp, Briefing-Zusammenfassung, Prompt-Version und -Hash,
    Bild-URL (keine Bilddaten), Befunde mit Ursache und Sicherheit, angewandte Korrektur und ihr Ergebnis
    (Erfolg/Misserfolg getrennt), Versuchsanzahl, Kostenschätzung.
  - Menschliche Entscheidungen kommen über `publication_requests` dazu (abgelehnt / Änderungswunsch mit Text).
- **Regeln aus Erfahrungen:**
  - Eine Regel braucht mindestens 3 Punkte aus mindestens 2 Aufträgen.
  - Zusätzlich braucht sie eine erfolgreiche Korrektur oder menschliche Bestätigung.
  - Ein automatischer Befund zählt nur mit wahrscheinlicher Ursache und 1 Punkt; unsichere Befunde zählen nie.
  - Ein menschlicher Befund zählt 2 Punkte.
  - Gleicher Produkttyp gilt voll; gleiche Kategorie nur für „Produkt muss dominieren“.
  - Regeln liefern feste Textbausteine, keine alten Prompts. Sie ändern nie das produktspezifische Hauptmotiv.

## Grenzen

- **Vision-Modell und Testumgebung:**
  - Das Vision-Modell (`IMAGE_QUALITY_MODEL`, Standard: Router-Modell mit `image_input`) ist nicht live geprüft.
  - Lehnt Replicate das Bildfeld ab, ist jede Prüfung „unsicher“. Bilder stoppen dann mit Hinweis statt ungeprüft zur
    Freigabe zu gehen.
  - Alle Tests laufen mit Mocks.
- **Was die Prüfung nicht leistet:**
  - Sie beurteilt sichtbare Merkmale, nicht ästhetische Feinheiten.
  - Sie bestätigt keine Produktidentität.
  - Sie ersetzt keine Inhalts- oder Veröffentlichungsfreigabe.
- **Themenbilder:** Das Gate ist an die Visual Engine angebunden (`imageQuality`). Ein abgelehntes Bild fällt auf Text bzw.
  eine Textgrafik zurück; es gibt keine Korrekturgenerierung.

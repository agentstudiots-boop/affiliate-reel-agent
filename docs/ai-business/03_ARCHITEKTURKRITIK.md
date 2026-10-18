# 03 – Architekturkritik und einfachere Alternativen

Ziel: belastbar, wirtschaftlich, skalierbar – nicht möglichst viele Agenten. Jede Empfehlung ist eine Entscheidungsvorlage (siehe 07).

## 1. Grundsätzliche Befunde

| # | Befund | Schwere | Empfehlung |
|---|---|---|---|
| K-01 | **Die Wirtschaftlichkeit des Gesamtvorhabens ist unbelegt.** Es gibt heute keine erfassten Affiliate-Erlöse im System (nur manuelle `performance_observations`), keine Euro-Kosten und keine Provisionssätze. Ein Controlling- und Executive-Überbau über einer Geschäftseinheit ohne Erlösnachweis erhöht die Fixkosten, bevor ein Nutzen messbar ist. | hoch | Zuerst messen (Phase E-Kern: Preiskatalog + Erlösimport), dann ausbauen. Ein **Meilenstein „Wirtschaftlichkeitsnachweis“** entscheidet über Phase F/I. |
| K-02 | **Der Executive als LLM-„Geschäftsführer“ ist teuer, schwer testbar und riskant.** Ein Modell, das frei priorisiert und delegiert, erzeugt nicht reproduzierbare Entscheidungen und Modellkosten pro Zyklus. | hoch | Executive = **deterministischer Kern** (Aufgabenbuch, Regeln, Budgets) + KI nur für Sprache (Intake über den vorhandenen Router, Berichtstext). |
| K-03 | **„Engineering-Abteilung“ als Laufzeit-Agent in der Production-App wäre ein Sicherheitsrisiko** (die App bräuchte Repo-Schreibrechte und Modellzugänge; ein Prompt-Injection-Treffer könnte Code ändern). | hoch | Engineering ist ein **Entwicklungsprozess** im Repository (Übergabedateien, CI, Reviews, Claude-Code-Routinen), kein Prozess auf Vercel. Das Command Center zeigt nur lesend den Stand. |
| K-04 | **Controlling braucht keine KI.** Kosten, Deckungsbeiträge, ROI sind SQL und Formeln. | mittel | Kein Controlling-„Agent“, sondern ein Modul. Spart Modellkosten und Fehlerquellen. |
| K-05 | **Immobilien-Abteilung: hohes Rechts- und Datenrisiko** (Datenquellen/Portale mit Nutzungsbedingungen gegen automatisiertes Auslesen, Nähe zu Anlage-/Finanzberatung, Datenschutz bei Eigentümerdaten). Kein Code, keine Quelle vorhanden. | hoch | Zunächst nur als **bewertete Chance** im Opportunity Scout. Eigene Abteilung erst nach Machbarkeits- und Rechtsprüfung durch den Betreiber. |
| K-06 | **Autonomie ohne Budgetdeckel** führt bei Cron + Retries zu Kostenspiralen. | hoch | Jede Aufgabe: Budget, Frist, max. Versuche; Monatsbudget je Abteilung, hart (wie Runway/HeyGen heute). Keine automatische kostenpflichtige Ersatzroute (bestehende Regel). |
| K-07 | **Doppelte Zuständigkeit Trend-/Themen-/Opportunity-Scout.** Drei Recherchewege für ähnliche Fragen. | mittel | Opportunity Scout nutzt **dieselbe Recherche-Infrastruktur** (`lib/tavily.ts`, Quellenformat), aber eine andere Fragestellung (Geschäftsmodell statt Produkt/Thema). Kein dritter Tavily-Client, keine gemeinsamen Tabellen mit `content_chances`. |
| K-08 | **Zwei Orchestrator-Ebenen (Executive → Jarvis → Content-Orchestrator)** können sich widersprechen. | mittel | Executive steuert das Affiliate-Studio nur über **Aufträge und Kennzahlen**, nie über Interna. Jarvis bleibt unverändert zuständig für Content-Entscheidungen. |
| K-09 | **Öffentliches Repository** | hoch | Keine Geschäftsdaten/Chancen/Finanzen in Übergabedateien oder Doku. Option: Repository privat stellen (Betreiberentscheidung; ggf. Kosten für Branch-Schutz bei privaten Repos prüfen). |
| K-10 | **Vercel Hobby für ein Geschäftssystem**: Nutzungsbedingungen (kommerzielle Nutzung), Cron-Grenzen, Log-Aufbewahrung 1 h. | mittel | Vor Phase B prüfen (Q-04). Architektur hält Nachweise ohnehin in der DB. |
| K-11 | **Parallelentwicklung zweier Modelle ohne Urheberkennung**: GPT-Arbeit erscheint heute als Betreiber-Commit. Reviews und Verantwortung sind dann nicht nachvollziehbar. | mittel | Commit-Trailer `Implemented-By:` / `Reviewed-By:` + Übergabedatei je Aufgabe (05). |
| K-12 | **Datenbankkonflikte**: Migrationsnummern, gemeinsame Tabellen, Advisory-Lock bei automatischer Anwendung. | mittel | Nummernreservierung; neue Tabellen mit Präfix (`enterprise_`, `controlling_`, `opportunity_`); keine Änderung bestehender Tabellen in den ersten Phasen. |
| K-13 | **Anbieterabhängigkeit**: alle Sprachmodelle laufen über Replicate (`openai/*`), Recherche nur Tavily, Hosting/DB/Blob nur Vercel/Neon. | mittel | Bestehende Abstraktion (`Generator`) beibehalten; neue Module nur über diese Schnittstelle. Kein Anbieterwechsel ohne `model_calls`-Daten (bestehende Regel). |
| K-14 | **Zu viele WhatsApp-Meldungen** würden das Ziel „nicht ständig stören“ verfehlen; außerhalb des 24-h-Fensters ist Versand ohne Vorlage nicht möglich. | mittel | Bündelung (1 Sammelnachricht/Tag), kritische Meldungen gedrosselt, Rest im Command Center. |
| K-15 | **Engpass ist der Betreiber, nicht die Modellkapazität.** Während der Saison sind Reviews/Merges/Freigaben knapp. Parallel erzeugte PRs stauen sich. | hoch | WIP-Limit: max. **2 offene Code-PRs** gleichzeitig (+ Doku-PRs). Kleine PRs mit klarer Prüfliste; feste Review-Fenster. |

## 2. Was **kein** KI-Agent sein sollte

| Funktion | Besser als |
|---|---|
| Priorisierung, Eskalation, Budgetprüfung | Regeln/Formeln im Executive-Kern |
| Kostenrechnung, ROI, Amortisation | SQL + TypeScript-Funktionen (Controlling) |
| Abteilungsregister, Berechtigungen | statischer, getesteter Code |
| Aufgaben-Warteschlange | Postgres (`SKIP LOCKED`) |
| Code-Review-Vorprüfung (Format, Typen, Tests, Abhängigkeiten) | CI (bereits vorhanden), `npm audit`, ESLint |
| Kollisionsprüfung Dateibesitz | Skript, das Übergabedateien gegen den Diff prüft (Phase C) |
| Kontext-/Übergabeprüfung | JSON-Schema-Validierung |
| Bewertungs-Gesamtwert der Chancen | gewichtete Formel |

KI bleibt sinnvoll für: Recherche-Zusammenfassung und strukturierte Extraktion (Scout), freie Betreiber-Eingaben (Router), Berichtstexte,
Code-Implementierung und -Review (außerhalb der Laufzeit, durch Claude Code / GPT Work).

## 3. Kostenschätzung der Laufzeit (qualitativ, ohne erfundene Preise)

| Baustein | Zusätzliche Modellaufrufe | Zusätzliche externe Kosten |
|---|---|---|
| Executive-Kern | 0 | 0 |
| Executive-Berichtstext | ≤ 1 je Bericht (optional, abschaltbar) | Replicate nach Verbrauch |
| Executive-Intake | 0 neue (vorhandener Router-Aufruf je Nachricht) | 0 |
| Controlling | 0 | 0 |
| Opportunity Scout | je Lauf ≤ N Suchen + ≤ M Aufrufe (konfigurierbar) | Tavily + Replicate, Monatsbudget hart |
| Command-Center-Erweiterung | 0 | 0 |
| Engineering-Prozess | 0 zur Laufzeit; Entwicklungskosten über Claude-/GPT-Abos des Betreibers | Abokosten (Betreiberdaten, unbekannt) |

Euro-Beträge erst nach Pflege des Preiskatalogs (Phase E). Bis dahin: Aufrufzahlen und Tokens.

## 4. Vereinfachte Alternative (empfohlene Mindestvariante „MVP-Unternehmen“)

Falls der Wirtschaftlichkeitsnachweis (K-01) ausbleibt oder die Entwicklungszeit knapp wird:
1. **Controlling-Modul** (Preiskatalog, Kostenbuch aus Bestandstabellen, manuelle Erlöse) + Command-Center-Kachel.
2. **Executive-Wochenbericht** als Erweiterung des bestehenden `weekly-report` (rein datenbasiert).
3. **Opportunity-Bewertung** als manuell ausgelöster Lauf (WhatsApp „Prüfe Geschäftsidee …“) mit Bewertungsraster, ohne Dauerbeobachtung.
4. Engineering-Koordination ausschließlich über Übergabedateien + PR-Reviews.

Diese Variante deckt etwa die Hälfte der Zielfunktionen mit einem Bruchteil der Komplexität ab und lässt sich später zur Vollarchitektur
erweitern, weil sie dieselben Tabellen und Verträge verwendet.

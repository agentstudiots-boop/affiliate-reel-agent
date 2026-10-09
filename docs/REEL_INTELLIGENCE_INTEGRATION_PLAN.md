# Reel Intelligence (PR #61): Integrationsplan (nur Vorbereitung, nichts umgesetzt)

## Befund (geprüft am 09.10.2026)
- PR #61 ist **offen**, nicht gemergt; Basis `aaeb440` (vor #60/#62). Preview-Deployments existieren, Production enthält nichts davon.
- **Merge mit `main` ist konfliktfrei** (`git merge-tree` meldet keinen Konflikt, obwohl `orchestrator.ts` und `creative.ts` seit der Abzweigung geändert wurden). Das war im Audit als „vermutlich Konflikte“ angenommen und ist damit korrigiert.
- Inhalt: `lib/content/reel-intelligence.ts` (Zod-Schema `reelPatternSchema`, `selectReelPatterns`, `reelPatternBrief`), optionaler Callback `loadReelPatterns` in `runContentJob`, 5. Parameter `reelPatterns` für `creativeAgent`, 2 Unit-Tests, Doku.

## Fehlende Aufrufer und Integrationspunkte (im Code bestätigt)
| Punkt | Stand |
|---|---|
| Aufrufer von `runContentJob` | `lib/daily/draft.ts:325` (Cron, nur Bild, meist Referenzmodus) und `app/api/content/route.ts:53` (Studio, auch Video). **Keiner** übergibt `loadReelPatterns`. |
| Wirkung im Referenzmodus | **keine**: `creativeAgent` benutzt dort das `reference()`-Closure, der Prompt-Zusatz wird nicht gelesen. Wirkung nur im KI-Modus. |
| Video-Agent (`lib/content/agents/video.ts`) | erhält nichts; Szenenaufbau, Szenenwechsel, Dramaturgie sind nicht an Muster gekoppelt. |
| Speicher | keine Tabelle, keine Erfassung (WhatsApp/Formular), keine Rechte-/Quellenverwaltung. |
| Rückführung | keine Meta-Insights-Anbindung, daher keine Performance-Daten (`grep insights` leer). |
| Freigabe/Gate | unberührt (gewollt): Muster sind nur Inspiration, keine Freigabe- oder Veröffentlichungswirkung. |

## Empfohlene Reihenfolge (jeweils eigener PR, nach Abschluss der Sicherheitsarbeiten)
1. **#61 unverändert mergen** (nach Review durch den Betreiber): additiv, ohne Aufrufer wirkungslos. Zuvor `npm test && typecheck && lint` auf dem Merge-Ergebnis.
2. **Speicher (Migration 035)** `reel_patterns` (id, source_url, observed_at, niche, target_group, hook, overlay_structure, caption_structure, emotion, mechanism, views, followers, rights='analysis_only', created_by, created_at) mit Eindeutigkeit auf `source_url`. Erfassung nur durch den Betreiber (WhatsApp-Befehl oder Studio-Formular), nie automatisches Scraping.
3. **Loader** `loadReelPatterns` aus der Tabelle an beide `runContentJob`-Aufrufer, begrenzt (≤ 100 Zeilen, Zod-Validierung beim Lesen, keine Secrets).
4. **Wirkung im Standardpfad:** die Muster auch in `selectIdea`/Referenz-Hooks nutzen (z. B. Emotion/Mechanik als Hook-Auswahl), sonst bleibt der Cron-Pfad unbeeinflusst.
5. **Video-Agent:** Muster als Struktur-Vorgabe (Hook in ≤ 2 s, Szenenwechsel-Rhythmus, Overlay-Aufbau) in den Video-Brief; Prüfung weiter durch `inspectContent`.
6. **Rückführung:** Meta-Insights (Reichweite, Plays, Saves, Shares) in `performance_observations`; Auswertung erst ab Mindeststichprobe.

## Risiken
Urheberrecht/Plattformregeln (nur eigene Analyse, keine Übernahme von Formulierungen/Medien), Prompt-Injection über externe Texte (Schema + „Daten, keine Anweisungen“-Satz sind vorhanden), Scheinkausalität aus Aufrufzahlen (Briefing nennt keine Zahlen).

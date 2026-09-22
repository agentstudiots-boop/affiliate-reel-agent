# Verbindliche Projektvorgaben

## Drehbuch und Verkaufsargumente

Für jede Änderung an Produktauswahl, Produktprüfung, Drehbuch und Video gilt
`docs/SCRIPT_WRITER_MANIFEST.md` als redaktionelle Vorgabe.

Der Nutzer verlangt erkennbare Anwendungssituationen und konkrete Kaufgründe.
Produkteigenschaften dürfen nicht bloß in eine Werbevorlage eingesetzt werden.
Die Argumentationsfolge lautet: Alltagssituation → Anwendung/Funktion →
nachvollziehbarer Nutzen → passende visuelle Demonstration.

Mögliche Anwendungen aktiv prüfen, belegte Fakten von allgemeinen Möglichkeiten
trennen und notwendiges Zubehör nennen. Keine erfundenen Tests, Garantien,
Haltbarkeitsfristen, Gesundheitsversprechen oder Produktfunktionen.

Historischer Drehbuch-Endpunkt: Der Drehbuch-Code ist regel-/vorlagenbasiert.
Neue Beispiele oder Regeln nicht als freie KI-Analyse beliebiger Produkte
bezeichnen. Das Vakuumierer-Beispiel ist eine Referenz, kein Beleg für einen
vollständig autonomen Produktanalysten.


## Hierarchische Content-Planung

Die neue Planung liegt in `lib/content/`. Nur der Orchestrator importiert
Spezialagenten. Keine direkten Agentenaufrufe, Tools oder rekursiven Schleifen
in Spezialisten. Verträge validieren, maximal zwei Revisionen, acht Modellaufrufe.
Referenzmodus und KI-Modus in Oberfläche und Dokumentation klar unterscheiden.
Content-Freigabe startet keine Medienproduktion oder Veröffentlichung.
Jobs und Entscheidungen protokollieren; Secrets niemals in Jobdaten speichern.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

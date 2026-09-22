# Zentraler Lernspeicher

Postgres ist die Quelle für neue Content-Jobs, Ereignisse, Freigaben,
Veröffentlichungen und versionierte Performance-Messstände. Drive ist nur für
Dateien/Exporte/Backups vorgesehen; GitHub enthält Code und Schema, keine Daten
oder Secrets. Vercel betreibt die Webapp.

Einrichtung: eine Postgres-Datenbank (vorzugsweise Neon über Vercel Marketplace)
mit DATABASE_URL anbinden; CONTENT_STUDIO_PASSWORD serverseitig setzen; anschließend
`npm run db:migrate` gegen das gewünschte Ziel ausführen. Das Skript lädt lokale
Environment-Dateien ohne sie zu veröffentlichen, sperrt parallele Migrationen und
führt jede Migration in einer Transaktion aus. Es läuft niemals automatisch beim
Build oder Seitenaufruf. Der Runtime-Nutzer benötigt Zugriff auf die Tabellen;
ein separater Migrationsnutzer kann für Schemaänderungen verwendet werden.

Für Vercel kann dieselbe explizite Migration über `/api/admin/migrate` ausgelöst
werden. Die Route verlangt den Content-Studio-Zugangscode, akzeptiert nur die fest
im Repository hinterlegten Migrationen und ist idempotent. Das Passwort wird nur
im verschlüsselten POST-Body oder Schutz-Header übertragen, nicht gespeichert oder
zurückgegeben. Auch dieser Weg migriert niemals automatisch beim Build oder normalen
Seitenaufruf.

Tabellen: products, content_jobs, job_events, publications,
performance_observations. Produkt-IDs verwenden Amazon-ASINs oder normalisierte
URL-Hashes; eine Suchauswahl wird nicht als konkretes Modell ausgegeben.
Jeder Job speichert Opportunity, Creative, Formatentscheidung samt Begründung,
Agenten, Content, Plattformempfehlung und Zeitstempel. Jede Antwort wird vor
Auslieferung an den Browser transaktional gespeichert. Doppelte Request-IDs
werden abgelehnt. Nach einem harten Prozessabbruch markiert das Laden des Verlaufs
mehr als zehn Minuten alte aktive Jobs als unterbrochen, ohne sie neu zu starten.

Performance wird im ersten Ausbau manuell mit Herkunft/Zuordnung erfasst, nicht
automatisch aus Meta oder Amazon importiert. Pro Plattform gilt der jeweils letzte
kumulative Messstand. Alte Revisionen bleiben erhalten; konkurrierende Updates
müssen neu laden. Kosten in Cent, Währung EUR, unbekannte Kosten NULL. Gewinn hier
ist ein Deckungsbeitrag (Affiliate-Erlös minus zugeordnete Produktionskosten), kein
vollständiger Unternehmensgewinn. ROI = Deckungsbeitrag / Kosten; bei Kosten 0
oder unbekannt NULL. Bei mehreren Plattformen Kosten anteilig zuordnen. Auch bei
nicht veröffentlichten oder fehlgeschlagenen Jobs können Kosten erfasst werden.

Aktives Lernen: Der Orchestrator fragt vor der Formatwahl historische Fälle mit
gleicher Kategorie, Anwendungsgruppe, Kommunikationsziel und Plattform ab.
Verwendet werden abgeschlossene 30-Tage-Fenster aus den letzten 180 Tagen,
maximal 300 Fälle, bekannte Kosten und freigegebene veröffentlichte/archivierte
Inhalte. Jede Formatgruppe braucht mindestens drei Fälle und 100 Klicks; mindestens
zwei geeignete Formatgruppen müssen vorhanden sein. Der durchschnittliche
Deckungsbeitrag je Inhalt kann die redaktionelle Wertung um höchstens ±6 Punkte
verändern. Conversion, Kosten, Erlöse, ROI, Fall-IDs und Regelversion werden zur
Erklärung mit gespeichert. Bei Gleichstand/fehlender Evidenz keine Anpassung.
Das sind beobachtete Zusammenhänge, kein Kausalnachweis und kein Fine-Tuning.

Zugriff: alle Schreib- und Verlaufsrouten verlangen einen serverseitigen
Zugangscode im Header, der nicht im Browser gespeichert wird. Es ist ein privates
Ein-Betreiber-System, kein Mehrmandanten-Login. Keine DB-Zugangsdaten im Frontend,
keine öffentliche Auslieferung von Jobdetails. Ohne DB kein stiller LocalStorage-
Fallback. Alte lokale Reel-Testzahlen sind gekennzeichnet und nicht Teil des
Lernspeichers, da ihre Zuordnung zu Content-Stücken fehlt.

Tests: 16 Tests einschließlich echter PostgreSQL-Semantik in PGlite (Postgres
als eingebettete Testengine), Rollbacks, Migration, Konflikte, keine Doppelzählung,
NULL/0-Kosten und nachgewiesener Änderung einer späteren Formatwahl. Eine externe
Neon-/Postgres-Instanz ist noch nicht angeschlossen; Vercel-Zugriff liefert 403.

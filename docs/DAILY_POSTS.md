# Tägliche Entwürfe und Veröffentlichung

## Stand 29. September 2026

Production ist mit den Änderungen aus PR #12–#18 auf `main` deployed. Der
Meta-Webhook wurde auf `https://affiliate-reel-agent.vercel.app/api/whatsapp/webhook`
verifiziert; eine `Status`-Nachricht und mehrere gezielte Artikelsuchen wurden
in Production angenommen und beantwortet. Der erste produktive Morgen- und
Abendlauf mit dem neuen Zeitplan steht noch aus. Das ist kein Nachweis für eine
automatische WhatsApp-Zustellung zu einer bestimmten Minute.

Die Suche `Artikelsuche Saugroboter` am 29.09. um 00:30 Uhr lokaler Zeit kam
nach der Korrektur des `Robot`-Titelfilters über die Produktauflösung hinaus,
endete aber bei der redaktionellen Bildprüfung mit `content_review_failed`.
Die WhatsApp-Antwort zeigte positive Szenenbeschreibungen als Prüfmängel.
PR #18 verlangt echte Mängel mit Korrekturen vom KI-Prüfer und zeichnet einen
gescheiterten regelbasierten Ersatzentwurf ohne Kundendaten auf. Ob der nächste
echte Auftrag die vollständige Inhaltsfreigabe erreicht, ist offen. Kein Bild
wurde für diesen Versuch erzeugt oder veröffentlicht; redaktionelle Modellaufrufe
können Guthaben beansprucht haben. Weitere identische Live-Suchen nicht nur
für Diagnostik auslösen.

Der Tages-Cron hat vier einzelne, jeweils einmal täglich geplante UTC-Aufrufe:
07:00, 08:00, 16:00 und 17:00. Die Route nimmt einen Morgenlauf nur zwischen
09:00 und 10:59 Uhr deutscher Zeit und einen Abendlauf nur zwischen 18:00 und
19:59 Uhr an. Der eindeutige Datenbank-Claim verhindert doppelte Aufträge.
Diese Anordnung deckt Sommer- und Winterzeit ab und ist mit der
Einmal-pro-Tag-Grenze je Cron-Eintrag im Vercel-Hobby-Plan vereinbar. Hobby
garantiert den Aufruf nur innerhalb der geplanten Stunde, nicht minutengenau.
Eine WhatsApp um exakt 09:00 oder 18:00 ist damit nicht zugesichert.

Der Content-Claim prüft jetzt den tatsächlichen Primärschlüssel auf
`(day,slot)`. Die Migrationen 019 und 020 reparieren den Schlüssel bei Bedarf
und reservieren ASINs sowie eng definierte Produktfamilien sieben Tage lang,
bevor eine kostenpflichtige Planung beginnen kann. Die Freigabe für einen
Facebook-Bildpost zeigt die vollständige geplante Veröffentlichungscaption.
Außerhalb des WhatsApp-Servicefensters bleibt ohne ausdrücklich aktivierte,
genehmigte Business-Vorlage der Entwurf gespeichert und es kommt keine
automatische WhatsApp. Eine solche Vorlage kann Gebühren verursachen.

Die Migrationen 019/020 wurden bei produktiven Status- und Suchaufrufen über
`ensureAutomationSchema` geprüft oder angewendet. Die Zustellung von `Status`
und von Fehlerantworten ist belegt; eine komplette Bild- und
Veröffentlichungsfreigabe aus dem neuen täglichen Ablauf wurde noch nicht
nachgewiesen.

## Änderung vom 27. September 2026

Die bisherige Datums-Einmalgrenze wurde durch `(day,slot)` ersetzt (Migration
`016_multiple_drafts.sql`). Geplant sind jetzt zwei kostenlose **Bildentwürfe**
pro Tag um 07:00 und 16:00 UTC. Der Vercel-Header `x-vercel-cron-schedule`
bestimmt den Slot, damit verzögerte Zustellung keine Zuordnung ändert. Vercel
Cron läuft nur in Production; beide Jobs sind gegen wiederholte Anrufe
eindeutig geschützt. Die beiden Zeiten sind UTC und verschieben sich relativ
zur Berliner Sommer-/Winterzeit. Auch der Button für zusätzliche Entwürfe
legt jedes Mal einen neuen Auftrag an. Es gibt keine Tagesobergrenze.

Eine WhatsApp-Nachricht **`Bildpost`** an die konfigurierte Business-Nummer
startet eine zusätzliche saisonale Bildplanung. **`Bildpost B0D9YQR9CT`**
oder **`Bildpost https://www.amazon.de/dp/B0D9YQR9CT`** wählt ein konkretes
Produkt; der Orchestrator bindet erst nach Prüfung des genauen Amazon-Titels
einen Affiliate-Link an dieselbe ASIN. Jeder Start ist an Absender und
Message-ID gebunden, sodass Meta-Zweitzustellungen keinen zweiten Auftrag
auslösen. Der Befehl darf nicht als Antwort auf eine Freigabenachricht stehen.
Auch eine eigenständige Nachricht **`Artikelsuche`**, **`Neue Artikelsuche`**, **`Neue Produktsuche`**
oder **`Such mir einen neuen Artikel`** startet eine neue TrendScout-Suche;
diese eindeutigen Befehle brauchen keinen Sprachmodellaufruf. Eine Suche kann
am selben Tag erneut denselben Produktkandidaten finden. Eine neue eigenständige
Suche bezieht sich nicht auf zuvor freigegebene oder erledigte Aufträge;
Antworten auf alte Freigabe- und Story-Nachrichten bleiben dagegen bei ihrem
jeweiligen Auftrag.
Bei einer allgemeinen manuellen Artikelsuche berücksichtigt der Trendscout
verifizierte Dauerläufer und aktuelle Suchsignale ebenso wie Saisonideen.
Die automatischen Tageszeiten nutzen weiterhin saisonale Kandidaten.
Ohne verifizierbare Amazon-Produktseite wird keine redaktionelle Planung gestartet.
Ein indexierter Suchtreffer genügt nicht mehr als Nachweis: Die aktuelle
Amazon-Detailseite muss direkt abrufbar sein, zur selben ASIN gehören und
einen erkennbaren Produkttitel enthalten. Tote Seiten, Captchas und nicht
lesbare Antworten halten die Planung an. Ein früherer Suchtreffer wird nur
nach erneuter Liveprüfung wiederverwendet. Der am 27.09.2026 gemeldete
nicht funktionierende Link zu B0G2XQPG3N ist auch für bestehende Freigaben
gesperrt. Bis eine verlässliche Produktschnittstelle eingerichtet ist,
können Amazons automatisierte Zugriffssperren legitime Artikel anhalten;
in diesem Fall wird kein Bild gekauft.
Schlägt das redaktionelle Sprachmodell später fehl, nennt WhatsApp diesen Schritt
statt pauschal eine fehlende ASIN; der gescheiterte Auftrag wird nicht automatisch
wiederholt und löst keine Bildgenerierung aus.
Replicate-Anfragen innerhalb desselben redaktionellen Plans werden zeitlich
abgestuft. Nur bei einer ausdrücklich abgelehnten HTTP-429-Antwort wartet der
Generator begrenzt und versucht den abgelehnten Aufruf genau einmal erneut.
Nach erfolgreicher Planung folgen weiterhin Inhaltsfreigabe, Bildproduktion
und separate Veröffentlichungsfreigabe. Bei erneutem Limit endet der Auftrag
ohne Veröffentlichung; unklare oder erfolgreiche POST-Ergebnisse werden nicht
erneut abgesendet.
Wenn ein KI-Bildentwurf auch nach zwei Revisionen die redaktionelle Prüfung
nicht besteht, erstellt der Orchestrator einen neuen Referenzentwurf aus
regelbasierten Ideen. Dieser muss die strukturelle und produktspezifische
Prüfung bestehen, bevor er als Referenzentwurf per WhatsApp zur Inhaltsfreigabe
kommt. Der verworfene KI-Text wird nicht übernommen. Scheitert auch die
Referenzprüfung, nennt WhatsApp die konkreten Prüfpunkte; kein Bild wird gekauft.
Mit **`Artikelsuche Saugroboter`** oder **`Artikelsuche Produktname Saugroboter`**
gibt der Betreiber dagegen eine Produktart vor. Der Trendscout recherchiert
gezielt dazu; erst eine zu diesem Suchbegriff passende und verifizierte
Amazon-Produktdetailseite darf in einen neuen Facebook-Bildentwurf übernommen
werden. Fehlt ein belegbarer Treffer, erhält der Betreiber eine WhatsApp mit
der Bitte um genaueren Produktnamen oder ASIN. Ein saisonales Ersatzprodukt
wird nicht eingesetzt. Auch ein solcher Entwurf braucht weiterhin beide
WhatsApp-Freigaben vor Bildgenerierung und Veröffentlichung.
Bei mehreren offenen Freigaben immer direkt auf die betreffende WhatsApp
antworten. Änderungswünsche bleiben bis zur ausdrücklichen Freigabe möglich.

**Lernen aus Korrekturen:** Erst nach der ausdrücklichen Freigabe einer
überarbeiteten Fassung werden WhatsApp-Korrekturen aus Bildpost- und
Content-Studio-Freigaben als Beispiele gespeichert (`013_operator_language_examples.sql`,
`018_approved_editorial_feedback.sql`). Für neue Pläne werden passende und
aktuelle Beispiele ausgewählt (höchstens zwölf pro Auftrag), nicht frühere
Produktmerkmale oder Links übernommen. Sobald bestätigte Beispiele und ein
Replicate-Token vorhanden sind, erstellt die redaktionelle Planung mit
`openai/gpt-4.1` daraus passende Regeln für Ideen, Texte und Bildbriefings:
höchstens acht kostenpflichtige Modellaufrufe pro Plan, keine zweite Anfrage
bei unklarem Resultat. Ohne diese Voraussetzungen bleibt der Referenzmodus.
Die Bilddatei selbst wird noch nicht automatisch visuell auf Fehler geprüft;
deshalb ist das fertige Bild weiterhin in der zweiten WhatsApp zu kontrollieren.

Bei einem natürlichen Textänderungswunsch kann der bestehende Replicate-Parser
in seiner einen Modellanfrage jetzt zusätzlich einen konkreten Hook und eine
Caption für das gebundene Produkt vorschlagen. Neue Links, ASINs, ein
`Werbung`-Hook und eine Caption ohne Affiliate-Provisionshinweis werden
abgelehnt. Die Prüfung von Bildszene, redaktionellen Mindestregeln und
Kürbisschnitzkontext gilt auch für diesen Revisionsweg. Danach kommt eine
neue Inhaltsfreigabe; ein Modellvorschlag ist niemals selbst eine Freigabe.
Das ist eine erweiterte Änderungsverarbeitung mit `openai/gpt-4.1` auf dem
vorhandenen Replicate-Zugang, noch kein allgemeiner WhatsApp-Chatbot. Ein
anderes Modell ist nicht ohne nachgewiesene API-Kompatibilität, Kostenkontrolle
und Verhaltenstest produktiv aktiviert.

**Zwei WhatsApp-Entscheidungen pro Bildpost:** Zuerst wird der Bildentwurf samt
Hinweis auf die noch nicht bezifferte Bildgenerierung freigegeben; nur danach
wird ein Originalbild hergestellt. Zweitens kommt das konkrete Bild mit
Facebook-Caption zur Veröffentlichungsfreigabe. In der Facebook-Caption steht
der eindeutige Affiliate-Produktlink direkt am Anfang. Bis zur zweiten Freigabe
ist nichts veröffentlicht. Unbekannte Providerergebnisse werden niemals
blind wiederholt. Ohne WhatsApp-Servicefenster wird eine zuvor ausdrücklich
aktivierte Benachrichtigungsvorlage benötigt; andernfalls wartet der Entwurf
gespeichert. Eine Vorlage kann zusätzliche WhatsApp-Gebühren verursachen.

Nach erfolgreichem Facebook-Post wird einmalig eine WhatsApp mit dem bereits
genehmigten Bild und der Produkt-URL für **Facebook- und Instagram-Stories**
geschickt (`017_story_handoffs.sql`). Link-Sticker lassen sich über die
Instagram-Publishing-API nicht setzen; für die Facebook-Story-API gibt es
ebenfalls keinen hier verifizierten Link-Sticker-Parameter. Deshalb werden
Stories nicht ohne klickbaren Link automatisch online gestellt: Der Betreiber
lädt das Bild in beiden Apps als Story hoch, setzt dort jeweils den Link-Sticker,
prüft das Ziel und veröffentlicht selbst. Die Story erzeugt kein weiteres Bild.
`Status` zeigt die letzten fünf Bildaufträge samt Facebook-Status und danach
den letzten Reel-Status.

**Inbetriebnahme:** Die beiden neuen Migrationen vor dem produktiven Deploy
ausführen, wenn ein geschützter Migrationszugang vorhanden ist. Andernfalls
prüfen die ersten neuen Tages-/Story-/Statusaufrufe das Schema und wenden die
transaktional gesperrten Migrationen 001–020 selbst an; erst danach starten
Suche oder WhatsApp-Versand. Cron/WhatsApp/Bildprovider in der tatsächlichen
Vercel-Production prüfen. Eine Codeänderung ohne Production-Deployment startet
keinen Cron und versendet keine produktionsseitige WhatsApp. Die folgenden älteren Abschnitte dokumentieren
den ursprünglichen Einmal-pro-Tag-Stand und gelten nur als historische Notiz.

Stand: 24. September 2026.

## Automatischer Teil

Production-Cron `/api/cron/daily-draft` startet täglich um 07:00 UTC. Er benötigt
`CRON_SECRET`, `DATABASE_URL`, `CONTENT_STUDIO_PASSWORD`, `TAVILY_API_KEY` und
die bereits eingerichteten WhatsApp-Sendevariablen. Die Migration
`004_daily_drafts.sql`, `005_publication_gate.sql` und
`006_daily_notification.sql` müssen vorher in Production über die geschützte Route
angewendet werden. Vercel-Cron läuft nicht auf Preview; dort nur mit einem
autorisierten, ausdrücklich gewollten Aufruf prüfen.

Ein persistenter Tages-Claim verhindert zweite Recherche und zweiten Versand
auch nach einem unklaren Netzwerkresultat. Der vorhandene Scout recherchiert
aktuelle Websignale und Saisonkandidaten. Für den Content-Job wird eine
saisonale **Amazon-Suchauswahl** verwendet, solange kein konkretes Produkt samt
Eigenschaftsnachweisen vorliegt. Der vorhandene Content-Orchestrator entwickelt
einen Entwurf für Facebook mit Budget `low`: ohne bestätigte Korrekturen im
kostenlosen Referenzmodus, andernfalls bei konfiguriertem Replicate-Token im
kostenpflichtigen KI-Modus. Der Tageslauf
begrenzt die Formatwahl auf `image`, weil nur dafür ein überprüftes Original-Visual
und ein Facebook-Publishing-Weg existieren; ein nicht freigabefähiger Bildentwurf
stoppt vor der WhatsApp-Freigabe. Der Job und
das Scout-Ergebnis werden in Postgres gespeichert. Eine Content-Freigabe per
WhatsApp mit Auszug und Job-ID wird ausschließlich dann einmalig gesendet, wenn die
Approver-ID innerhalb der letzten 24 Stunden eine Nachricht an die API gesendet
hat. Für tägliche initiierte Nachrichten außerhalb dieses Fensters ist eine
separate, ausdrücklich aktivierte WhatsApp-Vorlage vorbereitet. Ohne genehmigte
Vorlage und geklärte Nachrichtengebühren wartet der Entwurf weiterhin gespeichert
im Content Studio. Die Vorlage ist **nur eine Benachrichtigung**. Auf sie kann
kein Content freigegeben werden. Erst die Antwort `Entwurf` löst im geöffneten
Servicefenster eine zweite Nachricht mit Produkt, Inhalt und eigener
Content-Freigabe aus. Ein vorzeitiges `Freigeben` auf die Benachrichtigung
wird ignoriert. Jeder Versand hat einen dauerhaften Claim vor dem Netzwerkaufruf;
unklare Ergebnisse werden nicht erneut gesendet.
Eine ausdrückliche erste Antwort genehmigt nur den Content-Plan. Für einen
freigabefähigen **Bildentwurf** erzeugt der konfigurierte Bildprovider genau
ein Originalbild und legt es in Vercel Blob ab. Erst danach legt das System eine
Publication Request an und schickt eine **zweite** WhatsApp zur finalen
Freigabe des Facebook-Posts. Reine Textentwürfe ohne Original-Visual bleiben
gesperrt. Ohne `REPLICATE_API_TOKEN` oder `OPENAI_API_KEY` stoppt dieser Schritt;
für Replicate sind die Migrationen `009_original_visual_attempts.sql` und
`010_replicate_visual_provider.sql` nötig. Die ursprüngliche Textkarte ist nie publishbar.

### Vorlage erst nach Kostenentscheidung aktivieren

Im Meta WhatsApp Manager eine **reine Textvorlage ohne Platzhalter oder Buttons**
zur Freigabe einreichen, etwa:

> Ein neuer Tagesentwurf für deine private Content-Planung ist bereit. Antworte
> auf diese Nachricht mit „Entwurf“, um den vollständigen Entwurf zu erhalten.
> Erst danach kannst du den Inhalt und separat die Veröffentlichung freigeben.

Meta entscheidet über die Kategorie und Genehmigung. Vor der Aktivierung die
im eigenen WhatsApp Manager für Empfängerland und Kategorie angezeigten Kosten
und die wiederkehrende Nutzung mit dem Betreiber klären. Die Anwendung liest
keinen verbindlichen Live-Tarif und behauptet keinen festen Betrag. Nach
Genehmigung den **exakten** Vorlagennamen und Sprachcode serverseitig als
`WHATSAPP_DAILY_TEMPLATE_NAME` und `WHATSAPP_DAILY_TEMPLATE_LANGUAGE` eintragen,
zum Beispiel `de`. Ausschließlich nach Kostenfreigabe
`WHATSAPP_DAILY_TEMPLATE_ENABLED=true` setzen und neu deployen. Vorher ist
diese Funktion aus. Preview und Production getrennt konfigurieren. Keine Vorlage
mit einem „Freigeben“-Button verwenden; der Text muss zum beschriebenen
zweistufigen Dialog passen. Das erste kostenpflichtige Senden ist ein eigener
bewusster Betriebsschritt.

## Tageslauf und echte Ergebnisse

Im Content Studio zeigt „Tageslauf & Ergebnisse“ die letzten 14 Tagesjobs,
bestätigte WhatsApp-Nachrichten, Freigabe- und Veröffentlichungsstatus sowie
die letzten 20 veröffentlichten Posts mit dem jeweils neuesten Messstand.
Ein fehlender Messstand erscheint als **unbekannt**, nicht als null Klicks.
Klicks, Verkäufe und Provisionen werden derzeit über das bestehende
Leistungsformular am jeweiligen Job mit Quellenbezeichnung eingetragen;
Amazon PartnerNet wird nicht automatisch ausgelesen. PartnerNet-Berichte
können als belegte Quelle für die Eingabe dienen. Die Wochenbilanz erscheint
montags nach dem separaten Cron und enthält ausschließlich gespeicherte
Messwerte und gegebenenfalls aus Meta gelesene Followerzahlen. Ohne
PartnerNet-Messstand meldet sie unbekannte Ergebnisse ausdrücklich.

Der Facebook-Fotopost wird nach der zweiten eindeutigen WhatsApp-Freigabe
genau einmal angefordert und in `publications` gespeichert. Bei unklarem
Meta-Ergebnis bleibt der Lauf gesperrt. Instagram ist noch nicht integriert.
Der tägliche Entwurf ist keine Zusage für einen täglich sichtbaren Post.

**Inbetriebnahme:** Der aktuelle Arbeitsbranch und seine Preview starten
keinen Vercel-Cron. Vor dem ersten produktiven Morgenlauf müssen die
Freigaben für Production erfolgen, die noch fehlenden Migrationen geschützt
angewendet, `CRON_SECRET` sowie alle benötigten Servervariablen geprüft und
die gewünschte tägliche WhatsApp-Vorlage im eigenen Meta-Konto genehmigt und
bewusst aktiviert werden. Ein Kontrolllauf sollte Tagesjob,
Benachrichtigung, beide getrennten Freigaben und schließlich einen einzigen
Post mit Permalink belegen. Keine bereits beanspruchten Tagesdaten neu
auslösen. Der Cron ist auf 07:00 UTC eingestellt (09:00 Uhr MESZ, 08:00 Uhr
MEZ); eine Zustellung vor 11 Uhr ist abhängig von Laufzeit und externen
Diensten und keine harte Garantie.

Die Migrationen 001–006 waren im Preview angewendet; 006 wurde am 24.09.2026
um 08:31:54 UTC über den geschützten Migrationsweg angewendet, Wiederholungen
meldeten ausschließlich `alreadyApplied` (siehe [VERIFICATION.md](VERIFICATION.md)).
Der Blob-Token ist vorhanden und
die Meta-Verbindung wurde lesend geprüft. Die Facebook-Schreibberechtigung
und der vollständige WhatsApp-/Meta-Durchlauf sind damit noch nicht bewiesen.
Vor autonomen täglichen Benachrichtigungen die genehmigte WhatsApp-Vorlage,
Kategorie samt Gebühren klären und sämtliche benötigten Migrationen in
Production bestätigen. Der Scout wählt saisonale Suchauswahlen, noch keine
verifizierten Einzelprodukte. Natürliche Änderungswünsche für Bild-/Textbeiträge
werden gespeichert, führen zu einer neuen redaktionellen Revision und sperren
die alte Freigabe. Instagram erfordert einen separaten
Container-/Publish-Ablauf und eigene Prüfung der externen Bild-URL.

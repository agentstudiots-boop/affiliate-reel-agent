# Unabhängiger Produktionsaudit – 13. Oktober 2026

Repository: `agentstudiots-boop/affiliate-reel-agent`
Produktion: https://affiliate-reel-agent.vercel.app
Prüfung und Änderungen: Codex, separater Branch `audit/independent-production-2026-10-13`.

## Entscheidung und Nachweisgrenzen

Die bestehenden Affiliate-Abläufe können unter ihren vorhandenen Freigaben weiterbetrieben werden. **Keine pauschale Produktionsfreigabe für das gesamte Agentensystem.** Neue Plattformen, Themen-Live-Publishing und Avatarproduktion bleiben gesperrt. Dieser Audit aktiviert keine dieser Funktionen und löst keine Veröffentlichung, WhatsApp-Nachricht oder kostenpflichtige Generierung aus.

Die sicher überprüfbaren Änderungen werden erst nach erfolgreichen lokalen Prüfungen, vollständiger GitHub-CI und Vercel-Preview integriert. Merge-/Deployment-Nachweise werden im abschließenden Übergabebericht ergänzt; dieses Dokument beschreibt den geprüften Ausgangsstand und den Änderungsumfang des PRs.

| Kennzeichnung | Bedeutung |
|---|---|
| IMPLEMENTIERT | Ausführbarer Code vorhanden; externe Funktion damit nicht bewiesen |
| GETESTET | Automatisierte Offline-/Mock-/PGlite-Prüfung bestanden; kein Anbieter-Livetest |
| DEPLOYED | Code einem READY-Deployment mit konkretem Commit zugeordnet |
| LIVE VERIFIZIERT | Tatsächliche Produktionsevidenz für den ausdrücklich genannten Teilablauf |
| BLOCKIERT | Fehlende Zugänge, Betreiberfreigaben oder Nachweise verhindern die Freigabe |
| UNBEKANNT | Keine hinreichenden Daten; ausdrücklich kein Fehlernachweis |

## 1. Tatsächlich geprüfter Stand

- GitHub `main` und Vercel-Production stimmten zu Auditbeginn überein: `37ac084478fee108e139b80222bd49333491156c`, nach PR #69 und #70.
- Production-Deployment: `dpl_A3nwyV6cFeruvRyGEzVqWUXqRRp3`, READY, `main`, Ziel `production`, Projekt `prj_tcYmiHTgJ3VF6E1bmapnNYkDHikI`, Region `fra1`, Node 24.
- Claudes vollständiger Bericht `docs/PRODUCTION_INTEGRATION_AUDIT_2026-10-13.md` wurde gelesen und mit Repository, GitHub, Vercel-Metadaten, read-only HTTP-Prüfungen und verfügbaren Laufzeitlogs abgeglichen. Historische Nachweise daraus werden nicht als eigene neue Livetests ausgegeben.
- Production-HTTP ohne Zugangscode: `/` und `/produkte` 200; `/api/architecture`, `/api/operations`, `/api/meta/connection`, `/api/whatsapp/connection`, `/api/cron/daily-draft`, `/api/cron/topic-scout`, `/api/cron/weekly-report` jeweils 401; WhatsApp-Webhook-GET ohne gültige Verifikation 403. Keine authentifizierten Cronläufe angestoßen.
- Neue eigenständige Produktionsevidenz: regulärer, bereits eingerichteter Cron am **13.10.2026 um 17:02 UTC / 19:02 Berlin** nahm den Nachmittagsslot wieder auf, fand Produktkandidaten, nutzte Referenz-Fallback, speicherte einen Entwurf und protokollierte `approval_sent`. Meta meldete um **17:02:49 UTC `delivered`**. Das beweist Zustellung dieses Inhaltsvorschlags, weder Antwort/Freigabe noch Produktion oder Veröffentlichung.
- Die Trend-Recherche protokollierte vier Suchabfragen und 20 Belege. Amazon-Seiten lieferten mehrfach HTTP 200, aber keine verwertbare Produktseite. Erfolgreiches HTTP allein ist keine bestätigte Produktidentität.
- Kein direkter Produktions-SQL-Zugang und kein Studio-Zugangscode lagen in dieser Ausführungsumgebung vor. Keine Secrets entschlüsselt, ersetzt oder in Bericht/Commit ausgegeben.

## 2. Priorisierte Befunde und Korrekturen

| Priorität | Befund | Ergebnis |
|---|---|---|
| Kritisch (Paketbefund) | Next.js 16.3.5 enthielt bekannte Sicherheitslücken, darunter `next/og`-RCE; `ImageResponse` wird im Repository verwendet | Next.js und passendes ESLint-Paket gezielt auf 16.3.8 gepatcht; `source-map-js` 1.2.2. Keine Ausnutzung behauptet; vollständige Neuprüfung |
| Hoch | Preview erhielt Produktions-Datenbank-/Blob-Zugänge und weitere gemeinsame Secrets; Runtime-Guard war die wesentliche Barriere | 26 gemeinsame Variablen ausschließlich um Ziel `preview` reduziert; Produktionswerte/-ziele erhalten. Guard weiter fail-closed. Alte Deployments und separat angelegte Provider-Preview-Zugänge sind gesondert zu prüfen |
| Hoch | Videoquota war getrennte Prüfung und Reservierung; parallele Worker konnten das Limit überschreiten | Atomare Transaktion mit Advisory Lock und Limitprüfung; verpflichtendes Quotaobjekt; Parallelitäts-/Grenztests |
| Hoch | Fehlgeschlagene/unklare Videoaufträge konnten Budget wieder freigeben | Alle reservierten Versuche zählen konservativ weiter; kein automatisches Budget-Recycling |
| Hoch | Runway-Produkt- und Themenpfad hatten keine gemeinsame atomare Kreditprüfung | Gemeinsames Monatsbudget unter Transaktionslock; Themenpfad zusätzlich nur mit explizitem positivem `TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT`; ungültige Budgetkonfiguration sperrt |
| Hoch | HeyGen-5xx beim Erstellen konnte erneuten kostenpflichtigen POST erlauben | Unklare Erstellung wird nicht automatisch wiederholt; Polling bekannter Job-ID bleibt möglich |
| Hoch | Neue lange Uploads müssen Widerruf während des Uploads berücksichtigen | Router liefert erneute zentrale Freigabeprüfung direkt vor finalem Pinterest-Pin/YouTube-Upload; Widerrufstest |
| Mittel | YouTube `processed` wurde auch bei privatem Video als öffentlich veröffentlicht gemeldet | Öffentlicher Erfolg nur mit `privacyStatus=public`; private/unlisted/fehlende Sichtbarkeit unbekannt, kein neuer Upload. Timeouts begrenzt, HTTP 408 beim Upload unklar |
| Mittel | Command Center vermischte Konfiguration mit Betriebsnachweis; fehlende Teilabfragen konnten Nullstände vortäuschen | Getrennte Evidenz für Konfiguration, Erreichbarkeit und Funktion; fehlende Teilzähler `Unbekannt`; DB-Lesen kein Nachweis für Migrationen/Schreiben |
| Mittel | Gemini/Pinterest fehlten in bestimmten Egress-Klassifikationen | Gemini als kostenpflichtiger Dienst vor allgemeinem Google-Matching; Pinterest als Publishing-Effekt gesperrt |
| Niedrig | Einige direkte Abhängigkeiten als `latest`; CI-Node wich von Production ab; zwei Lint-Warnungen | `latest` auf konkrete Versionen festgelegt; außer den gesonderten Sicherheits-Patches keine Paketupgrades; CI Node24; Warnungen behoben. `npm ci` war bereits vorher durch den Lockfile reproduzierbar |

### Preview-Konfiguration – genau ausgeführte Änderung

Bei 26 Einträgen wurde **nur** `preview` aus dem Zielarray entfernt: alle zuvor gemeinsamen `DATABASE_*`-Einträge, Blob-Schlüssel/-Metadaten, `WHATSAPP_APPROVER_WA_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `AI_GATEWAY_API_KEY`, `WHATTSAPP_BUSINESS_ACCOUNT_ID`, `WHATTSAPP_PHONE_NUMBER_ID`, `RUNWAYML_API_SECRET`. Die ungewöhnliche Schreibweise `WHATTSAPP_*` ist die vorhandene Konfiguration und wurde nicht umbenannt. Bereits bestehende `development`-Ziele blieben erhalten. Anschließende Metadatenabfrage bestätigte alle 26 Änderungen.

`RUNWAY_MONTHLY_BUDGET_CREDITS` bleibt als nicht geheime Grenze gemeinsam. Separat angelegte Preview-Einträge für Replicate, Meta, WhatsApp, Tavily, Faceless und Google AI existieren weiterhin; ohne Einsicht in deren Ressourcen lässt sich Isolation nicht bestätigen. Keine Sandboxschalter wurden gesetzt. Neue Previews haben keine Produktions-DB/-Blob-Konfiguration und sind damit **keine vollständig nutzbare Testumgebung**. Bestehende Deployments behalten ihre damaligen Umgebungsvariablen; Scopeänderungen wirken nicht rückwirkend.

## 3. Architektur und Status der Agenten

Jarvis ist die zentrale Inhaltsentscheidung. Spezialagenten liefern strukturierte Entwürfe an den Orchestrator; keine neue direkte Publisher-Verbindung wurde hinzugefügt. Themensteuerung und bestehende Affiliate-Steuerung bleiben getrennte fachliche Abläufe. Master-Content und Plattformvarianten nutzen den vorhandenen Multichannel-Router. Die bestehende produktbezogene Meta-Veröffentlichung bleibt erhalten.

Die Begrenzungen von maximal zwei Revisionen und acht Modellaufrufen sowie die Importregeln werden durch bestehende Tests abgesichert. Die zentrale Veröffentlichungsfreigabe bindet Inhalt, Version/Fingerprint, WhatsApp-Nachrichtenkontext und Plattform. Der neue Pinterest-Adapter wird ausschließlich im Publisher-Register eingebunden.

Alle folgenden bestehenden Komponenten waren im Ausgangsstand DEPLOYED. GETESTET bezeichnet die automatisierte Suite, nicht die laufende Fähigkeit eines externen Modells.

| Agent / Modul | IMPLEMENTIERT / GETESTET | Produktionsevidenz und Freigabestatus |
|---|---|---|
| Jarvis / Content-Orchestrator | Ja / ja | Affiliate-Draft bis WhatsApp-Zustellung live beobachtet; gesamter KI-Modus nicht live bewiesen |
| Trend-Agent / Trendscout | Ja / ja | Rechercheereignis mit vier Abfragen beobachtet; vollständige semantische Qualität unbekannt |
| Trendsetter / Content-Chancen | Ja / ja | Standardmäßig aus; Migration 035 produktiv nicht direkt verifiziert |
| Themen-Scout | Ja / ja | Themenpipeline aus; Quellen im Audit nicht live abgefragt |
| Themen-Orchestrator | Ja / ja | BLOCKIERT für Aktivierung; kein Cron in `vercel.json`, beide Live-Schalter aus |
| Produkt-Scout | Ja / ja | Produktkandidaten im regulären Cron beobachtet |
| Produkt-Reviewer / Resolver | Ja / ja | Fehlende Amazon-Listingdaten beobachtet; keine unbewiesenen Produkteigenschaften zulassen |
| Creative-Agent | Ja / ja | Referenzmodus im Cron, KI-Fähigkeit nicht unabhängig live bewiesen |
| Video-Agent | Ja / ja | Drehbucherstellung getestet; keine Videogenerierung im Audit |
| Bild-Agent | Ja / ja | Briefing/Layouts getestet; keine neue Bildgenerierung |
| Text-Agent | Ja / ja | Offline-Verträge getestet; keine separate Live-Fähigkeitsprüfung |
| Marketing-Agent | Ja / ja | Empfehlungen/Links, kein eigener Publisher |
| Script-Writer / Regelwerk | Ja / ja | Referenz-Fallback beobachtet; Manifest berücksichtigt |
| Format-Router | Ja / ja | Verfügbarkeit/Kosten berücksichtigt; neue Kanäle opt-in |
| Visual Engine / Qualitätsgate | Ja / ja | Bildprüfung im Code strikt; tatsächliche Bildfähigkeit des konfigurierten Modells unbekannt |
| Affiliate-/Link-Guard | Ja / ja | ASIN/Quellen/Links abgesichert; kein Ersatz für real bestätigte Produktdetails |
| Content-/Kosten-/Publikationsfreigaben | Ja / ja | Vorschlag zugestellt; weitere menschliche Freigaben nicht im Audit ausgelöst |
| WhatsApp-Router | Ja / ja | Bestehender Versand und Meta-Zustellwebhook live belegt; 24h-Abhängigkeit bleibt |
| Executive-Agent | Nein | Nur geplante Schnittstelle; darf keine Freigaben erteilen |

### Amazon und Content-Qualität

Der Scout begrenzt seine Produktabfragen; der vorhandene Produktvertrag/ASIN- und Affiliate-Guard verhindert beliebige Produktbehauptungen. Such-/Kategorieseiten sind Inspiration, keine verifizierten Spezifikationen. Bei nicht verwertbarer Listingseite muss der Referenzmodus kategorisch bleiben oder Eingaben anfordern. Im beobachteten Cron wurde ein Entwurf versandt, aber dessen vollständiger Inhalt und Bildqualität waren mangels Studio-/DB-Zugang nicht lesbar. Die Zustellung ist deshalb keine redaktionelle Qualitätsfreigabe. PR #61 darf diese Schranken nicht ungeprüft erweitern.

## 4. Publisher – sechs Adapter, ein Router

| Integration | Code / automatisierte Prüfung | Zugang / Live-Status | Ergebnis |
|---|---|---|---|
| Instagram | Bestehend, GETESTET | Produktpfad historisch dokumentiert; Themenpfad ohne `META_PAGE_ID`/`META_INSTAGRAM_USER_ID` | Kein neuer Livetest; bestehender Ablauf erhalten |
| Facebook | Bestehend, GETESTET | Produkt-Fotopost historisch dokumentiert; Themenpfad ohne `META_PAGE_ID` | Kein neuer Livetest; andere Formate nicht live freigegeben |
| YouTube | Bestehend, GETESTET, Statuskorrektur | Drei OAuth-Variablen Production-only vorhanden; Tokeninhalt/-gültigkeit unbekannt; Testmodus laut Vorbericht | BLOCKIERT für neue Aktivierung; standardmäßig privat |
| TikTok | Bestehend, GETESTET | App/OAuth/Domain-/API-Freigabe fehlen | Deaktiviert / BLOCKIERT |
| X | Bestehend, GETESTET | Zugang und passender Tarif nicht nachgewiesen | Deaktiviert / BLOCKIERT |
| Pinterest | Neuer API-v5-Adapter, GETESTET | Keine Pinterest-Zugänge gesetzt; kein Live-Pin | Standardmäßig deaktiviert / BLOCKIERT |

Pinterest: Bild-Pins aus freigegebenem Blob-Bild; Video-Pins aus derselben vorhandenen MP4 plus freigegebenem Cover im Master-Content. Medienregistrierung, strikt geprüftes vorsigniertes AWS-Ziel ohne OAuth-Header, begrenztes Polling, finaler Pin erst nach erneuter Freigabeprüfung. Titel/Beschreibung begrenzt; Text/Carousel ohne passenden Adapter werden nicht stillschweigend umgewandelt. Netzwerkfehler/5xx/408 beim finalen Pin sind unklar und werden nicht blind wiederholt. Status fließt über vorhandene Publikationstabelle und Command Center zurück.

OAuth-Refresh ist als Funktion samt Schnittstelle für gesperrte, atomare Tokenrotation vorbereitet. **Ein dauerhafter verschlüsselter Token-Speicher ist nicht angeschlossen**, und eine interaktive OAuth-Einrichtung wird nicht vorgetäuscht. Ohne Speicher akzeptiert der Adapter nur manuell sicher hinterlegte, noch gültige Access-Tokens mit Ablaufzeit. Pinterest gehört nicht zur Standard-Plattformliste. Eigene Credentials, Freischaltung und explizite Auswahl wären erst spätere Betreiberaktionen.

## 5. Video-Provider und Kostenschutz

| Provider | Implementierung / Ausgabe | Konfiguration und Prüfung | Freigabe |
|---|---|---|---|
| Replicate | Bestehende Modell-/Bild-/Vision-Anbindung und persistierte Bildversuche; kein neu aufgebauter Videozweig | Zugang vorhanden; automatisierte Fehler-/Qualitäts-/Versuchstests; kein bezahlter Livetest | Tatsächliche Modellqualität/Abrechnung unbekannt; Bildversuchsbudget ist kein globales Geldbudget |
| Runway | Bestehende Produktvideo- und gemeinsame Standardvideo-Anbindung, MP4 in Blob | Zugang vorhanden; Kostenfreigabe, einmaliger Start, gemeinsames atomar geprüftes Kreditbudget; Themenvideo zusätzlich positive Monatszahl nötig | Keine Generierung ausgelöst; neue Themenfunktion aus |
| HeyGen | Bestehender AvatarVideoRenderer und Provider wiederverwendet, v2-Erstellung/v1-Status, 720×1280 MP4 | API-Key, Avatar, Stimme und positive Monatszahl fehlen; Quota-/Polling-/Fehlertests bestanden | BLOCKIERT, keine Live-Generierung |
| Faceless (Altpfad) | Vorhandener Legacy-Anbieter | Keine neue Pipeline/Erweiterung | Nicht für neue Aktivierung empfohlen |

Runway verwendet konservative bestehende Kreditabschätzung (300 je Themenjob, gespeicherte Schätzung im Produktpfad); fehlgeschlagene/unklare Starts bleiben belastet. Das ist eine anwendungsseitige Grenze, kein Nachweis des aktuellen Anbieter-Guthabens oder tatsächlicher Rechnungsbeträge. HeyGen begrenzt die Anzahl reservierter Videos; deren Geldkosten variieren mit Tarif/Dauer. Vor Aktivierung zusätzlich Anbieter-Ausgabenlimit/Prepaid-Guthaben und eine wirtschaftlich freigegebene Monatszahl setzen. Kostenlose Web-App-Kontingente sind kein Nachweis kostenloser API-Nutzung.

Ein erzeugtes Video wird archiviert und im Master-Content für passende Plattformen wiederverwendet. Plattformvarianten sind Metadaten-/Formatanpassungen, keine automatischen neuen kostenpflichtigen Generierungen. HeyGens alte öffentliche Referenz ist inzwischen archiviert; aktueller Vertrags-/API-Zugang muss vor Aktivierung am eigenen Konto geprüft werden. Der bestehende Downloader vertraut Anbieter-URLs; strengere Redirect-/Hostregeln bleiben technische Schuld des deaktivierten Pfads.

## 6. Command Center

Sieben Bereiche bestehen: Recherche, Kreativ, Qualität, Medien, Freigaben, Publishing, Infrastruktur. Jarvis liegt im Ursprung; sieben Hubs liegen auf einem Ring. Tests prüfen Knoten/Kanten, fehlende/duplizierte IDs, Routerverbindungen, Labelgrößen und responsive Kameraziele. Kamera-FOV 45°, Übersichtsdistanz abhängig vom Seitenverhältnis, begrenzter Zoom/Reset und reduzierte Bewegung sind vorhanden.

Die Anzeige trennt jetzt:

1. Implementierung und automatisierte Tests aus dem versionierten Architekturmodell;
2. tatsächliche Deployment-Umgebung;
3. Konfiguration (nur Namen/Vorhandensein, keine Geheimnisse);
4. aktuelle Erreichbarkeit, sofern tatsächlich gemessen;
5. Funktionsnachweis mit Quelle/Zeitpunkt bzw. unbekannt;
6. Fehler oder Deaktivierung unabhängig davon.

Ein vorhandenes Token beweist keine erfolgreiche Anmeldung. Erfolgreiche SELECTs beweisen nur lesenden DB-Zugriff. Historische Publikationen belegen den damaligen Erfolg, keine aktuelle Provider-Erreichbarkeit. Fehlende Runtime-Daten erzeugen nicht automatisch „Handlungsbedarf“. Fehlende Teilabfragen ergeben keine erfundenen Nullstände.

API-Zugang ohne Authentisierung live 401 bestätigt. Die authentifizierte WebGL-Ansicht konnte in dieser Umgebung **nicht visuell freigegeben** werden: Playwright war vorhanden, Chromium fehlte; beide begrenzten Installationsversuche scheiterten an unbrauchbaren Downloadarchiven. Kein Screenshot-/Mobilgeräte-Live-Nachweis. Die geometrischen/Status-Tests ersetzen keine Sichtprüfung von Lesbarkeit, Überlagerungen und Touch-Zoom auf dem Zielgerät.

## 7. Datenbank, Blob, Cron und Observability

| Bereich | Prüfung | Grenze |
|---|---|---|
| Migration 034 | Bildversuche, Qualitätsentscheidungen, manuelle Grants, Lernerfahrungen; additive Tabellen/Indizes; Upgrade-/Migrationstests | Live-Schema nicht direkt abgefragt |
| Migration 035 | Content-Chancen und Routen, Unique-Index gegen parallele offene Routen | Themen-/Trendsetter-Aktivierung aus; Live-Schema unbekannt |
| Migration 036 | WhatsApp-Zustellstatus und tägliche Slot-Evidenz; additive Tabellen/Indizes | Logs zeigen Zustellwebhook/Slotablauf; kein separater SQL-Beleg für vollständiges Schema |
| Gesamte Migrationen | Reihenfolge 001–036 im Register; PGlite-Neuaufbau und Upgradefälle getestet | Keine neue/zerstörende Migration; keine Migration vom Audit ausgelöst |
| Blob | Eigene Blob-URLs/Medien im Publisher, guarded-blob für Schreibzugriffe; Preview-Zugang reduziert | Kein Live-Upload/-Löschen; Public-Medien sind keine Geheimnisablage |
| Cron | Sechs UTC-Tagesaufrufe 07/08/09/16/17/18 Uhr; Berlin-Slots im Code, Locking/Retry/DST-Tests; Wochenbericht Mo 08:15 UTC | Bestehende Cronkonfiguration unverändert, Themencron bewusst nicht eingetragen |
| Logs | Strukturierte Stufen-/Quota-/Publishing-Ereignisse, Zustell- und Slotpersistenz | Kurze Vercel-Aufbewahrung; kein belastbarer Alarm-/SLA-Nachweis; IDs können personenbezogene Bestandteile enthalten, deshalb hier nicht wiedergegeben |

Automatische Migration beim ersten DB-Aufruf bleibt ein Betriebsrisiko bei künftigen komplexen Migrationen. Für den hier gelieferten Code sind keine Schemaänderungen nötig. Das neue gemeinsame Runway-Budget liest die bereits vorhandene `provider_usage`-Tabelle; ein unvollständiges Schema sperrt neue kostenpflichtige Starts statt das Budget zu umgehen.

## 8. Offene PRs und Branches

Remote-Refs wurden inventarisiert; 14 Branches außerhalb direkter Main-Ancestry enthalten teils bereits squash-gemergte Vorgängerstände. Eine Nicht-Ancestor-Liste ist kein Beweis unintegrierter Features. Kein Branch gelöscht, kein fremder PR gemergt.

| PR | Befund | Maßnahme |
|---|---|---|
| #10 `feat/content-identity-history` | Draft, Konflikte; Migration 010 kollidiert mit bestehender 010 | Nicht integrieren; neu basieren/nummerieren und unabhängig prüfen |
| #61 `feature/reel-intelligence-patterns-20261008` | Veraltete Basis; CI-Run `37844577922` failure; `creative.ts` importiert Reel-Intelligence entgegen Importtest | Nicht integrieren; Orchestrator muss Informationen zuliefern |
| #65 `legal-pages-pinterest-prep` | Draft, veraltet/konfliktbehaftet; laut Vorbericht durch #66 ersetzt | Nicht integrieren; Schließen nach Betreiberreview möglich |

Main war ungeschützt. Erforderliche CI-/Reviewregeln sollten in GitHub eingerichtet werden; Repositoryadministration wurde nicht ungefragt umkonfiguriert.

## 9. Erforderliche manuelle Konfiguration – genaue Reihenfolge

### YouTube / Google Cloud (Kontoinhaber)

1. Bestehendes Google-Cloud-Projekt der vorhandenen `YOUTUBE_CLIENT_ID` öffnen; API-Bibliothek → YouTube Data API v3 und zuständiges YouTube-Konto/Kanal prüfen. Bestehende Secrets zunächst erhalten.
2. Google Auth Platform → Audience: tatsächlichen Publishing-Status prüfen. Bei `Testing` für externe App auf `In production` umstellen, sofern die Google-Anforderungen erfüllt sind. Branding mit App-Name, Supportkontakt, Homepage, Datenschutz und berechtigten Domains vervollständigen. Data Access auf benötigte Scopes begrenzen.
3. Mindestens `https://www.googleapis.com/auth/youtube.upload` für Upload. Für geschützte Kanal-/Statusabfragen zusätzlich geeigneten lesenden Scope, typischerweise `youtube.readonly`, prüfen. Keine pauschale Vollzugriffsberechtigung anfordern. Ob Brand-/Scope-Verifizierung erforderlich ist, hängt von Nutzerkreis und Google-Anzeige ab; persönliche Nutzung ist nicht automatisch ein öffentlicher App-Rollout.
4. In Clients den bestehenden OAuth-Client und exakt registrierte Redirect-URI prüfen. Über kontrollierten Authorization-Code-Flow mit `state`, Offline-Zugriff und ggf. erneuter Einwilligung einen Refresh-Token für den richtigen Kanal erhalten. Im Testmodus ausgestellte Tokens können nach sieben Tagen ablaufen; Umstellung allein ist kein Nachweis, dass der alte Token dauerhaft funktioniert.
5. Vor Austausch den vorhandenen Token in einer berechtigten, geheimnisgeschützten Umgebung gegen `/token` prüfen und anschließend lesend Kanal/Scopes prüfen. Keine Tokens in URL/Terminalprotokollen/Berichten ausgeben. Bei `invalid_grant` erst neuen Token validieren, dann atomar `YOUTUBE_REFRESH_TOKEN` Production-only ersetzen; funktionsfähige Client-ID/-Secret nicht pauschal überschreiben.
6. `YOUTUBE_PRIVACY_STATUS=private` zunächst beibehalten. Google-Cloud-Kontingente am konkreten Projekt prüfen. Ein privater Testupload benötigt ebenfalls ausdrückliche Freigabe des Betreibers und ist nicht Bestandteil dieses Audits. Erst nach Status-/Kanalnachweis eine separate öffentliche Aktivierung entscheiden.

Aktuelle offizielle `videos.insert`-Dokumentation unterscheidet sich vom Vorbericht: die alte pauschale Behauptung, jeder Upload aus einem unverifizierten Projekt werde zwingend privat gehalten, ist dort nicht mehr gültig. Auch alte fest angenommene Upload-Quoten werden hier nicht als aktuelle Kontokonfiguration ausgegeben. Unser Adapter selbst bleibt standardmäßig privat.

### WhatsApp und tägliche Freigaben

Außerhalb des Kundenservicefensters sind zugelassene Templates nötig. Laut Vorbericht ist die tägliche Templatefunktion auf Betreiberwunsch aus; frisch geprüft wurden Vorhandensein/Ziele der Variablen, nicht deren Geheimniswerte. Ohne neue eingehende Nutzernachricht oder genehmigtes Template gibt es keine Garantie einer täglichen Freigabenachricht. Der erfolgreiche 17:02-Lauf widerlegt keinen späteren Fensterschluss.

Betreiber muss entweder regelmäßig das Fenster öffnen oder eine passende Vorlage in WhatsApp Manager genehmigen lassen, Sprache/Name/Parameter der vorhandenen Templatekonfiguration abgleichen, Preise akzeptieren und erst dann `WHATSAPP_DAILY_TEMPLATE_ENABLED` bewusst aktivieren. Test mit geschlossener 24h-Frist und tatsächlichem Zustellstatus anschließend separat genehmigen. Keine freie Textnachricht als vermeintliche Umgehung senden.

### Pinterest

Business-/Developer-App und Zugriff auf gewünschtes Konto/Board genehmigen lassen; OAuth mit validiertem `state` und exakt erlaubter Redirect-URI. Scopes nach benötigten Aktionen (`boards:read`, `pins:read`, `pins:write`) begrenzen. `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`, Access-/Refresh-Token sicher halten; Access-Ablauf explizit dokumentieren. Kontinuierliche Tokenrotation muss neue Access- und Refresh-Tokens gemeinsam unter Lock dauerhaft speichern. Diese Speicherintegration fehlt noch und ist ein Go-live-Blocker.

Production-Variablen: `PINTEREST_ACCESS_TOKEN`, `PINTEREST_ACCESS_TOKEN_EXPIRES_AT` (ISO), `PINTEREST_BOARD_ID`; OAuth-Clientdaten nur bei angeschlossenem sicheren Refresh-Speicher. Keine Aktivierung im Audit. Erst eigener Testbereich/Board, Format-/Cover-/Linkkontrolle und separat autorisierter Pin; danach explizite Aufnahme in `TOPIC_PLATFORMS` und gesonderte Freigabe des Themen-Live-Publishings.

### Video und Infrastruktur

- HeyGen-Konto/API-Tarif, freigegebenen Avatar und deutsche Stimme verifizieren; `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, positive `HEYGEN_MONTHLY_VIDEO_LIMIT` nur nach Kostenentscheidung setzen. Vertrag/Version/Downloadhosts sowie harte Anbieter-Kostenbegrenzung vor Generierung prüfen.
- Runway-Guthaben/Tarif und angemessenes `RUNWAY_MONTHLY_BUDGET_CREDITS` kontrollieren. Themenvideo nur nach ausdrücklicher Aktivierung des bestehenden Providers plus zusätzlichem Monatslimit. Keine doppelte Medienerzeugung je Plattform.
- Für nutzbare Previews getrennte Neon-DB, Blob-Store, Testkonten und begrenzte Provider-Keys provisionieren. Alte Deployments bis zu ihrer Stilllegung als Träger historischer Konfiguration behandeln. Sandboxressourcen erst nach nachgewiesener Trennung deklarieren.
- Migrationen 034–036 durch berechtigten read-only Schema-/Migrationsledger-Check nachweisen. Danach authenticated Command Center Desktop/Mobil visuell prüfen. Keine manuellen DDL-Kommandos aus diesem Audit ableiten.
- GitHub-Main-Schutz mit verpflichtender Quality-CI/Review einrichten; Vercel-Logs plus persistierte Slot-/Delivery-Tabelle überwachen. Alarmierung für ausbleibende Tageszustellung, fehlgeschlagene/unklare Publikation und Budgetgrenze definieren.

## 10. Validierung und verbleibende Risiken

Automatisiert werden unter anderem zentrale Freigabe/Widerruf, Fingerprint-/Plattformbindung, doppelte Requests, Pipeline-Recovery, Amazon-Verträge, Migrationen, Preview-Effekte, Videoquota/Parallelität, gemeinsames Runway-Budget, unklare Anbieterantworten, Pinterest-OAuth/Medienupload und YouTube-Sichtbarkeit geprüft. Tests nutzen Mocks bzw. PGlite, keine kostenpflichtigen Provider.

Die endgültige lokale Suite nach den gezielten Abhängigkeits-Patches bestand mit **626/626 Tests**, null Fehlern und null übersprungenen Tests (136,7 Sekunden). Typecheck, Lint (null Warnungen) und Next.js-16.3.8-Production-Build bestanden. `git diff --check` war sauber. CI prüft zusätzlich Produktionsabhängigkeiten mit `npm audit --omit=dev --audit-level=high`. Remote-CI-, Merge- und Deployment-Nachweise werden im Übergabebericht ergänzt; lokale Ergebnisse werden nicht als vorweggenommene CI-Freigabe verwendet.

Verbleibende Risiken: fehlende Live-Schema-/Studioevidenz, WebGL-Sichtprüfung, WhatsApp-Fenster ohne Templategarantie, ungeprüfte OAuth-Tokens/Scopes, fehlende dauerhafte Pinterest-Tokenrotation, Anbieter-API-/Kostenbedingungen, tatsächliche Bild-/Videoqualität, verbleibende Legacy-Publishingpfade, Provider-Preview-Isolation und alte Deployments, ungeschützter Main, unbewiesene Alarmierung und zukünftige automatische Migrationen. Keines davon wird durch einen grünen Build als erledigt ausgegeben.

### Abhängigkeitssicherheit

`npm audit` meldete zunächst sieben betroffene Pakete (eine kritische, sechs hohe Einstufungen; teilweise dieselbe transitive Ursache). Nach Next.js/ESLint-16.3.8 und `source-map-js` 1.2.2 meldet `npm audit --omit=dev` **0** bekannte Schwachstellen. Im vollständigen Audit bleiben fünf als hoch eingestufte Pakete derselben transitiven Ursache. Die Entwicklungsabhängigkeitskette `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` bleibt als hoher DoS-Befund offen: `braces` 3.0.3 ist weiterhin die veröffentlichte aktuelle Version. Das automatisch angebotene Downgrade auf ESLint-Konfiguration 14.2.35 wäre inkompatibel und wird nicht ausgeführt. Keine Nutzereingaben werden als Lint-Glob übergeben; Risiko betrifft primär Entwicklungs-/CI-Eingaben, kein belegter öffentlicher Runtime-Angriffspfad. Upstream-Fix beobachten. Eine grüne Produktions-Abhängigkeitsprüfung bedeutet nicht, dass jede mögliche Schwachstelle ausgeschlossen ist.

## 11. Primärquellen (am 13.10.2026 geprüft)

- Pinterest: https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/
- Pinterest OAuth: https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/
- Google OAuth / Refresh-Token-Lebensdauer: https://developers.google.com/identity/protocols/oauth2
- YouTube Upload/Scopes/Sichtbarkeit: https://developers.google.com/youtube/v3/docs/videos/insert
- YouTube Status: https://developers.google.com/youtube/v3/docs/videos/list
- Meta Nachrichten: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- Meta Templates: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
- HeyGen archivierte Anbieterreferenz: https://github.com/heygen-com/skills-legacy/blob/master/skills/heygen/references/video-generation.md
- Next.js Sicherheitsmeldung: https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j
- Braces Sicherheitsmeldung: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- HeyGen API-Tarife: https://www.heygen.com/api-pricing

Produktionsentscheidung: **Härtungsänderungen nach grünen Qualitätsgates ausliefern; bestehende freigabepflichtige Affiliate-Nutzung fortführen; keine Freigabe neuer Live-Kanäle oder kostenpflichtiger Generierungen ohne die jeweils offenen Nachweise und ausdrückliche Aktivierung.**

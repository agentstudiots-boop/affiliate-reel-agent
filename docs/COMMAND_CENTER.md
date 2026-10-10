# Jarvis Command Center

Interaktive Schaltzentrale des Jarvis-Systems im Content Studio (Zugangscode eintragen → „Jarvis 3D Command Center öffnen“).
Prüfbericht und Aktivierungsplan: `docs/JARVIS_AUDIT_2026-10-10.md`.

## Was es zeigt
- Jarvis im Zentrum, sieben Hauptbereiche im Kreis: Recherche & Themen, Kreativ & Content, Qualität & Sicherheit,
  Medienproduktion, WhatsApp & Freigaben, Multichannel-Publishing, Infrastruktur. Komponenten erscheinen erst beim Öffnen eines Bereichs.
- Je Komponente drei getrennte Status: **Umsetzung** (Geplant/Implementiert/Getestet), **Deployment** (Nicht deployt/Preview/Production),
  **Betrieb** (Nicht konfiguriert/Deaktiviert/Bereit/Aktiv/Fehler/Unbekannt) – mit Grund, Quelle und Zeitpunkt. Farbe ist nie die einzige Kennzeichnung.
- Gesamtübersicht (Jarvis oder leere Auswahl): Umgebung, Datenquellen, Komponenten nach Status, Handlungsbedarf, wartende Freigaben,
  letzte Veröffentlichungsversuche mit Links, Schalter, fehlende Zugänge (nur Variablennamen).
- Ablauf: neun Schritte eines Themenbeitrags. Zahlen nur, wenn die Datenbank lesbar ist; sonst ausdrücklich Architekturdarstellung.

## Bedienung
| Aktion | Wirkung |
| --- | --- |
| Bereich anklicken (3D oder Chip) | aufklappen, Kamera fokussiert; erneut anklicken schließt |
| Komponente anklicken | Detailpanel, nur ihre Verbindungen, Rest tritt zurück |
| Leerraum / Esc / ↑ | eine Ebene zurück (Komponente → Bereich → Übersicht); Esc in der Übersicht schließt |
| ← → / Enter / Pos1 | Tastatur: Bereiche bzw. Komponenten wechseln, öffnen, Übersicht |
| Ziehen, Mausrad, Pinch | drehen, zoomen |
| 2D-Ansicht | gruppierte Karten, gleiche Detailpanels; automatisch ohne WebGL |
| Aktualisieren | Status neu vom Server |

## Technik
- Daten: `GET /api/architecture` (Zugangscode, nur GET, `no-store`). Statisches Modell `lib/architecture/model.ts`; Betriebsstatus
  `lib/architecture/runtime.ts` (serverseitig, nur Variablennamen/Schalter); Laufzeitnachweise `lib/architecture/snapshot.ts` (nur `SELECT`,
  in Preview vom Runtime-Guard gesperrt). Werte von Variablen verlassen nie den Server (Test).
- 3D: `app/architecture/scene.tsx` (React Three Fiber/Drei, per `next/dynamic` nur im Browser). Layout und Kameraziele rein und getestet
  (`lib/architecture/layout.ts`); Beschriftungen als Sprites, Größe aus Kameradistanz und Bühnenhöhe, auf kleinen Bühnen Kurznamen.
- Fallbacks: kein WebGL, Fehler in der Szene oder manuell → 2D. Die Szene wird einmal gemountet und danach nur ausgeblendet (`frameloop="never"`).
- Panels: `app/architecture/panels.tsx`; Steuerung: `app/architecture/command-center.tsx`.

## Pflege
Neue Komponente = Eintrag in `NODES` (mit `plain`, `short`, `since`, `operation`, `effects`) und passende `EDGES`.
`tests/architecture.test.cjs` prüft IDs, Verbindungen, existierende Code-/Testpfade und Nachweisquellen, Variablennamen, Layout-Abstände,
Status-Logik, die Lesbarkeit der Snapshot-Abfragen und den Zugangsschutz der API. Einen Status nur mit Nachweis vergeben.

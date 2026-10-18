# HeyGen-Produktvideos mit Markenavatar „Mia“ – technische Prüfung und Vorbereitung

Stand 15.10.2026, ergänzt 18.10.2026 (Abschnitt 6). **Keine kostenpflichtige Produktion, kein Abo, keine Aktivierung.** `HEYGEN_ENABLED` bleibt aus.

## 1. Product Placement: Webstudio vs. API

| Frage | Befund | Quelle |
|---|---|---|
| Gibt es „Product Placement“ (Avatar hält/zeigt ein Produkt)? | Ja, als Funktion im **HeyGen-Webstudio** (Produktbild + Avatar), nur in bezahlten Plänen (Creator/Teams/Enterprise). Kleine, handliche Produkte funktionieren laut HeyGen am besten; große Gegenstände werden ggf. verkleinert. Ein Test Dritter fand verzerrte, unlesbare Schrift auf dem Produkt. | HeyGen Academy „How to add products to your avatar“, HeyGen-Community „Product placement“, ProVideo Coalition |
| Ist Product Placement über die **öffentliche API** steuerbar? | **Nicht dokumentiert.** Die API-Doku (developers.heygen.com) nennt für `POST /v3/videos` kein Feld für ein gehaltenes Produkt. `watermark.placement` betrifft nur Logo-Overlays. | HeyGen Developer Docs „Create Video“ |
| Welche API-Wege nehmen echte Produktbilder auf? | (a) **Video Agent** `POST /v3/video-agents` mit `files` (Bilder als URL oder `asset_id`, bis zu 20 Anhänge; im E-Commerce-Beispiel bis 5 Produktbilder je SKU) – erzeugt ein Video aus Prompt + Dateien, die Szenen bestimmt HeyGen. (b) **Studio-Video** (`type: "studio"`) mit Szenenliste (Avatar-Szenen + Produktbild-/Video-Szenen). (c) Hintergrundbild einer Avatar-Szene. | HeyGen Developer Docs „E-commerce Product Videos“, „Prompt to Video“, „HeyGen Studio“, „Assets“ |
| API-Version im Projekt | Der Provider `lib/visual/providers/heygen.ts` nutzt **v2** (`POST /v2/video/generate`, 720 × 1280, Status `GET /v1/video_status.get`). Die aktuelle Doku beschreibt **v3** (`POST /v3/videos`, `type: "avatar"`, `avatar_id`, `script`, `voice_id`, `aspect_ratio: "9:16"`, `resolution: "1080p"`, Engine Avatar IV als Standard, Abruf `GET /v3/videos/{video_id}`). | HeyGen Developer Docs „Avatar IV“, „Digital Twin“ |

**Folgerung:** „Mia hält das Produkt“ ist über die API derzeit **nicht verlässlich automatisierbar**. Automatisierbar und dokumentiert ist: Mia spricht (Avatar IV, 9:16) und **zwischengeschnittene echte Produktaufnahmen** (Studio-Szenen) oder ein Video-Agent-Video aus echten Produktbildern. Das Briefing (`lib/visual/avatar-briefing.ts`) plant deshalb `hold_in_hand` nur, wenn ein eigenes Produktbild mit Rechten vorliegt, und der Preflight weist darauf hin, dass dieser Teil manuell im Webstudio oder als Szenenschnitt entsteht.

## 2. Kosten und Zugang (nicht am Konto verifiziert)

- Laut Drittquellen wurden **kostenlose API-Credits im Februar 2026 eingestellt**; das kostenlose Kontingent (ca. 3 Videos/Monat, 720p, Wasserzeichen) gilt nur im **Webstudio**, nicht über die API. → Das „3 Videos gratis“-Kontingent ist **für die Automatisierung nicht nutzbar**.
- API-Abrechnung: Prepaid-Guthaben (Self-Service ab ca. 5 USD). HeyGen-Entwicklerdoku (Enterprise): Avatar IV **0,1 Credit/Sekunde, 1 Credit = 0,50 USD → ca. 0,05 USD/s ≈ 3 USD pro Minute**; das Help-Center nennt ca. 4 USD/min (1080p) bzw. 5 USD/min (4K). Quellen widersprechen sich teilweise.
- Kommerzielle Nutzung, Wasserzeichen und Auflösung hängen vom Plan ab → vor Aktivierung am eigenen Konto prüfen.
- `HEYGEN_API_KEY` ist in Production seit 14.10. gesetzt (nur Name geprüft). Ob er zu einem API-fähigen, aufgeladenen Konto gehört, ist **unbekannt** (HeyGen ist aus dieser Umgebung nicht erreichbar, kein Testaufruf).

Der Preflight rechnet mit `HEYGEN_COST_PER_SECOND_USD` (Standard 0,05) und weist das als **Schätzung** aus; maßgeblich ist der Preis, den HeyGen vor der Generierung anzeigt.

## 3. Was implementiert ist (dieser PR)

| Baustein | Datei | Status |
|---|---|---|
| Produktionsbriefing Mia (Sprechtext, Szene, Kamera, Gestik, Produktinteraktion, Nahaufnahme, Untertitel, CTA, Kennzeichnung, Licht, Hintergrund, 9:16, Qualitätsanforderungen) – getrennte Felder, abgeleitet aus dem **freigegebenen** Video-Drehbuch des bestehenden Video-Agenten | `lib/visual/avatar-briefing.ts` | implementiert, getestet |
| Produktreferenzen: nur vom Betreiber hochgeladene Bilder mit bestätigten Nutzungsrechten (keine Amazon-Katalogbilder – Partnerlizenz deckt KI-Videoeingabe nicht) | `productReferenceSchema` | implementiert, getestet |
| Preflight: Feature-Flag, Konfiguration, Länge, Sprechtextlänge, Kennzeichnung, Produktbild-Pflicht für „in der Hand“, Monatslimit, Kostenschätzung, v2/v3-Hinweis – **ohne Netzaufruf** | `lib/visual/avatar-preflight.ts` | implementiert, getestet |
| Qualitätsprüfung: technische Prüfung aus Metadaten (9:16, ≥ 1280 px Höhe, Dauer, Ton) + Betreiber-Checkliste (Lippensynchronität, Natürlichkeit, Gesten/Hände, Produktdarstellung, Fakten, Briefingtreue, Kennzeichnung). Kein automatisches Freigeben. | `technicalVideoCheck`, `VIDEO_QUALITY_CHECKLIST` | implementiert, getestet |
| Schalter `HEYGEN_ENABLED` im Provider selbst: ohne exakt `true` ist HeyGen „nicht verfügbar“, der Format-Router wählt kein Avatar-Video und `create()` sendet keine Anfrage | `lib/visual/providers/heygen.ts` | implementiert, getestet |
| Bestehender Kostenschutz (atomares Monatslimit, kein Re-POST nach unklarer Antwort), Freigaben | `lib/visual/providers/heygen.ts`, `lib/visual/video.ts` | unverändert |

**Nicht implementiert (bewusst):** v3-Aufruf, Video-Agent-Aufruf, Upload von Produktbildern zu HeyGen, automatische Lippensynchronitäts-Bewertung, Command-Center-Liste je Avatar-Video (es gibt noch keine Avatar-Produktion; die Ansicht folgt mit dem ersten Produktionsdatensatz).

## 4. Vorgesehener Ablauf (Zielbild)

Jarvis wählt Avatar-Video → Video-Agent (Drehbuch) → Skriptprüfung → **Inhaltsfreigabe** → `buildAvatarBriefing` → `avatarPreflight` → **Kostenfreigabe per WhatsApp** (Briefing-Zusammenfassung + Schätzung) → HeyGen-Render (Flag an) → Archiv in Blob → `technicalVideoCheck` + Betreiber-Checkliste → **Veröffentlichungsfreigabe** → Multi-Channel-Publisher (Instagram-Reel/Facebook-Reel/Shorts).

## 5. Betreiberentscheidungen vor einem ersten bezahlten Testclip

1. HeyGen-Konto: API-Zugang mit Guthaben bestätigen (kein Abo durch den Agenten). Ausgabenlimit beim Anbieter setzen.
2. „Mia“ anlegen: Photo-Avatar/Digital Twin mit **dokumentierter Einwilligung bzw. Rechten** an Aussehen und Stimme; deutsche Stimme wählen. IDs als `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID` setzen.
3. `HEYGEN_MONTHLY_VIDEO_LIMIT` (z. B. 2) und optional `HEYGEN_COST_PER_SECOND_USD`, `HEYGEN_MAX_VIDEO_SECONDS` setzen.
4. Entscheidung „Produkt in der Hand“: Webstudio manuell oder Szenenschnitt mit eigenem Produktfoto (automatisierbar).
5. Freigabe für **einen** Testclip (≈ 20–30 s, geschätzt 1–1,50 USD) und erst dann `HEYGEN_ENABLED=true`.
6. Danach v3-Umstellung des Providers (1080p) mit dem Testclip als Live-Nachweis.

## 6. Nachtrag 18.10.2026: API v3, Video Agent, Themenvideos

| Punkt | Befund | Folge im Code |
|---|---|---|
| Avatar-Video v3 | `POST /v3/videos` mit `type: "avatar"`, `avatar_id`, `script`, `voice_id`; optional `resolution`, `title`, `output_format`, `engine` (Avatar IV Standard, Avatar V wählbar). `aspect_ratio` muss ausdrücklich `"9:16"` sein (Beispiele/Standard 16:9). Stimmen über `GET /v3/voices`. | Provider bleibt **v2** (720 × 1280). Umstellung erst mit Konto, Avatar und einem freigegebenen Testclip (sonst kein Nachweis). |
| Video Agent | Prompt-zu-Video mit Dateien (Produktbilder); Enterprise-Doku: 0,0667 Credits/s bei 0,50 USD/Credit ≈ 2 USD/Minute (Drittquellen nennen bis 5,82 USD/Minute). Szenen bestimmt HeyGen. | nicht angebunden; für Produktvideos mit echten Produktbildern die dokumentierte Alternative zu „Produkt in der Hand“. |
| Avatar-Kosten API | ca. 0,0167–0,0667 USD/s je nach Engine/Avatar-Typ; Prepaid ab 5 USD, kein Abo. | Planung mit `HEYGEN_COST_PER_SECOND_USD` (Standard 0,05). |
| Produktplatzierung | weiterhin nur Webstudio; über die API nicht dokumentiert. | Priorität A (in der Hand) nur manuell; B (neben Mia) über Studio-Szenen; C (Mia spricht, Produkt als Zwischenschnitt) automatisierbar – Briefing plant das bereits. |
| Themenvideos ohne Produkt | keine Produktplatzierung nötig. | Täglicher Themenvideo-Vorschlag (PR #79) nutzt HeyGen nur, wenn aktiv; sonst Runway WAN 3. |

Quellen (Nachtrag): [Create Video](https://developers.heygen.com/reference/create-video), [Digital Twin](https://docs.heygen.com/docs/create-video), [HeyGen Studio](https://developers.heygen.com/studio-videos), [HeyGen Video](https://developers.heygen.com/docs/models/heygen-video), [Enterprise Pricing](https://developers.heygen.com/docs/enterprise-pricing), [G2 – HeyGen API Pricing](https://www.g2.com/articles/heygen-api-pricing), [Sume – HeyGen API pricing](https://www.sume.com/blog/heygen-api-pricing) (Drittquellen widersprechen sich teilweise; maßgeblich ist der Preis bei HeyGen vor der Generierung).

## Quellen

- [HeyGen Academy – How to add products to your avatar](https://www.heygen.com/academy/avatars/how-to-add-products-to-your-avatar)
- [HeyGen Community – Product placement: create avatars including products](https://community.heygen.com/public/resources/product-placement-create-avatars-including-products)
- [HeyGen – AI Product Placement](https://www.heygen.com/en-gb/tool/ai-product-placement)
- [ProVideo Coalition – HeyGen Avatar IV gets real](https://www.provideocoalition.com/ai-tools-heygen-avatar-iv-gets-real/)
- [HeyGen Developer Docs – Create Video](https://developers.heygen.com/reference/create-video), [Avatar IV](https://developers.heygen.com/avatar-iv), [Digital Twin](https://developers.heygen.com/generate-avatar-video), [HeyGen Studio](https://developers.heygen.com/studio-videos), [E-commerce Product Videos](https://developers.heygen.com/e-commerce-product-videos), [Prompt to Video](https://developers.heygen.com/docs/video-agent), [Assets](https://developers.heygen.com/assets), [Enterprise Pricing](https://developers.heygen.com/docs/enterprise-pricing)
- [HeyGen Help – Avatar IV Complete Guide](https://help.heygen.com/en/articles/11269603-heygen-avatar-iv-complete-guide)
- [Creatify – HeyGen pricing 2026](https://creatify.ai/blog/heygen-pricing-(2026)-plans-and-what-you-ll-actually-pay), [Anam – HeyGen pricing](https://anam.ai/blog/heygen-pricing) (Drittquellen)

Hinweis: Die HeyGen-Seiten waren aus der Cloud-Umgebung nicht direkt abrufbar (Netzwerkrichtlinie); Angaben stammen aus den indexierten Seiteninhalten und sind vor Aktivierung am Konto zu bestätigen.

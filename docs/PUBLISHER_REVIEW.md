# Multi-Publisher: Prüfbericht (Audit-Umsetzung, Code-Stand 72cc3ab + Branch)

Alle Aussagen beruhen auf Code und Mock-Tests. **Kein echter Plattformzugriff, keine OAuth-Verbindung, kein Post.** „unbestätigt“ = ohne echte Plattformzugänge nicht prüfbar.

| Plattform | Implementiert / Tests | Verbunden? | Zugang fehlt (nachweislich) | Formate |
|---|---|---|---|---|
| Facebook | ja, `meta.ts` + bestehende Produkt-Anbindung; Mock-Tests | Produkt-Pipeline: ja (laut früheren Läufen, hier nicht live geprüft) | Themen-Pipeline: `META_PAGE_ID` nicht in Vercel gelistet [unbestätigt] | Text, Foto, Album, Video |
| Instagram | ja; Mock-Tests (Bild, Karussell, Reel) | Produkt-Pipeline: ja [unbestätigt live] | `META_PAGE_ID`, `META_INSTAGRAM_USER_ID` (Themen) nicht gelistet; Rechte für Karussell/Reel unbestätigt | Bild, Karussell, Reel |
| TikTok | ja; Mock-Tests | nein | `TIKTOK_*` fehlen | Video, Foto-Slideshow |
| YouTube Shorts | ja; Mock-Tests | nein | `YOUTUBE_*` fehlen | Video |
| X | ja; Mock-Tests inkl. OAuth-1.0a-Referenzsignatur | nein | `X_*` fehlen | Bilder (≤ 4), Video, Text |

## Geprüfte Querschnittseigenschaften (bestätigt im Code, durch Tests belegt)
- **Freigabe plattformübergreifend:** `publishAll` → `authorizePublish` je Plattform → `assertPermitMatches` vor dem Netzwerkaufruf. Ohne gültige Freigabe, Live-Schalter, aktive Plattform und Zugangsdaten kein Permit. **Neu:** in Preview/Development kein Permit (`non_production_environment`).
- **Doppelposts:** Einmal-Claim je (Inhalt, Fassung, Plattform) in `publish_attempts` (partieller Unique-Index); „unknown“ wird nie automatisch wiederholt; „processing“ wird nur per `status()` abgeschlossen.
- **Wiederholung:** nur nach eindeutiger Plattformablehnung (`definite`), nur für die betroffene Plattform („Wiederholen“).
- **Isolation:** jede Plattform in eigenem `try/catch`; ein Ausfall stoppt die anderen nicht.
- **Zugangsdaten:** nur Variablennamen in Berichten; Fehlertexte enthalten feste Labels, keine Tokens.
- **Affiliate-Posts** laufen über dieselben Publisher und dieselbe Schranke. **Neu (P-11):** vor dem letzten unumkehrbaren Schritt (Instagram `media_publish`) wird die Freigabe erneut geprüft; der Studio-Pfad `/api/instagram/reel` „publish“ läuft jetzt ebenfalls über die zentrale Schranke (vorher Umgehung).

## Offene Punkte (Code-Befunde, nicht live bestätigt)
1. **TikTok-Refresh-Token-Rotation [wahrscheinlich, P2]:** `tiktokAccessToken()` erneuert pro Aufruf und verwirft ein eventuell zurückgegebenes neues `refresh_token`. Rotiert TikTok den Token, wird der in Vercel hinterlegte irgendwann ungültig. Empfehlung: Token im Betreiber-gesteuerten Speicher aktualisieren (nicht in Jobdaten) — erst nach Live-Test entscheiden.
2. **Statischer `TIKTOK_ACCESS_TOKEN` läuft ab [wahrscheinlich]:** nur die Refresh-Variante ist dauerhaft tragfähig.
3. **TikTok-Audit:** ohne App-Audit nur `SELF_ONLY` (Standard im Code). Verifizierter URL-Prefix für die Blob-Domain nötig (`PULL_FROM_URL`) [unbestätigt].
4. **YouTube:** Standard `privacyStatus=private`; unverifizierte API-Projekte können Uploads auf „privat“ beschränkt bekommen [unbestätigt, Plattformrichtlinie prüfen]. Refresh-Token einer OAuth-App im „Testing“-Status läuft nach 7 Tagen ab [unbestätigt].
5. **X:** Schreibzugriff hängt vom gebuchten API-Tarif ab; Kosten/Limits unbestätigt. Keine neuen Dienste gebucht.
6. **Instagram Reel/Karussell:** Berechtigung `instagram_content_publish` und Bild-/Videoanforderungen (Seitenverhältnis, Länge, Codec) sind im Code geprüft bzw. vorbereitet, aber nicht gegen die echte API [unbestätigt].
7. **Live-Verifikation fehlt für alle Plattformen** (`liveVerified: false` in `lib/capabilities/index.ts`) — jede Plattform braucht einen privaten/unlisted Testpost vor der Aktivierung.

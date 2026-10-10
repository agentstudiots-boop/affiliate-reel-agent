# Rechtliche Seiten (/impressum, /datenschutz)

Beschreiben nur, was der Code tatsächlich tut (Stand 2026-10-10): keine Cookies, kein lokaler Speicher auf den öffentlichen Seiten,
keine Analyse-/Werbe-/Social-Plugins, keine Einbettungen, Schriften lokal (`next/font`), Bilder aus Vercel Blob, anonymer Klickzähler
(`landing_clicks`: Produkt-ID, Inhalts-ID, Zeitpunkt; keine IP). Tests: `tests/legal-pages.test.cjs`.

Die operatorspezifischen Angaben stehen in `lib/landing/legal.ts`. Fehlende Pflichtangaben werden gelb als „ANGABE FEHLT“ markiert,
beide Seiten zeigen einen Entwurfshinweis und sind `noindex`, bis `name`, `street`, `postalCodeCity`, `country` und `email` gesetzt sind.

Zusätzlich im Text als „BITTE BESTÄTIGEN / ANGABE FEHLT“ markiert (Fließtext, ggf. direkt in den Seiten ändern):
Datenschutzbeauftragter nicht erforderlich · AV-Vertrag und Log-Aufbewahrung bei Vercel · zuständige Aufsichtsbehörde ·
Teilnahme an Verbraucherschlichtung (§ 36 VSBG).

Wenn die Website später Dienste hinzufügt (Analyse, Pinterest-Tag, eingebettete Videos, Kontaktformular), muss die Erklärung vorher erweitert werden.
Diese Texte sind keine Rechtsberatung; vor Veröffentlichung juristisch prüfen lassen.

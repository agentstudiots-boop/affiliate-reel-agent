# Rechtliche Seiten (/impressum, /datenschutz)

Beschreiben nur, was der Code tatsächlich tut (Stand 2026-10-10): keine Cookies, kein lokaler Speicher auf den öffentlichen Seiten,
keine Analyse-/Werbe-/Social-Plugins, keine Einbettungen, Schriften lokal (`next/font`), Bilder aus Vercel Blob, anonymer Klickzähler
(`landing_clicks`: Produkt-ID, Inhalts-ID, Zeitpunkt; keine IP). Tests: `tests/legal-pages.test.cjs`.

Die betreiberspezifischen Angaben stehen in `lib/landing/legal.ts`. Eingetragen (2026-10-10): Name, Anschrift, E-Mail, Angebotsname,
Aufsichtsbehörde (TLfDI, aus dem Bundesland der Anschrift abgeleitet – bitte bestätigen).

Offen, bis sie in `legal.ts` gesetzt sind (Seiten bleiben bis dahin Entwurf + `noindex`):
`dpoNotRequired` (Datenschutzbeauftragter nicht erforderlich), `vercelDpaAccepted` (AV-Vertrag Vercel), `consumerArbitration` (`"no"`/`"yes"`).

Rechtlicher Hinweis: Das Gewerbe ist noch nicht angemeldet. Dauerhafte Affiliate-Einnahmen sind in der Regel gewerblich; Gewerbeanmeldung
und Meldung beim Finanzamt (Kleinunternehmerregelung § 19 UStG) sollten vor dem Livegang erfolgen. Der Text nennt deshalb keine Firma
und keinen Kleinunternehmerstatus.

Wenn die Website später Dienste hinzufügt (Analyse, Pinterest-Tag, eingebettete Videos, Kontaktformular), muss die Erklärung vorher erweitert werden.
Diese Texte sind keine Rechtsberatung; vor Veröffentlichung juristisch prüfen lassen.

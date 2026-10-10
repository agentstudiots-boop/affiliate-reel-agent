import type { Metadata } from "next";
import { Address, Field, LegalShell } from "@/app/legal-shell";
import { LEGAL, LEGAL_TEXT_VERSION, legalComplete } from "@/lib/landing/legal";
import styles from "@/app/legal.module.css";

export const metadata: Metadata = {
  title: "Datenschutzerklärung – Alltäglich leichter",
  description: "Informationen zur Verarbeitung personenbezogener Daten auf dieser Website.",
  robots: legalComplete() ? undefined : { index: false, follow: false },
};

// Der Text beschreibt ausschließlich, was der Code dieser Website tatsächlich tut (Stand siehe LEGAL_TEXT_VERSION):
// keine Cookies, kein Tracking, keine Analyse-, Werbe- oder Social-Plugins, keine eingebetteten Fremdinhalte, Schriften
// beim Build lokal eingebunden (next/font), Bilder aus dem eigenen Blob-Speicher, anonymer Klickzähler für Produktlinks.
export default function Page() {
  return (
    <LegalShell title="Datenschutzerklärung" updated={LEGAL_TEXT_VERSION}>
      <p>
        Diese Erklärung informiert darüber, welche personenbezogenen Daten beim Besuch dieser Website (<code>affiliate-reel-agent.vercel.app</code>,
        Angebot „Alltäglich leichter“) verarbeitet werden. Sie gilt für die öffentlichen Seiten (Produktübersicht, Impressum, Datenschutzerklärung).
      </p>

      <h2>1. Verantwortlicher</h2>
      <Address />
      <p>E-Mail: <Field value={LEGAL.email} label="E-Mail-Adresse" /></p>
      <p>
        Ein Datenschutzbeauftragter ist nicht benannt.{" "}
        <mark className={styles.missing}>[BITTE BESTÄTIGEN: Benennung eines Datenschutzbeauftragten ist nach Art. 37 DSGVO / § 38 BDSG nicht erforderlich]</mark>
      </p>

      <h2>2. Überblick</h2>
      <ul>
        <li>Diese Website setzt <strong>keine Cookies</strong> und speichert nichts auf Ihrem Gerät (kein lokaler Speicher auf den öffentlichen Seiten).</li>
        <li>Es gibt <strong>kein Tracking</strong>, keine Webanalyse, keine Werbenetzwerke und keine Social-Media-Plugins.</li>
        <li>Es werden keine Inhalte von YouTube, TikTok, Pinterest, Meta oder anderen Plattformen eingebettet. Es gibt lediglich einfache Links.</li>
        <li>Schriftarten werden beim Bau der Website lokal ausgeliefert; Ihr Browser lädt sie nicht von Google-Servern.</li>
      </ul>

      <h2>3. Hosting und Server-Logfiles (Vercel)</h2>
      <p>
        Die Website wird bei Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA, gehostet (Funktionen in der Region Frankfurt, <code>fra1</code>).
        Beim Aufruf verarbeitet der Hosting-Dienst technisch notwendige Verbindungsdaten, insbesondere IP-Adresse, Datum und Uhrzeit, angeforderte Seite,
        übertragene Datenmenge, Browser- und Betriebssysteminformationen sowie die Referrer-URL, um die Seite auszuliefern, den Betrieb zu sichern und
        Missbrauch abzuwehren.
      </p>
      <p>
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren und stabilen Betrieb). Eine Übermittlung in die USA kann nicht
        ausgeschlossen werden; sie stützt sich auf die vertraglichen Garantien des Anbieters (Standardvertragsklauseln bzw. EU-US Data Privacy Framework).
        <mark className={styles.missing}>[BITTE BESTÄTIGEN: Auftragsverarbeitungsvertrag mit Vercel abgeschlossen und Aufbewahrungsdauer der Logs]</mark>
      </p>
      <p>Die Produktbilder liegen im Speicherdienst „Vercel Blob“ desselben Anbieters; beim Laden der Bilder gelten dieselben Angaben.</p>

      <h2>4. Anonymer Klickzähler für Produktlinks</h2>
      <p>
        Beim Klick auf „Bei Amazon ansehen“ sendet Ihr Browser eine kurze Meldung an diese Website, die ausschließlich zählt, <em>welches Produkt</em> angeklickt wurde.
        Gespeichert werden die interne Produkt-Kennung, die zugehörige Inhalts-Kennung und der Zeitpunkt des Klicks in einer Datenbank (Postgres, Neon). Es werden
        <strong> keine IP-Adresse, keine Cookies, keine Gerätekennung und kein Nutzerprofil</strong> gespeichert; ein Bezug zu Ihrer Person wird nicht hergestellt.
        Die Zählung dient der Auswertung, welche Empfehlungen interessieren (Art. 6 Abs. 1 lit. f DSGVO). Auch hier können technisch bedingt die unter Punkt 3 genannten Server-Verbindungsdaten anfallen.
      </p>

      <h2>5. Affiliate-Links (Amazon-Partnerprogramm)</h2>
      <p>
        Die Produktlinks führen zu Amazon und sind Affiliate-Links (Werbung, <code>rel=&quot;sponsored&quot;</code>). Sie öffnen in einem neuen Tab. Erst mit dem Klick verlassen Sie diese Website; ab
        dann verarbeitet Amazon Ihre Daten in eigener Verantwortung nach seiner Datenschutzerklärung, einschließlich der Zuordnung des Partner-Links für die Provision. Diese Website hat
        darauf keinen Einfluss und erhält von Amazon keine personenbezogenen Daten über Ihren Einkauf, sondern nur aggregierte Partnerberichte.
      </p>
      <p>Als Amazon-Partner verdient der Anbieter an qualifizierten Verkäufen.</p>

      <h2>6. Links zu sozialen Netzwerken</h2>
      <p>
        Die Website enthält einen einfachen Link zum Instagram-Profil (Meta). Es wird kein Plugin geladen; Daten werden erst übertragen, wenn Sie den Link anklicken, und dann vom jeweiligen
        Anbieter in eigener Verantwortung verarbeitet. Weitere Plattformen (YouTube, TikTok, Pinterest, Facebook, X) sind auf dieser Website weder eingebunden noch verlinkt.
      </p>
      <p>
        Der Anbieter betreibt eigene Profile bzw. Konten bei sozialen Netzwerken, um Inhalte zu veröffentlichen. Für die Verarbeitung auf diesen Plattformen gelten die Datenschutzhinweise der jeweiligen Plattform.
        Über die Programmierschnittstellen (APIs) dieser Plattformen veröffentlicht der Anbieter eigene Inhalte; Daten von Besuchern dieser Website werden dabei nicht an die Plattformen übertragen.
      </p>

      <h2>7. Kontaktaufnahme</h2>
      <p>
        Wenn Sie per E-Mail Kontakt aufnehmen, verarbeiten wir Ihre Angaben zur Bearbeitung der Anfrage (Art. 6 Abs. 1 lit. b oder f DSGVO) und löschen sie, sobald sie nicht mehr erforderlich sind und keine
        Aufbewahrungspflichten entgegenstehen. Es gibt kein Kontaktformular.
      </p>

      <h2>8. Empfänger</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Empfänger</th><th>Zweck</th><th>Daten</th></tr></thead>
          <tbody>
            <tr><td>Vercel Inc. (USA) – Hosting, Blob-Speicher</td><td>Auslieferung der Website und Bilder</td><td>Verbindungsdaten (IP-Adresse, Zeit, Browser)</td></tr>
            <tr><td>Neon Inc. (USA) – Datenbank, über Vercel eingebunden</td><td>Anzeige veröffentlichter Produkte, Klickzähler</td><td>Produkt-/Inhalts-Kennung, Zeitpunkt; keine Besucherdaten</td></tr>
            <tr><td>Amazon (nach Klick, eigene Verantwortung)</td><td>Produktseite, Partnerprogramm</td><td>nach Datenschutzerklärung von Amazon</td></tr>
            <tr><td>Meta / Instagram (nach Klick, eigene Verantwortung)</td><td>Profil-Link</td><td>nach Datenschutzerklärung von Meta</td></tr>
          </tbody>
        </table>
      </div>

      <h2>9. Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen
        auf Grundlage berechtigter Interessen (Art. 21). Wenden Sie sich dazu an die oben genannte E-Mail-Adresse. Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO),
        insbesondere in dem Land Ihres Wohnsitzes oder des Sitzes des Verantwortlichen.
      </p>
      <p><mark className={styles.missing}>[ANGABE FEHLT: zuständige Datenschutz-Aufsichtsbehörde (Bundesland des Anbieters)]</mark></p>

      <h2>10. Pflicht zur Bereitstellung, automatisierte Entscheidungen</h2>
      <p>Sie sind nicht verpflichtet, personenbezogene Daten bereitzustellen; ohne die technischen Verbindungsdaten kann die Website jedoch nicht angezeigt werden. Eine automatisierte Entscheidungsfindung einschließlich Profiling findet nicht statt.</p>

      <h2>11. Änderungen</h2>
      <p>Diese Erklärung wird angepasst, wenn sich die Website oder die eingesetzten Dienste ändern. Maßgeblich ist die hier veröffentlichte Fassung.</p>
    </LegalShell>
  );
}

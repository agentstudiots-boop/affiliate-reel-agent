import type { Metadata } from "next";
import { Address, Field, LegalShell } from "@/app/legal-shell";
import { LEGAL, LEGAL_TEXT_VERSION, legalComplete } from "@/lib/landing/legal";

export const metadata: Metadata = {
  title: "Impressum – Alltäglich leichter",
  description: "Anbieterkennzeichnung nach § 5 DDG.",
  robots: legalComplete() ? undefined : { index: false, follow: false },
};

export default function Page() {
  return (
    <LegalShell title="Impressum" updated={LEGAL_TEXT_VERSION}>
      <h2>Angaben gemäß § 5 DDG</h2>
      <Address />

      <h2>Kontakt</h2>
      <p>E-Mail: <Field value={LEGAL.email} label="E-Mail-Adresse" /></p>
      {LEGAL.phone && <p>Telefon: {LEGAL.phone}</p>}

      {LEGAL.vatId && <><h2>Umsatzsteuer-ID</h2><p>Umsatzsteuer-Identifikationsnummer nach § 27a UStG: {LEGAL.vatId}</p></>}

      {LEGAL.contentResponsible && <><h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2><p>{LEGAL.contentResponsible}</p></>}

      <h2>Hinweis zu Affiliate-Links (Werbung)</h2>
      <p>
        Die Links „Bei Amazon ansehen“ sind Affiliate-Links und als Werbung zu verstehen. Bei qualifizierten Käufen kann der Anbieter eine
        Provision erhalten; für Käufer entstehen dadurch keine Mehrkosten. Als Amazon-Partner verdient der Anbieter an qualifizierten Verkäufen.
      </p>

      <h2>Haftung für Links</h2>
      <p>
        Diese Website enthält Links auf externe Websites Dritter (insbesondere Amazon und Instagram), auf deren Inhalte der Anbieter keinen Einfluss hat.
        Für diese fremden Inhalte ist stets der jeweilige Anbieter verantwortlich. Bei Bekanntwerden von Rechtsverletzungen werden solche Links umgehend entfernt.
      </p>

      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        {/* Rechtliche Angabe zur Teilnahmebereitschaft: nicht vom Betreiber bestätigt, deshalb nicht vorformuliert. */}
        <mark style={{ background: "#ffe08a", padding: "1px 6px", borderRadius: 6, fontWeight: 600 }}>[ANGABE FEHLT: Bereitschaft oder Verpflichtung zur Teilnahme an Verbraucherschlichtungsverfahren (§ 36 VSBG) – bitte entscheiden und mitteilen]</mark>
      </p>
    </LegalShell>
  );
}

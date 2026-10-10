import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Impressum | Alltäglich leichter", robots: { index: false, follow: false } };

export default function Impressum() {
  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",lineHeight:1.7}}>
    <Link href="/produkte">← Zurück zu den Empfehlungen</Link>
    <h1>Impressum</h1>
    <p><strong>Entwurf – vor Veröffentlichung vervollständigen und rechtlich prüfen.</strong></p>
    <h2>Angaben gemäß § 5 DDG</h2>
    <p>[Vollständiger Name des Diensteanbieters]<br/>[Ladungsfähige Anschrift; kein Postfach]<br/>[Kontakt-E-Mail und weiterer Kommunikationsweg]</p>
    <p>[Gegebenenfalls weitere gesetzlich erforderliche Angaben wie USt-IdNr./W-IdNr.; keine private Steuernummer veröffentlichen]</p>
    <p>Dieser Entwurf ist keine vollständige Anbieterkennzeichnung und darf so nicht als final veröffentlicht werden.</p>
  </main>;
}

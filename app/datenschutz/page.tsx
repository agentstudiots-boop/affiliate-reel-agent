import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Datenschutz | Alltäglich leichter", robots: { index: false, follow: false } };

export default function Datenschutz() {
  return <main style={{maxWidth:760,margin:"0 auto",padding:"48px 20px",lineHeight:1.7}}>
    <Link href="/produkte">← Zurück zu den Empfehlungen</Link>
    <h1>Datenschutzerklärung</h1>
    <p><strong>Entwurf – nicht für die Pinterest-App-Freigabe oder den öffentlichen Geschäftsbetrieb verwenden, bevor die Angaben geprüft und ergänzt wurden.</strong></p>
    <h2>Verantwortlicher</h2>
    <p>Thorsten Seyß<br/>Rathausstraße 19<br/>98544 Zella-Mehlis<br/>Deutschland<br/><a href="mailto:agentstudio.ts@gmail.com">agentstudio.ts@gmail.com</a></p>
    <h2>Hosting und technische Zugriffsdaten</h2>
    <p>[Verarbeitung durch Vercel, Logdaten, Rechtsgrundlage, Auftragsverarbeitung, Empfänger, Drittlandtransfer, Aufbewahrungsdauer anhand der tatsächlichen Konfiguration prüfen und konkret angeben.]</p>
    <h2>Externe Links und Affiliate-Marketing</h2>
    <p>Auf der Produktübersicht können Links zu externen Produktseiten führen. [Konkrete Affiliate-Partner, mögliche Tracking- und Provisionszuordnung, Rechtsgrundlage und Empfänger verifizieren und erläutern.]</p>
    <h2>Cookies, lokale Speicherung und Analyse</h2>
    <p>[Tatsächlich genutzte Cookies, Local Storage, Tracking- und Analysedienste prüfen. Falls einwilligungspflichtige Technik genutzt wird, Einwilligungsmechanismus ergänzen.]</p>
    <h2>Rechte betroffener Personen</h2>
    <p>Betroffene können nach Maßgabe der DSGVO unter anderem Auskunft, Berichtigung, Löschung, Einschränkung und Datenübertragbarkeit verlangen sowie unter den gesetzlichen Voraussetzungen widersprechen oder eine Einwilligung widerrufen. Es besteht außerdem ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.</p>
    <h2>Offene Pflichtangaben</h2>
    <p>[Zwecke, Rechtsgrundlagen, Datenkategorien, Empfänger, internationale Übermittlungen, Speicherdauer, Kontakt und zuständige Aufsichtsbehörde konkretisieren.]</p>
  </main>;
}

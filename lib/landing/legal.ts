// Angaben des Anbieters für Impressum (§ 5 DDG) und Datenschutzerklärung (Art. 13 DSGVO).
// Nichts hier ist erfunden: Felder, die der Betreiber noch nicht geliefert hat, sind null und werden auf den Seiten
// als „ANGABE FEHLT“ markiert. Solange Pflichtangaben fehlen, tragen beide Seiten einen Entwurfshinweis und `noindex`.
export type LegalProfile = {
  /** Vollständiger Name bzw. Firma (Pflicht). */
  name: string | null;
  /** Rechtsform, z. B. bei Unternehmen (nur falls zutreffend). */
  legalForm: string | null;
  /** Ladungsfähige Anschrift, kein Postfach (Pflicht). */
  street: string | null;
  postalCodeCity: string | null;
  country: string | null;
  /** E-Mail für schnelle elektronische Kontaktaufnahme (Pflicht). */
  email: string | null;
  /** Optional, nur wenn der Betreiber sie nennen möchte. */
  phone: string | null;
  /** Umsatzsteuer-Identifikationsnummer nach § 27a UStG, nur falls vorhanden. */
  vatId: string | null;
  /** Verantwortlich für Inhalte nach § 18 Abs. 2 MStV, falls abweichend vom Anbieter. */
  contentResponsible: string | null;
  /** Name des Angebots (keine Firma), wird unter dem Anbieternamen genannt. */
  offerName: string | null;
  /** Zuständige Datenschutz-Aufsichtsbehörde (Bundesland des Verantwortlichen). */
  supervisoryAuthority: string | null;
  /** Betreiber bestätigt: kein Datenschutzbeauftragter benannt und nicht erforderlich. */
  dpoNotRequired: boolean | null;
  /** Betreiber bestätigt: Auftragsverarbeitungsvertrag mit Vercel akzeptiert. */
  vercelDpaAccepted: boolean | null;
  /** Verbraucherschlichtung nach § 36 VSBG: Betreiber entscheidet ("no" = keine Teilnahme, "yes" = Teilnahme, Stelle muss genannt werden). */
  consumerArbitration: "no" | "yes" | null;
};

export const LEGAL: LegalProfile = {
  name: "Thorsten Seyß",
  legalForm: null,
  street: "Rathausstr. 19",
  postalCodeCity: "98544 Zella-Mehlis",
  country: "Deutschland",
  email: "agentstudio.ts@gmail.com",
  offerName: "Alltäglich leichter",
  supervisoryAuthority: "Der Thüringer Landesbeauftragte für den Datenschutz und die Informationsfreiheit (TLfDI), Erfurt",
  dpoNotRequired: null,
  vercelDpaAccepted: null,
  consumerArbitration: null,
  phone: null,
  vatId: null,
  contentResponsible: null,
};

export const LEGAL_REQUIRED: { key: keyof LegalProfile; label: string }[] = [
  { key: "name", label: "Vollständiger Name bzw. Firma" },
  { key: "street", label: "Straße und Hausnummer (ladungsfähige Anschrift)" },
  { key: "postalCodeCity", label: "Postleitzahl und Ort" },
  { key: "country", label: "Land" },
  { key: "email", label: "E-Mail-Adresse" },
  { key: "supervisoryAuthority", label: "Zuständige Datenschutz-Aufsichtsbehörde" },
  { key: "dpoNotRequired", label: "Bestätigung: Datenschutzbeauftragter nicht erforderlich" },
  { key: "vercelDpaAccepted", label: "Bestätigung: Auftragsverarbeitungsvertrag mit Vercel" },
  { key: "consumerArbitration", label: "Entscheidung zur Verbraucherschlichtung (§ 36 VSBG)" },
];

const filled = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
export function missingLegalFields(profile: LegalProfile = LEGAL) {
  return LEGAL_REQUIRED.filter(item => !filled(profile[item.key]));
}
export const legalComplete = (profile: LegalProfile = LEGAL) => missingLegalFields(profile).length === 0;

// Stand des Textes, nicht der Angaben.
export const LEGAL_TEXT_VERSION = "2026-10-10";

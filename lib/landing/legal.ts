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
};

export const LEGAL: LegalProfile = {
  name: null,
  legalForm: null,
  street: null,
  postalCodeCity: null,
  country: null,
  email: null,
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
];

export function missingLegalFields(profile: LegalProfile = LEGAL) {
  return LEGAL_REQUIRED.filter(item => !profile[item.key]?.trim());
}
export const legalComplete = (profile: LegalProfile = LEGAL) => missingLegalFields(profile).length === 0;

// Stand des Textes, nicht der Angaben.
export const LEGAL_TEXT_VERSION = "2026-10-10";

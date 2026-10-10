import type { ReactNode } from "react";
import { BRAND } from "@/lib/landing/brand";
import { LEGAL, legalComplete, missingLegalFields, type LegalProfile } from "@/lib/landing/legal";
import styles from "./legal.module.css";

// Marks a value that the operator still has to provide. Never renders an invented value.
export function Field({ value, label }: { value: string | null | undefined; label: string }) {
  return value?.trim() ? <>{value}</> : <mark className={styles.missing}>[ANGABE FEHLT: {label}]</mark>;
}

export function Address({ profile = LEGAL }: { profile?: LegalProfile }) {
  return <address className={styles.address}>
    <Field value={profile.name} label="Name bzw. Firma" />{profile.legalForm ? <>, {profile.legalForm}</> : null}<br />
    <Field value={profile.street} label="Straße und Hausnummer" /><br />
    <Field value={profile.postalCodeCity} label="PLZ und Ort" /><br />
    <Field value={profile.country} label="Land" />
  </address>;
}

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const missing = missingLegalFields();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/produkte" aria-label={`${BRAND.name} – zur Startseite`}>{BRAND.name}</a>
        <nav aria-label="Rechtliches"><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a></nav>
      </header>
      <main className={styles.main}>
        {!legalComplete() && <aside className={styles.draft} role="note" aria-label="Entwurfshinweis">
          <strong>Entwurf – nicht zur Veröffentlichung freigegeben.</strong> Folgende Pflichtangaben des Anbieters fehlen noch:
          <ul>{missing.map(item => <li key={item.key}>{item.label}</li>)}</ul>
          Diese Seite ist erst vollständig, wenn die Angaben eingetragen sind (<code>lib/landing/legal.ts</code>).
        </aside>}
        <h1>{title}</h1>
        <p className={styles.updated}>Stand des Textes: {updated}</p>
        {children}
      </main>
      <footer className={styles.footer}>
        <a href="/produkte">Zur Produktübersicht</a>
        <a href="/impressum">Impressum</a>
        <a href="/datenschutz">Datenschutz</a>
      </footer>
    </div>
  );
}

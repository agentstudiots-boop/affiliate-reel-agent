import { BRAND } from "@/lib/landing/brand";
import type { loadPublishedProducts } from "@/lib/landing/published";
import { TrackedLink } from "./track-link";
import styles from "./landing.module.css";

const dateFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "long", year: "numeric" });

// Presentation only: it renders what the database query returned and nothing else.
export function LandingView({ data, wanted }: { data: Awaited<ReturnType<typeof loadPublishedProducts>> | null; wanted: string | null }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/produkte" aria-label={`${BRAND.name} – zur Startseite`}>
          {BRAND.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={BRAND.logoUrl} alt={BRAND.name} className={styles.logo} />
            : <span className={styles.wordmark}>{BRAND.name}</span>}
        </a>
        <nav className={styles.nav} aria-label="Hauptnavigation">
          <a href="#empfehlungen">Produkte</a>
          <a href="#affiliate-hinweis">Affiliate-Hinweis</a>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroInner}>
        <h1>Produkte, die den Alltag einfacher machen</h1>
        <p>Praktische Empfehlungen für ein leichteres, entspannteres Zuhause.</p>
        <p className={styles.notice}>Anzeige: Die Produktlinks sind Affiliate-Links, bei qualifizierten Käufen kann eine Provision entstehen. <a href="#affiliate-hinweis">Mehr dazu</a></p>
        </div>
      </section>

      <main className={styles.main} id="empfehlungen">
        {!data ? <p className={styles.empty}>Die Übersicht ist gerade nicht verfügbar. Bitte später noch einmal versuchen.</p> : <>
          {data.categories.length > 1 && (
            <nav className={styles.chips} aria-label="Kategorien">
              <a href="/produkte" aria-current={wanted ? undefined : "page"}>Alle</a>
              {data.categories.map(category => (
                <a key={category.value} href={`/produkte?kategorie=${category.value}`} aria-current={wanted === category.value ? "page" : undefined}>{category.label}</a>
              ))}
            </nav>
          )}
          <div className={styles.sectionHead}>
            <h2>Neueste Empfehlungen</h2>
            <span>Die aktuellsten Produkte zuerst</span>
          </div>
          {data.items.length === 0 ? <p className={styles.empty}>Noch keine veröffentlichten Produkte{wanted ? " in dieser Kategorie" : ""}.</p> : (
            <ul className={styles.grid}>
              {data.items.map(item => (
                <li key={item.id} className={styles.card}>
                  <div className={styles.media}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.imageUrl} alt={item.name} loading="lazy" />
                    <span className={styles.tag}>{item.categoryLabel}</span>
                  </div>
                  <div className={styles.body}>
                    <h3>{item.name}</h3>
                    {item.excerpt && <p>{item.excerpt}</p>}
                    <time dateTime={item.publishedAt}>{dateFormat.format(new Date(item.publishedAt))}</time>
                    <TrackedLink id={item.id} href={item.affiliateUrl} className={styles.button}>Produkt ansehen <span aria-hidden="true">→</span></TrackedLink>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <span className={styles.footerBrand}>{BRAND.name}</span>
          <nav aria-label="Rechtliches">
            {BRAND.imprintUrl && <a href={BRAND.imprintUrl}>Impressum</a>}
            {BRAND.privacyUrl && <a href={BRAND.privacyUrl}>Datenschutz</a>}
            <a href="#affiliate-hinweis">Affiliate-Hinweis</a>
            <a href={`https://www.instagram.com/${BRAND.instagramUsername}/`} rel="noopener noreferrer">Instagram</a>
          </nav>
        </div>
        <p id="affiliate-hinweis" className={styles.disclosure}>
          <strong>Affiliate-Hinweis:</strong> Die Links zu „Produkt ansehen“ sind Affiliate-Links (Werbung). Wenn du über einen solchen Link etwas kaufst, kann ich eine Provision erhalten.
          Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.
        </p>
      </footer>
    </div>
  );
}

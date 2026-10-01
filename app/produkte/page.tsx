import type { Metadata } from "next";
import { getDatabase } from "@/lib/memory/db";
import { loadPublishedProducts } from "@/lib/landing/published";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Empfehlungen",
  description: "Veröffentlichte Produktempfehlungen, neueste zuerst.",
};
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "long", year: "numeric" });

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const selected = (await searchParams).kategorie;
  const wanted = typeof selected === "string" && /^[a-z_]{3,30}$/.test(selected) ? selected : null;
  let data: Awaited<ReturnType<typeof loadPublishedProducts>> | null = null;
  try { data = await loadPublishedProducts(getDatabase(), wanted); }
  catch { console.error(JSON.stringify({ event: "landing_unavailable" })); }
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1>Empfehlungen</h1>
        <p>Veröffentlichte Produkte, die neuesten zuerst.</p>
      </header>
      {!data ? <p className={styles.note}>Die Übersicht ist gerade nicht verfügbar. Bitte später noch einmal versuchen.</p> : <>
        {data.categories.length > 1 && (
          <nav className={styles.filter} aria-label="Kategorien">
            <a href="/produkte" aria-current={wanted ? undefined : "page"}>Alle</a>
            {data.categories.map(category => (
              <a key={category.value} href={`/produkte?kategorie=${category.value}`} aria-current={wanted === category.value ? "page" : undefined}>{category.label}</a>
            ))}
          </nav>
        )}
        {data.items.length === 0 ? <p className={styles.note}>Noch keine veröffentlichten Produkte{wanted ? " in dieser Kategorie" : ""}.</p> : (
          <ul className={styles.list}>
            {data.items.map(item => (
              <li key={item.id} className={styles.card}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={item.name} loading="lazy" className={styles.image} />
                <div className={styles.body}>
                  <h2>{item.name}</h2>
                  <p className={styles.meta}>{item.categoryLabel} · {dateFormat.format(new Date(item.publishedAt))}</p>
                  <p className={styles.caption}>{item.caption}</p>
                  <a className={styles.button} href={item.affiliateUrl} target="_blank" rel="sponsored noopener noreferrer">Produkt ansehen</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </>}
      <footer className={styles.foot}>Werbung: Die Produktlinks sind Affiliate-Links. Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.</footer>
    </main>
  );
}

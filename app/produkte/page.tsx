import type { Metadata } from "next";
import { getDatabase } from "@/lib/memory/db";
import { loadPublishedProducts } from "@/lib/landing/published";
import { BRAND } from "@/lib/landing/brand";
import { LandingView } from "./landing-view";

export const metadata: Metadata = {
  title: `${BRAND.name} – Empfehlungen`,
  description: "Veröffentlichte Produktempfehlungen, die neuesten zuerst.",
};
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const selected = (await searchParams).kategorie;
  const wanted = typeof selected === "string" && /^[a-z_]{3,30}$/.test(selected) ? selected : null;
  let data: Awaited<ReturnType<typeof loadPublishedProducts>> | null = null;
  try { data = await loadPublishedProducts(getDatabase(), wanted); }
  catch { console.error(JSON.stringify({ event: "landing_unavailable" })); }
  return <LandingView data={data} wanted={wanted} />;
}

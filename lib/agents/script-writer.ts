import type { Product, ReelConcept } from "@/lib/types";

export function writeReelConcept(product: Product): ReelConcept {
  const benefits = product.benefits.split(/[;\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 2);
  const firstBenefit = benefits[0] || "die auf der Produktseite beschriebenen Funktionen";
  const secondBenefit = benefits[1] || "Handhabung und Lieferumfang";
  const safeName = product.name.trim();
  return {
    hook: `Kann ${safeName} diesen Alltagsschritt einfacher machen?`,
    scenes: [
      { seconds: "0–4", visual: "Alltagsproblem in einer klaren Nahaufnahme zeigen.", voiceover: `Kennst du dieses Problem? Heute schauen wir uns ${safeName} genauer an.`, overlay: "Praktische Produktidee" },
      { seconds: "4–11", visual: "Produkt und Lieferumfang neutral zeigen.", voiceover: `Laut Produktbeschreibung geht es unter anderem um ${firstBenefit}.`, overlay: "Angaben des Anbieters" },
      { seconds: "11–20", visual: "Anwendung ohne erfundene Ergebnisse demonstrieren.", voiceover: `Vor dem Kauf solltest du besonders ${secondBenefit} sowie die aktuellen Angaben prüfen.`, overlay: "Details vor Kauf prüfen" },
      { seconds: "20–28", visual: "Produkt, Verpackung und Hinweis auf den Link zeigen.", voiceover: "Die aktuellen Produktinformationen findest du über den gekennzeichneten Link.", overlay: "Werbung · Affiliate-Link" },
    ],
    caption: `Werbung | Produktidee: ${safeName}. Eigenschaften, Preis und Verfügbarkeit bitte direkt auf der verlinkten Produktseite prüfen. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten; für dich ändert sich der Preis dadurch nicht.`,
    hashtags: ["#werbung", "#affiliatelink", "#produktidee", "#alltag", "#amazonfinds"],
    cta: "Aktuelle Details über den gekennzeichneten Link ansehen.",
    disclosure: "Werbung | Affiliate-Link",
    checks: ["Produktname, Preis, Verfügbarkeit und Lieferumfang aktuell prüfen.", "Nur Eigenschaften nennen, die auf der konkreten Produktseite belegt sind.", "Keine eigene Nutzung, Tests, Bewertungen oder Verkaufserfolge behaupten.", "Werbekennzeichnung im Reel und in der Caption sichtbar platzieren."],
  };
}

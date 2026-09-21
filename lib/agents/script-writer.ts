import type { Product, ReelConcept } from "@/lib/types";

export function writeReelConcept(product: Product): ReelConcept {
  // Editorial policy: docs/SCRIPT_WRITER_MANIFEST.md. This is a curated
  // product-family example, not an LLM or verification of a specific model.
  if (/vakuumier(?:er|gerät|geraet)|vakuum[- ]?versiegler/i.test(product.name)) {
    return vacuumSealerConcept(product);
  }
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

function vacuumSealerConcept(product: Product): ReelConcept {
  const searchSelection = (() => {
    try { return new URL(product.sourceUrl).pathname === "/s"; } catch { return false; }
  })();
  const cta = searchSelection
    ? "Passende Vakuumierer findest du in der verlinkten Auswahl."
    : "Prüfe beim verlinkten Modell, welche Lebensmittel und Beutel geeignet sind.";
  return {
    hook: "Ein Einkauf, mehrere Mahlzeiten: Portionen schon heute vorbereiten.",
    scenes: [
      { seconds: "0–5", visual: "Auf einer sauberen Küchenarbeitsfläche einen Lebensmitteleinkauf in einzelne Mahlzeiten-Portionen aufteilen.", voiceover: "Ein größerer Einkauf? Teile ihn gleich in die Portionen auf, die du später brauchst.", overlay: "Ein Einkauf · mehrere Portionen" },
      { seconds: "5–11", visual: "Eine passende Portion in einen geeigneten Beutel geben und mit einem Vakuumierer verschließen. Keine Flüssigkeitsverarbeitung oder erfundenen Bedienelemente zeigen.", voiceover: "Vakuumieren kann bei geeigneten Lebensmitteln und richtiger Lagerung die Haltbarkeit verlängern.", overlay: "Haltbarkeit abhängig von Lebensmittel und Lagerung" },
      { seconds: "11–17", visual: "Verschlossene, mit Inhalt und Datum beschriftete Portionen direkt ins Gefrierfach legen.", voiceover: "Beschriften und passend kühlen oder einfrieren: So liegen deine Portionen für später bereit.", overlay: "Portionieren · beschriften · passend lagern" },
      { seconds: "17–24", visual: "Eine separate Portion in einem geeigneten Sous-vide-Beutel in ein Wasserbad mit sichtbar separatem Sous-vide-Gerät geben. Keine Garzeit oder Temperatur erfinden.", voiceover: "Und mit geeigneten Beuteln bereitest du Sous-vide vor. Zum Garen brauchst du zusätzlich ein temperiertes Wasserbad.", overlay: "Sous-vide: geeignete Beutel + zusätzliches Gerät" },
      { seconds: "24–29", visual: "Übersicht der vorbereiteten Portionen und des Vakuumierers. Werbekennzeichnung und Hinweis auf die Auswahl erst im Videoschnitt ergänzen.", voiceover: cta, overlay: "Werbung · Affiliate-Link" },
    ],
    caption: `Werbung | Portionen vorbereiten, Vorräte aufbewahren und Sous-vide vorbereiten: drei mögliche Anwendungen eines Lebensmittel-Vakuumierers. Vakuumieren kann die Haltbarkeit geeigneter Lebensmittel bei korrekter Lagerung verlängern, ersetzt aber weder Kühlung noch Hygiene. Für Sous-vide sind geeignete, temperaturbeständige Beutel und ein zusätzliches Gerät für das Wasserbad nötig. Welche Anwendungen ${product.name} tatsächlich unterstützt, bitte am konkreten Modell prüfen. ${cta} Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`,
    hashtags: ["#werbung", "#vakuumieren", "#mealprep", "#sousvide", "#küchenhelfer"],
    cta,
    disclosure: "Werbung | Affiliate-Link",
    checks: [
      "Modell, Herstellerhinweise und Nutzereinschränkungen mit allen gezeigten Anwendungen abgleichen; ungeeignete Szenen entfernen.",
      `Zusätzliche Hinweise aus der Produktauswahl: ${product.notes || "Keine angegeben."}`,
      "Keine bestimmte Haltbarkeitsdauer versprechen. Lebensmittelgerecht kühlen oder einfrieren; Vakuumieren ersetzt keine Hygiene.",
      "Sous-vide-Eignung der Beutel prüfen; zusätzliches Gar-Gerät sichtbar von der Vakuumierfunktion unterscheiden.",
      "Bei einer Suchauswahl keine unbestätigten Funktionen eines einzelnen Modells versprechen.",
      "Sprechertext, Werbekennzeichnung und Einblendungen vor Veröffentlichung ergänzen: der 10-Sekunden-Runway-Clip allein setzt dieses Drehbuch nicht vollständig um.",
    ],
  };
}

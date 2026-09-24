import type { Opportunity } from "./schema";

export type ProductSourceKind = "product" | "search" | "category" | "unknown";

export type ProductInspiration = {
  sourceKind: ProductSourceKind;
  editorialMode: "product" | "category";
  representation: "generic_category" | "verified_product_context";
  categoryLabel: string;
  visualDirections: string[];
  purchaseCriteria: string[];
  useCases: string[];
  allowedClaims: string[];
  prohibitedClaims: string[];
  sourceSummary: string;
};

function classifySource(url: URL): ProductSourceKind {
  const path = url.pathname.toLowerCase();
  if (path === "/s" || path.startsWith("/s/") || url.searchParams.has("k") || /\/search(?:\/|$)/.test(path)) return "search";
  if (/\/(?:dp|gp\/product)\/[a-z0-9]{10}(?:\/|$)/i.test(url.pathname)) return "product";
  if (/\/(?:b|stores|gp\/bestsellers)(?:\/|$)/.test(path)) return "category";
  return "unknown";
}

function preset(name: string, useCase: string, category: Opportunity["category"]) {
  const value = `${name} ${useCase}`.toLocaleLowerCase("de-DE");
  if (/kuscheldecke|wohndecke|fleecedecke|decke/.test(value)) {
    return {
      categoryLabel: "Kuscheldecke",
      visualDirections: [
        "Gemütliche Wohnzimmerszene mit neutraler, unmarkierter Decke auf einem Sofa und warmem Abendlicht.",
        "Redaktionelle Detailansicht einer neutralen Textiloberfläche ohne Markenlogo oder konkrete Modellmerkmale.",
        "Ruhiger Vergleichsaufbau für Material, Größe und Pflege mit eigenständigen Illustrationen statt Händlerbildern.",
      ],
      purchaseCriteria: ["Material", "Größe", "Pflegehinweise"],
      useCases: ["Sofa am Herbst- oder Winterabend", "Decke für Bett oder Leseecke", "Alltagstauglichkeit und Pflege vergleichen"],
    };
  }
  if (/vakuumier|vakuum.?versiegl/.test(value)) {
    return {
      categoryLabel: "Vakuumierer",
      visualDirections: [
        "Saubere Küchenarbeitsfläche mit vorbereiteten Lebensmittelportionen und neutral dargestelltem Vakuumiergerät.",
        "Konkrete Anwendungsszene beim Portionieren, Verschließen und Beschriften ohne Markenlogo oder exakte Modellnachbildung.",
        "Redaktioneller Vergleichsaufbau für Beutel-Kompatibilität, Platzbedarf und Herstellerhinweise.",
      ],
      purchaseCriteria: ["Beutel-Kompatibilität", "Platzbedarf", "Herstellerhinweise zur vorgesehenen Anwendung"],
      useCases: ["Portionen vorbereiten", "Lebensmittel passend lagern", "Sous-vide nur mit separatem Garer als zusätzlichem Anwendungskontext"],
    };
  }
  const criteria = category === "technology"
    ? ["Kompatibilität", "Abmessungen", "Herstellerangaben"]
    : category === "kitchen"
      ? ["Eignung für den Anwendungsfall", "Zubehör", "Pflege und Herstellerhinweise"]
      : ["Eignung für den Alltag", "Größe oder Ausführung", "Pflege und Herstellerhinweise"];
  return {
    categoryLabel: name,
    visualDirections: [
      `Konkrete Alltagsszene für: ${useCase}`,
      `Neutrale, markenfreie Darstellung der Produktkategorie ${name} in sinnvoller Anwendung.`,
      "Redaktioneller Vergleichsaufbau mit eigenständigen Illustrationen und ausreichend Bildanteil.",
    ],
    purchaseCriteria: criteria,
    useCases: [useCase, "Anwendungsvoraussetzungen sichtbar machen", "Vor dem Kauf Herstellerangaben vergleichen"],
  };
}

export function analyzeProductInspiration(opportunity: Opportunity): ProductInspiration {
  const url = new URL(opportunity.product.sourceUrl);
  const sourceKind = classifySource(url);
  const signals = preset(opportunity.product.name, opportunity.useCase, opportunity.category);
  const categoryMode = sourceKind !== "product";
  const verified = opportunity.verifiedFacts.map(item => item.claim.trim()).filter(Boolean);
  const verifiedProductContext = sourceKind === "product" && verified.length > 0;

  return {
    sourceKind,
    editorialMode: categoryMode ? "category" : "product",
    representation: verifiedProductContext ? "verified_product_context" : "generic_category",
    categoryLabel: signals.categoryLabel,
    visualDirections: signals.visualDirections,
    purchaseCriteria: signals.purchaseCriteria,
    useCases: signals.useCases,
    allowedClaims: verifiedProductContext ? verified : [],
    prohibitedClaims: [
      "Keine Händler- oder Amazon-Bilder kopieren.",
      "Keine Logos, Shop-Oberflächen oder geschützten Layouts nachbauen.",
      "Keine exakte Modellabbildung vortäuschen, wenn dafür keine freigegebene Referenz vorliegt.",
      "Keine Tests, Preise, Garantien oder Produkteigenschaften erfinden.",
      categoryMode ? "Aus der Auswahlseite kein einzelnes konkretes Modell ableiten." : "Unbelegte Modellmerkmale nicht als Tatsache darstellen.",
    ],
    sourceSummary: categoryMode
      ? `${sourceKind === "search" ? "Such-/Auswahlseite" : "Kategorie-/Auswahlkontext"}: redaktionell auf die Produktkategorie ${signals.categoryLabel} beziehen; kein einzelnes Modell behaupten.`
      : verifiedProductContext
        ? `Einzelproduktseite: nur die ${verified.length} separat verifizierten Fakten als konkrete Produkteigenschaften verwenden.`
        : "Einzelproduktseite ohne verifizierte Modellfakten: nur kategorische Anwendungssignale verwenden und keine konkrete Modellabbildung vortäuschen.",
  };
}

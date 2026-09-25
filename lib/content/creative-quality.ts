import type { Content } from "./schema";

export type CreativeQualityResult = {
  passed: boolean;
  score: number;
  issues: string[];
};

type ImageContent = Extract<Content, { format: "image" }>;

const fallbackPattern = /symbolgrafik|textkarte|reine(?:r|s)?\s+text|nur\s+typografie|typografische\s+karte|platzhalter|fallback[-\s]?grafik/i;
const copiedCommercePattern = /amazon[-\s]?(?:ui|screenshot|bild)|händler[-\s]?screenshot|logo\s+(?:kopieren|übernehmen)|produktfoto\s+kopieren/i;
const internalCaptionPattern = /redaktionelle (?:übersicht|orientierung|produktidee)|nur separat verifizierte modellangaben|konkrete eigenschaften in der verlinkten auswahl/i;

export function evaluateImageCreativeQuality(content: ImageContent): CreativeQualityResult {
  const issues: string[] = [];
  const concept = content.visualConcept;

  if (!concept) {
    issues.push("Ein eigenständiges visuelles Konzept fehlt.");
  } else {
    if (concept.originality !== "original_editorial") issues.push("Das Creative ist nicht als originelles redaktionelles Visual ausgewiesen.");
    if (concept.visualWeight === "text_led") issues.push("Reine oder überwiegend typografische Textkarten sind nur als Preview/Fallback zulässig.");
    if (concept.mainIdea.trim().length < 24) issues.push("Die visuelle Hauptidee ist zu unkonkret.");
    if (concept.everydaySituation.trim().length < 20) issues.push("Eine konkrete Alltagssituation fehlt.");
    if (concept.productRelation.trim().length < 18) issues.push("Der Produktbezug ist nicht ausreichend erklärt.");
    if (["search", "category"].includes(concept.sourceKind) && concept.representation !== "generic_category") {
      issues.push("Such- und Kategorieseiten dürfen kein konkretes Modell vortäuschen.");
    }
  }

  const visualText = [content.title, content.hook, ...content.slides.flatMap(slide => [slide.visual, slide.prompt, slide.alt])].join(" ");
  if (fallbackPattern.test(visualText)) issues.push("Generische Symbol-, Platzhalter- oder Textkarten sind nicht veröffentlichungsreif.");
  if (copiedCommercePattern.test(visualText)) issues.push("Händlerbilder, Shop-Screenshots oder Logos dürfen nicht als Creative übernommen werden.");
  if (internalCaptionPattern.test(content.caption)) issues.push("Die Caption enthält interne Prüfhinweise statt eines lesbaren Beitrags.");
  if (content.slides.some(slide => slide.visual.trim().length < 20 || slide.prompt.trim().length < 40)) {
    issues.push("Mindestens ein Slide hat kein ausreichend konkretes visuelles Briefing.");
  }
  if (content.layout === "single" && content.slides.length !== 1) issues.push("Ein Einzelbild muss genau einen visuellen Slide besitzen.");
  if (content.layout === "carousel" && content.slides.length < 3) issues.push("Ein Carousel braucht mindestens drei visuell eigenständige Slides.");

  const score = Math.max(0, 100 - issues.length * 25);
  return { passed: issues.length === 0 && score >= 75, score, issues };
}

export function imageCreativePublicationError(content: ImageContent): string | null {
  const result = evaluateImageCreativeQuality(content);
  return result.passed ? null : `Creative nicht veröffentlichungsreif: ${result.issues.join(" ")}`;
}
